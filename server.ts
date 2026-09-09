import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import type { DesignInput, Metadata } from "./lib/types.ts";
import { asError } from "./lib/errors.ts";
import { websiteInfo } from "./lib/brand-info.ts";
import { historyPage, historyConcept } from "./lib/design-history.ts";
import "./lib/load-env.ts";
import {
  useGo,
  configuredModel as languageModel,
} from "./lib/model-provider.ts";
import http from "node:http";
import { createCommerce } from "./lib/commerce.ts";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { gallery, logoRoot, resolveReference } from "./lib/gallery.ts";
import { editReference, refinementSource } from "./lib/reference-edit.ts";
import { editorState } from "./lib/editor-state.ts";
import { planDesign } from "./lib/design-plan.ts";
import { reviewImage, describeReference } from "./lib/visual-review.ts";
import { logEvent, requestContext, runtimeLogger } from "./lib/runtime-log.ts";
import { createPlanningSessions } from "./lib/planning-session.ts";

const PORT = Number(process.env.PORT || 4173);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const configuredModel = process.env.OLLAMA_MODEL || "x/flux2-klein:latest";
const MODEL = configuredModel.includes(":")
  ? configuredModel
  : `${configuredModel}:latest`;
const publicDir = join(process.cwd(), "dist");
let frontend: ViteDevServer | undefined;
const development =
  process.argv.includes("--dev") && process.env.NODE_ENV !== "production";
const outputDir = resolve(process.env.OUTPUT_DIR || "outputs");
await mkdir(outputDir, { recursive: true });

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const commerce = createCommerce();
const planningSessions = createPlanningSessions();
const activeRequests = new Set<string>();
let draining = false,
  httpClosed = false,
  finishingShutdown = false;
