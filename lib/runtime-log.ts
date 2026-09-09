import { asError } from "./errors.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, appendFile, stat, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (
    /authorization|cookie|password|secret|api.?key|access.?token|^images?$|base64/i.test(
      key,
    )
  )
    return "[REDACTED]";
  if (depth > 8) return "[DEPTH LIMIT]";
  if (value instanceof Error)
    return sanitize(
      {
        name: value.name,
        message: value.message,
        code: asError(value).code,
        field: asError(value).field,
        cause: value.cause,
        stack: value.stack,
      },
      key,
      depth + 1,
    );
  if (typeof value === "string")
    return value
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/data:image\/[^\s"']+/gi, "[IMAGE REDACTED]")
      .slice(0, 12000);
  if (Array.isArray(value))
    return value.slice(0, 30).map((v) => sanitize(v, "", depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 60)
        .map(([k, v]) => [k, sanitize(v, k, depth + 1)]),
    );
  return value;
}
export function createLogger(
  directory: string,
  { maxBytes = 5 * 1024 * 1024, retention = 4 } = {},
) {
  const path = join(directory, "runtime.jsonl");
  let queue = Promise.resolve();
  const log = (
    level: string,
    event: string,
    details: Record<string, unknown> = {},
  ) => {
    const line =
      JSON.stringify(
        sanitize({
          ...details,
          time: new Date().toISOString(),
          level,
          event,
          requestId: requestContext.getStore()?.requestId,
        }),
      ) + "\n";
    queue = queue
      .then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const size = await stat(path)
          .then((s) => s.size)
          .catch(() => 0);
        if (size && size + Buffer.byteLength(line) > maxBytes) {
          await rm(`${path}.${retention}`, { force: true });
          for (let i = retention - 1; i >= 0; i--)
            await rename(i ? `${path}.${i}` : path, `${path}.${i + 1}`).catch(
              (error) => {
                if (error.code !== "ENOENT") throw error;
              },
            );
        }
        await appendFile(path, line, { mode: 0o600 });
      })
      .catch((error) =>
        console.error("Runtime log write failed:", error.code || error.message),
      );
    return queue;
  };
  return { log, flush: () => queue, path };
}
export const runtimeLogger = process.env.VERCEL
  ? {
      log: async (
        level: string,
        event: string,
        details: Record<string, unknown>,
      ) =>
        console.log(
          JSON.stringify(
            sanitize({
              ...details,
              level,
              event,
              requestId: requestContext.getStore()?.requestId,
            }),
          ),
        ),
      flush: async () => {},
    }
  : createLogger(resolve(process.env.LOG_DIR || ".runtime/logs"));
export const logEvent = (
  level: string,
  event: string,
  details: Record<string, unknown>,
) => runtimeLogger.log(level, event, details);
