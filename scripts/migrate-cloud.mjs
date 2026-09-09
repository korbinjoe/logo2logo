import "../lib/load-env.ts";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
const url = process.env.TURSO_DATABASE_URL;
if (!url)
  throw Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before migration.");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  const sql = await readFile(
    new URL("../migrations/001-initial.sql", import.meta.url),
    "utf8",
  );
  await client.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    "write",
  );
  console.log("Database schema is ready. Existing rows were preserved.");
} finally {
  client.close();
}
