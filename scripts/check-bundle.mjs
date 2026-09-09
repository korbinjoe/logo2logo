import { stripTypeScriptTypes } from "node:module";
import { nodeFileTrace } from "@vercel/nft";
import { stat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// nft traces JavaScript. Strip only erasable types in memory, as Node 24 does;
// retain source paths and real runtime imports so the trace still audits our API.
const result = await nodeFileTrace(["api/index.ts"], {
  async readFile(path) {
    try {
      const source = await readFile(path);
      return path.endsWith(".ts") && !path.includes("/node_modules/")
        ? stripTypeScriptTypes(source.toString(), { mode: "strip" })
        : source;
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") return null;
      throw error;
    }
  },
});
for (const module of [
  "lib/cloud-app.ts",
  "lib/cloud-generation.ts",
  "lib/commerce.ts",
])
  if (!result.fileList.has(module)) throw Error(`API trace missed ${module}`);
const files = new Set(result.fileList);
async function include(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await include(path);
    else files.add(path);
  }
}
await include("data/svg-logos");
const forbidden = [...files].filter((path) =>
  /^(\.env|outputs\/|models\/|\.venv\/|\.runtime\/)/.test(path),
);
if (forbidden.length)
  throw Error(
    "Private/local data entered the function bundle: " + forbidden.join(", "),
  );
const warnings = [...result.warnings].filter(
  (error) => !/@img\/sharp|utf-8-validate|bufferutil/.test(error.message),
);
if (warnings.length)
  throw Error(warnings.map((error) => error.message).join("\n"));
// nft reports optional binaries for other operating systems; verify this host's
// installed sharp actually works instead of treating every OS variant as required.
await sharp({
  create: { width: 1, height: 1, channels: 3, background: "#fff" },
})
  .png()
  .toBuffer();
let bytes = 0;
for (const file of files) bytes += (await stat(file)).size;
if (bytes > 250 * 1024 * 1024) throw Error("Function trace exceeds 250 MB.");
console.log(
  `Function dependency trace: ${files.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB on this platform; no local models, outputs or secrets. Linux native binaries are selected during Vercel npm ci.`,
);