async function finishShutdown() {
  if (
    draining &&
    httpClosed &&
    activeRequests.size === 0 &&
    !finishingShutdown
  ) {
    finishingShutdown = true;
    await runtimeLogger.flush();
    process.exit(0);
  }
}
const server = http.createServer((req, res) =>
  requestContext.run({ requestId: randomUUID() }, async () => {
    const requestId = requestContext.getStore()!.requestId;
    const requestUrl = req.url || "/";
    const started = Date.now(),
      route = requestUrl.split("?")[0];
    res.setHeader("x-request-id", requestId);
    const tracked = req.method === "POST";
    if (tracked) activeRequests.add(requestId);
    res.once("close", () => {
      void requestContext.run({ requestId }, () =>
        logEvent(res.writableFinished ? "info" : "warn", "http.complete", {
          method: req.method,
          route,
          status: res.statusCode,
          elapsedMs: Date.now() - started,
          aborted: !res.writableFinished,
        }),
      );
    });
    if (route.startsWith("/api/"))
      void logEvent("info", "http.start", { method: req.method, route });
    try {
      if (draining)
        throw Object.assign(new Error("服务正在切换，请稍后重试。"), {
          status: 503,
          code: "SERVER_DRAINING",
        });
      if (
        req.method === "POST" &&
        route !== "/api/billing/webhook" &&
        ((req.headers.origin &&
          req.headers.origin !== commerce.origin &&
          !(
            process.env.NODE_ENV !== "production" &&
            req.headers.origin === `http://${req.headers.host}` &&
            /^127\.0\.0\.1:|^localhost:/.test(req.headers.host || "")
          )) ||
          req.headers["sec-fetch-site"] === "cross-site")
      )
        throw Object.assign(new Error("不允许跨站请求。"), {
          status: 403,
          code: "CROSS_ORIGIN",
        });
      if (await commerce.handle(req, res, body)) return;
      if (req.method === "POST" && req.url === "/api/client-errors") {
        const report = await body(req, 16000);
        await logEvent("warn", "browser.error", {
          message: String(report.message || "").slice(0, 2000),
          stack: String(report.stack || "").slice(0, 4000),
        });
        return json(res, 202, { requestId });
      }
      if (req.method === "GET" && req.url === "/api/editor-status") {
        const { modelPath, ...status } = await editorState();
        return json(res, 200, status);
      }
      const brandInfo = route.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)$/);
      if (req.method === "GET" && brandInfo) {
        const brand = (await gallery()).find(
          (brand) => brand.id === brandInfo[1],
        );
        if (!brand) return json(res, 404, { error: "Brand not found" });
        return json(res, 200, await websiteInfo(brand));
      }
      if (req.method === "GET" && route === "/api/history") {
        res.setHeader("cache-control", "private, no-store");
        const page = Number(
          new URL(requestUrl, commerce.origin).searchParams.get("page") || 0,
        );
        return json(
          res,
          200,
          await historyPage({ commerce, outputDir, req, page }),
        );
      }
      if (req.method === "GET" && req.url === "/api/logos")
        return json(res, 200, { logos: await gallery() });
      if (req.method === "GET" && requestUrl.startsWith("/reference/")) {
        const file = requestUrl.slice("/reference/".length);
        if (
          !(await gallery()).some((item) =>
            item.variants.some((v) => v.file === file),
          )
        )
          return json(res, 404, { error: "Not found" });
        return serveFile(
          join(logoRoot, "logos", file),
          res,
          join(logoRoot, "logos"),
        );
      }
      if (req.method === "GET" && req.url === "/api/health")
        return await health(res);
      if (req.method === "POST" && req.url === "/api/territories") {
        const input = await body<DesignInput>(req);
        await requireReference(input);
        const account = await commerce.authorize(req, 3);
        if (account) await commerce.store.limitPlanning(account.id);
        return json(res, 200, {
          ...(await plan({ ...input, accountId: account?.id || null })),
          requestId,
        });
      }
      if (req.method === "POST" && req.url === "/api/generate")
        return await generate(req, res);
      if (req.method === "GET" && requestUrl.startsWith("/outputs/")) {
        const file = requestUrl.slice("/outputs/".length);
        await commerce.own(req, file.replace(/\.(png|json)$/, ""));
        res.setHeader("cache-control", "private, no-store");
        return serveFile(join(outputDir, file), res, outputDir);
      }
      if (req.method === "GET") {
        if (route.startsWith("/api/"))
          return json(res, 404, { error: "Not found" });
        if (frontend)
          return frontend.middlewares(req, res, (error?: unknown) =>
            json(res, error ? 500 : 404, {
              error: error ? "Frontend unavailable" : "Not found",
            }),
          );
        return serveFile(
          join(publicDir, route === "/" ? "index.html" : route),
          res,
          publicDir,
        );
      }
      json(res, 404, { error: "Not found" });
    } catch (cause) {
      const error = asError(cause);
      await logEvent("error", "http.error", {
        method: req.method,
        route,
        error,
      });
      const payload = {
        error: error.message || "Unexpected error",
        code: error.code,
        requestId,
      };
      if (res.headersSent) return res.end(JSON.stringify(payload) + "\n");
      if (error.status === 413) res.setHeader("connection", "close");
      json(res, error.status || 500, payload);
    } finally {
      if (tracked) activeRequests.delete(requestId);
      if (draining) void finishShutdown();
    }
  }),
);

