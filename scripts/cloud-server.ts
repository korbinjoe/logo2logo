import "../lib/load-env.ts";
import http from "node:http";
import { createReadStream } from "node:fs";
import { resolve, extname, sep } from "node:path";
// Exercise exactly the Vercel API entry without changing the local model server.
process.env.VERCEL = "1";
const { default: handler } = await import("../api/index.ts");
const root = resolve("dist");
http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (/^\/(api|outputs|reference)\//.test(url.pathname))
      return handler(req, res);
    const path = resolve(
      root,
      "." + (url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "content-type",
      (
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        } as Record<string, string>
      )[extname(path)] || "application/octet-stream",
    );
    createReadStream(path)
      .on("error", () => {
        res.statusCode = 404;
        res.end();
      })
      .pipe(res);
  })
  .listen(Number(process.env.CLOUD_PORT || 4174), "127.0.0.1", () =>
    console.log(
      "Cloud adapter preview: http://127.0.0.1:" +
        (process.env.CLOUD_PORT || 4174),
    ),
  );
