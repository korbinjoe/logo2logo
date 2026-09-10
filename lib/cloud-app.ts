import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  Environment,
  RemoteAccounts,
  ObjectStorage,
  DesignInput,
  HistoryEntry,
} from "./types.ts";
import type { CommerceOptions } from "./commerce.ts";
import { asError } from "./errors.ts";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCommerce, plans, socialLinks } from "./commerce.ts";
import { createRemoteAccounts } from "./remote-accounts.ts";
import { createCloudState } from "./cloud-state.ts";
import {
  createObjectStorage,
  storageReady,
  storageProvider,
} from "./object-storage.ts";
import { createCloudGeneration, imageEndpoint } from "./cloud-generation.ts";
import { gallery, resolveReference, logoRoot } from "./gallery.ts";
import { websiteInfo } from "./brand-info.ts";
import { planDesign } from "./design-plan.ts";
import { describeReference } from "./visual-review.ts";
import { historyItem } from "./design-history.ts";
import { configuredModel } from "./model-provider.ts";
import { fault } from "./accounts.ts";
import { requestContext, sanitize } from "./runtime-log.ts";

export function cloudConfig(env: Environment = process.env) {
  const missing = ["APP_URL", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"].filter(
    (key) => !env[key],
  );
  if (missing.length)
    throw Object.assign(fault("CLOUD_CONFIG_REQUIRED", 503), { missing });
  if (!/^https:\/\//.test(env.APP_URL || ""))
    throw fault("APP_URL_MUST_BE_HTTPS", 503);
  if (!/^(libsql|https):\/\//.test(env.TURSO_DATABASE_URL || ""))
    throw fault("REMOTE_DATABASE_REQUIRED", 503);
}
export interface CloudAppOptions {
  env?: Environment;
  store?: RemoteAccounts;
  storage?: ObjectStorage;
  generation?: ReturnType<typeof createCloudGeneration>;
  planner?: typeof planDesign;
  describe?: typeof describeReference;
  commerceOptions?: CommerceOptions;
}
function createConfiguredCloudApp({
  env = process.env,
  store,
  storage,
  generation,
  planner = planDesign,
  describe = describeReference,
  commerceOptions = {},
}: CloudAppOptions = {}) {
  if (!store) {
    cloudConfig(env);
    store = createRemoteAccounts({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
  }
  const state = createCloudState(store);
  const commerce = createCommerce({
    env: { ...env, NODE_ENV: "production", BILLING_REQUIRED: "true" },
    store,
    ...commerceOptions,
  });
  const imageReady = () =>
    Boolean(env.FAL_KEY && (storage || storageReady(env)));
  const languageReady = () =>
    env.MODEL_PROVIDER === "opencode-go" && Boolean(env.OPENCODE_GO_API_KEY);
  const renderer = () => {
    if (!imageReady()) throw fault("CLOUD_IMAGE_UNAVAILABLE", 503);
    storage ||= createObjectStorage(env);
    return (generation ||= createCloudGeneration({ state, storage, env }));
  };
  const objects = () => (storage ||= createObjectStorage(env));
  const accounts = store;
  return async (req: IncomingMessage, res: ServerResponse) =>
    requestContext.run({ requestId: randomUUID() }, async () => {
      const requestId = requestContext.getStore()!.requestId;
      res.setHeader("x-request-id", requestId);
      res.setHeader("cache-control", "private, no-store");
      res.setHeader("x-content-type-options", "nosniff");
      const url = new URL(req.url || "/", commerce.origin),
        route = url.pathname;
      try {
        const callback = route.match(
          /^\/api\/generations\/([a-z0-9-]+)\/callback$/i,
        );
        if (req.method === "POST" && callback) {
          const userId = await state.callback(
            callback[1],
            url.searchParams.get("token") || "",
          );
          // The per-job secret only authorizes a status refresh. Never trust callback
          // payloads, URLs or success flags: fetch the result from fal with our key.
          try {
            const result = await renderer().poll(callback[1], userId);
            if (!result.done) throw fault("CALLBACK_NOT_READY", 503);
          } catch (cause) {
            const error = asError(cause);
            if (error.status !== 422) throw error;
          }
          return json(res, 200, { received: true });
        }
        if (
          req.method === "POST" &&
          route !== "/api/billing/webhook" &&
          ((req.headers.origin && req.headers.origin !== commerce.origin) ||
            req.headers["sec-fetch-site"] === "cross-site")
        )
          throw fault("CROSS_ORIGIN", 403);
        if (await commerce.handle(req, res, readBody)) return;
        if (req.method === "GET" && route === "/api/health")
          return json(res, 200, {
            connected: languageReady() && imageReady(),
            installed: imageReady(),
            plannerInstalled: languageReady(),
            visionInstalled: languageReady(),
            model: imageEndpoint,
            plannerModel: configuredModel("planner"),
            visionModel: configuredModel("vision"),
            languageProvider: "opencode-go",
            imageProvider: "fal",
            database: "turso",
            storage: storageReady(env) ? storageProvider(env) : "unconfigured",
          });
        if (req.method === "GET" && route === "/api/editor-status")
          return json(res, 200, {
            state: imageReady() ? "ready" : "unavailable",
            detail: imageReady()
              ? "Cloud image generation is configured."
              : "Configure FAL_KEY and image storage to enable cloud generation.",
          });
        if (req.method === "POST" && route === "/api/territories") {
          const input = await readBody<DesignInput>(req);
          if (!input.referenceId) throw fault("REFERENCE_REQUIRED");
          const reference = await resolveReference(
            input.referenceId,
            input.referenceFile,
          );
          if (!reference) throw fault("INVALID_REFERENCE");
          const account = await commerce.authorize(req, 3);
          if (!languageReady()) throw fault("PLANNER_UNAVAILABLE", 503);
          renderer();
          if (!account) throw fault("AUTH_REQUIRED", 401);
          await accounts.limitPlanning(account.id);
          const deadline = Date.now() + 240000;
          const result = await state.withPlan(
            { ...input, accountId: account.id },
            async (session, save) => {
              if (!session.referenceLoaded) {
                session.reference = {
                  ...reference,
                  visualStyle: await describe(
                    join(logoRoot, "logos", reference.file),
                    "",
                  ),
                };
                session.referenceLoaded = true;
                await save();
              }
              return planner(input, session.reference, "", {
                checkpoint: session.checkpoint,
                onCheckpoint: save,
                deadline,
              });
            },
          );
          return json(res, 200, { ...result, requestId });
        }
        if (req.method === "POST" && route === "/api/generate") {
          // reserve() performs the balance check atomically; a retry may resume the
          // last reserved credit even when the available balance has reached zero.
          const account = await commerce.requireUser(req);
          return json(
            res,
            202,
            await renderer().submit(
              account.id,
              await readBody<DesignInput>(req),
            ),
          );
        }
        const poll = route.match(/^\/api\/generations\/([a-z0-9-]+)$/i);
        if (req.method === "POST" && poll) {
          const account = await commerce.requireUser(req);
          return json(res, 200, await renderer().poll(poll[1], account.id));
        }
        if (req.method === "GET" && route === "/api/history") {
          const account = await commerce.requireUser(req),
            page = Math.max(
              0,
              Math.min(
                100000,
                Number.parseInt(url.searchParams.get("page") || "0") || 0,
              ),
            );
          const [{ total }] = await accounts.query<{ total: number }>(
            "SELECT COUNT(*) AS total FROM jobs WHERE user_id=? AND status='complete'",
            account.id,
          );
          const rows = await accounts.query<
            HistoryEntry & { metadata: string | null }
          >(
            "SELECT jobs.output,jobs.created,cloud_jobs.metadata FROM jobs LEFT JOIN cloud_jobs USING(id) WHERE jobs.user_id=? AND jobs.status='complete' ORDER BY jobs.created DESC,jobs.id DESC LIMIT 24 OFFSET ?",
            account.id,
            page * 24,
          );
          return json(res, 200, {
            items: rows.map((row) =>
              row.metadata
                ? historyItem(row.output, JSON.parse(row.metadata), row.created)
                : {
                    id: row.output,
                    createdAt: new Date(row.created).toISOString(),
                    unavailable: true,
                    title: "",
                    review: "unreviewed",
                    phase: "explore",
                    c: {},
                  },
            ),
            total,
            page,
            hasMore: (page + 1) * 24 < total,
            pending: await state.active(account.id),
          });
        }
        const output = route.match(/^\/outputs\/([a-z0-9-]+)\.(png|json)$/i);
        if (req.method === "GET" && output) {
          const account = await commerce.requireUser(req),
            job = await state.job(output[1], account.id);
          if (job.status !== "complete") throw fault("OUTPUT_NOT_FOUND", 404);
          if (output[2] === "json") return json(res, 200, job.metadata);
          // Stream through the same origin: recoloring uses canvas and downloads must
          // work without a public bucket or exposing signed cross-origin URLs.
          const bytes = await objects().read(output[1]);
          res.setHeader("content-type", "image/png");
          return res.end(bytes);
        }
        if (req.method === "POST" && route === "/api/client-errors") {
          const report = await readBody(req, 16000);
          console.warn(
            JSON.stringify(
              sanitize({
                event: "browser.error",
                requestId,
                message: report.message,
                stack: report.stack,
              }),
            ),
          );
          return json(res, 202, { requestId });
        }
        throw fault("NOT_FOUND", 404);
      } catch (cause) {
        const error = asError(cause);
        console.error(
          JSON.stringify(
            sanitize({
              event: "http.error",
              route,
              code: error.code,
              requestId,
            }),
          ),
        );
        return json(res, error.status || 500, {
          error: error.code || "SERVICE_UNAVAILABLE",
          code: error.code || "SERVICE_UNAVAILABLE",
          requestId,
        });
      }
    });
}
export async function readBody<T extends object = Record<string, unknown>>(
  req: IncomingMessage,
  limit = 1000000,
): Promise<T> {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fault("PAYLOAD_TOO_LARGE", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw Error();
    return value as T;
  } catch {
    throw fault("INVALID_JSON_BODY");
  }
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function publicGallery(req: IncomingMessage, res: ServerResponse) {
  const route = new URL(req.url || "/", "https://internal.invalid").pathname;
  if (req.method === "GET" && route === "/api/logos") {
    res.setHeader("cache-control", "public, max-age=300");
    json(res, 200, { logos: await gallery() });
    return true;
  }
  if (req.method === "GET" && route.startsWith("/reference/")) {
    const file = route.slice("/reference/".length);
    if (
      !(await gallery()).some((item) =>
        item.variants.some((v) => v.file === file),
      )
    )
      throw fault("NOT_FOUND", 404);
    res.setHeader("cache-control", "public, max-age=86400");
    res.setHeader("content-type", "image/svg+xml");
    res.end(await readFile(join(logoRoot, "logos", file)));
    return true;
  }
  const brand = route.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)$/);
  if (req.method === "GET" && brand) {
    const item = (await gallery()).find((item) => item.id === brand[1]);
    if (!item) throw fault("NOT_FOUND", 404);
    json(res, 200, await websiteInfo(item));
    return true;
  }
  return false;
}

export function createCloudApp(options: CloudAppOptions = {}) {
  let app: ReturnType<typeof createConfiguredCloudApp> | undefined;
  const env = options.env || process.env;
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, no-store");
    try {
      if (await publicGallery(req, res)) return;
      const missing = [
        "APP_URL",
        "TURSO_DATABASE_URL",
        "TURSO_AUTH_TOKEN",
      ].filter((key) => !env[key]);
      if (!options.store && missing.length) {
        const route = new URL(req.url || "/", "https://internal.invalid")
          .pathname;
        if (req.method === "GET" && route === "/api/account") {
          return json(res, 200, {
            user: null,
            designs: [],
            localMode: false,
            billingReady: false,
            providers: [
              { id: "google", enabled: false },
              { id: "github", enabled: false },
            ],
            plans,
            socials: socialLinks(env),
            paymentEnvironment:
              env.PADDLE_ENVIRONMENT === "production"
                ? "production"
                : "sandbox",
          });
        }
        if (req.method === "GET" && route === "/api/health") {
          return json(res, 200, {
            connected: false,
            installed: false,
            plannerInstalled: false,
            visionInstalled: false,
            model: imageEndpoint,
            database: "unconfigured",
            storage: "unconfigured",
            missing,
          });
        }
        if (req.method === "GET" && route === "/api/editor-status") {
          return json(res, 200, {
            state: "unavailable",
            detail: "Cloud generation is not configured yet.",
          });
        }
        throw Object.assign(fault("CLOUD_CONFIG_REQUIRED", 503), { missing });
      }
      app ||= createConfiguredCloudApp(options);
      return await app(req, res);
    } catch (cause) {
      const error = asError(cause);
      return json(res, error.status || 500, {
        error: error.code || "SERVICE_UNAVAILABLE",
        code: error.code || "SERVICE_UNAVAILABLE",
      });
    }
  };
}