async function plan(input: DesignInput) {
  await requireReference(input);
  return planningSessions(input, async (session) => {
    if (!session.referenceLoaded) {
      const reference = input.referenceId
        ? await resolveReference(input.referenceId, input.referenceFile)
        : null;
      if (!reference)
        throw Object.assign(new Error("参考 Logo 不存在，请重新选择。"), {
          status: 400,
          code: "INVALID_REFERENCE",
        });
      if (reference) {
        const state = await editorState();
        if (state.state !== "ready")
          throw Object.assign(
            new Error(state.detail || "参考图编辑尚未就绪。"),
            { status: 503, code: "EDITOR_UNAVAILABLE" },
          );
      }
      if (reference)
        reference.visualStyle = await describeReference(
          join(logoRoot, "logos", reference.file),
          OLLAMA_URL,
        );
      session.reference = reference;
      session.referenceLoaded = true;
    }
    try {
      return await planDesign(input, session.reference, OLLAMA_URL, {
        checkpoint: session.checkpoint,
      });
    } finally {
      // Retain the planner between directions, then free memory before FLUX starts.
      if (!useGo() && session.checkpoint.model)
        await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: session.checkpoint.model,
            keep_alive: 0,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
    }
  });
}
async function health(res: ServerResponse) {
  try {
    const [versionResponse, tagsResponse] = await Promise.all([
      fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2500) }),
      fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) }),
    ]);
    if (!versionResponse.ok || !tagsResponse.ok)
      throw new Error("Ollama health check failed");
    const version = await versionResponse.json();
    const tags = (await tagsResponse.json()) as {
      models?: { name?: string; model?: string }[];
    };
    const models = (tags.models || []).map((item) => item.name || item.model);
    const plannerModel = languageModel("planner"),
      visionModel = languageModel("vision");
    json(res, 200, {
      connected: true,
      version: version.version,
      model: MODEL,
      installed: models.includes(MODEL),
      plannerModel,
      plannerInstalled: useGo()
        ? Boolean(process.env.OPENCODE_GO_API_KEY)
        : models.includes(plannerModel),
      visionModel,
      visionInstalled: useGo()
        ? Boolean(process.env.OPENCODE_GO_API_KEY)
        : models.includes(visionModel),
      languageProvider: useGo() ? "opencode-go" : "ollama",
      activeRequests: activeRequests.size,
    });
  } catch {
    json(res, 200, { connected: false, model: MODEL, installed: false });
  }
}

async function requireReference(input: DesignInput) {
  if (typeof input?.referenceId !== "string" || !input.referenceId.trim())
    throw Object.assign(new Error("请先选择一个参考品牌 Logo。"), {
      status: 400,
      code: "REFERENCE_REQUIRED",
    });
  const reference = await resolveReference(
    input.referenceId,
    input.referenceFile,
  );
  if (!reference)
    throw Object.assign(new Error("参考 Logo 不存在，请重新选择。"), {
      status: 400,
      code: "INVALID_REFERENCE",
    });
  return reference;
}

