import type { HttpHandler } from "../lib/types.ts";
import { asError } from "../lib/errors.ts";
import { createCloudApp } from "../lib/cloud-app.ts";

// Raw Node request handling preserves Paddle's signed webhook bytes.
export const config = { api: { bodyParser: false } };
export function createHandler(
  factory: () => HttpHandler = createCloudApp,
): HttpHandler {
  let app: HttpHandler | undefined;
  return async function handler(req, res) {
    try {
      const url = new URL(req.url || "/", "https://internal.invalid");
      const path = url.searchParams.get("__path");
      if (path && url.pathname === "/api/index") {
        if (!/^\/(api|outputs|reference)\//.test(path))
          throw Error("Invalid route");
        url.searchParams.delete("__path");
        req.url = path + (url.search ? url.search : "");
      }
      app ||= factory();
      return await app(req, res);
    } catch (cause) {
      const error = asError(cause);
      res.statusCode = error.status || 503;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: error.code || "CLOUD_UNAVAILABLE",
          code: error.code || "CLOUD_UNAVAILABLE",
          ...(error.missing ? { missing: error.missing } : {}),
        }),
      );
    }
  };
}
export default createHandler();