async function generate(req: IncomingMessage, res: ServerResponse) {
  const input = await body<DesignInput>(req);
  if (!input.sourceId) await requireReference(input);
  await logEvent("info", "generation.start", {
    backend: input.referenceId || input.sourceId ? "mflux" : "ollama",
    model: MODEL,
    sourceId: input.sourceId,
    referenceId: input.referenceId,
    seed: input.seed,
    subject: input.designSpec?.subject,
  });
  if (!input.prompt) return json(res, 400, { error: "Prompt is required" });
  if (input.sourceId) {
    await commerce.own(req, input.sourceId);
    const source = await refinementSource(input.sourceId, outputDir);
    input.designSpec = source.designSpec;
  }
  const account = await commerce.authorize(req);
  const reservation = account ? await commerce.store.reserve(account.id) : null;
  try {
    if (input.referenceId || input.sourceId) {
      const id = randomUUID();
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
      });
      const metadata: Metadata = await editReference(
        input,
        outputDir,
        id,
        (event) => res.write(JSON.stringify(event) + "\n"),
      );
      res.write(JSON.stringify({ stage: "reviewing" }) + "\n");
      metadata.review = await reviewImage(
        join(outputDir, `${id}.png`),
        input.designSpec,
        OLLAMA_URL,
        input.locale,
      );
      await writeFile(
        join(outputDir, `${id}.json`),
        JSON.stringify(
          {
            ...metadata,
            concept: historyConcept(input),
            prompt: input.prompt,
            promptVersion: input.promptVersion,
            designSpec: input.designSpec,
            variation: input.variation,
            seed: input.seed,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      await logEvent("info", "generation.complete", {
        id,
        review: metadata.review,
        backend: "mflux",
      });
      if (reservation) await commerce.store.complete(reservation, id);
      return res.end(
        JSON.stringify({
          done: true,
          imageUrl: `/outputs/${id}.png`,
          id,
          ...metadata,
        }) + "\n",
      );
    }
    const width = allowedSize(input.width);
    const height = allowedSize(input.height);
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: input.prompt,
        width,
        height,
        ...(input.steps
          ? { steps: Math.max(4, Math.min(50, Number(input.steps))) }
          : {}),
        options: { seed: Number(input.seed) || 1 },
        stream: true,
      }),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }).catch(() => {
      throw Object.assign(
        new Error("无法连接 Ollama。请先启动 Ollama 应用或运行 ollama serve。"),
        { status: 503 },
      );
    });
    if (!response.ok || !response.body)
      throw Object.assign(
        new Error((await response.text()) || `Ollama ${response.status}`),
        { status: 502 },
      );

    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let image;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.image) image = event.image;
        res.write(
          JSON.stringify({
            completed: event.completed,
            total: event.total,
            done: event.done,
            error: event.error,
          }) + "\n",
        );
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      if (event.image) image = event.image;
    }
    if (!image)
      throw new Error(
        "Ollama 未返回图像。请升级 Ollama，并确认当前 macOS/模型组合支持图像生成。",
      );
    const id = randomUUID();
    await writeFile(join(outputDir, `${id}.png`), Buffer.from(image, "base64"));
    res.write(JSON.stringify({ stage: "reviewing" }) + "\n");
    const review = await reviewImage(
      join(outputDir, `${id}.png`),
      input.designSpec,
      OLLAMA_URL,
      input.locale,
    );
    await writeFile(
      join(outputDir, `${id}.json`),
      JSON.stringify(
        {
          model: MODEL,
          concept: historyConcept(input),
          prompt: input.prompt,
          promptVersion: input.promptVersion,
          designSpec: input.designSpec,
          variation: input.variation,
          review,
          seed: input.seed,
          width,
          height,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    await logEvent("info", "generation.complete", {
      id,
      review,
      backend: "ollama",
      model: MODEL,
    });
    if (reservation) await commerce.store.complete(reservation, id);
    res.end(
      JSON.stringify({
        done: true,
        imageUrl: `/outputs/${id}.png`,
        id,
        review,
      }) + "\n",
    );
  } catch (cause) {
    const error = asError(cause);
    if (reservation) await commerce.store.release(reservation);
    throw error;
  }
}

async function body<T extends object = Record<string, unknown>>(
  req: IncomingMessage,
  limit = 1_000_000,
): Promise<T> {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw Object.assign(new Error("请求内容超过允许大小。"), {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
      });
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error();
    return value as T;
  } catch {
    throw Object.assign(new Error("请求体必须是有效的 JSON 对象。"), {
      status: 400,
      code: "INVALID_JSON_BODY",
    });
  }
}

function allowedSize(value: unknown) {
  const size = Number(value) || 1024;
  return [512, 768, 1024].includes(size) ? size : 1024;
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function serveFile(path: string, res: ServerResponse, root: string) {
  const safe = normalize(path);
  if (!safe.startsWith(root + sep) || !existsSync(safe))
    return json(res, 404, { error: "Not found" });
  res.writeHead(200, {
    "content-type": types[extname(safe)] || "application/octet-stream",
  });
  createReadStream(safe)
    .on("error", (error) => {
      void logEvent("error", "http.file_error", { error });
      res.destroy();
    })
    .pipe(res);
}

if (development) {
  const { createServer } = await import("vite");
  frontend = await createServer({
    server: { middlewareMode: true, ws: { server } },
    appType: "mpa",
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `Logo2logo running at http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  void logEvent("info", "server.start", {
    port: (server.address() as AddressInfo).port,
    pid: process.pid,
    plannerModel: languageModel("planner"),
    visionModel: languageModel("vision"),
    imageModel: MODEL,
  });
});
process.on("SIGTERM", () => {
  draining = true;
  // Vite may still be crawling dependencies after the last browser request.
  // Start its cleanup without letting that work block draining the API server.
  void frontend
    ?.close()
    .catch((error: unknown) =>
      logEvent("warn", "frontend.close_error", { error }),
    );
  void logEvent("info", "server.stopping", {
    activeRequests: activeRequests.size,
  });
  server.close(() => {
    httpClosed = true;
    void finishShutdown();
  });
});
