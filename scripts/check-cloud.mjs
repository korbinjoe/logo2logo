import "../lib/load-env.ts";
import { createClient } from "@libsql/client/web";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { cloudConfig } from "../lib/cloud-app.ts";
import { storageReady } from "../lib/object-storage.ts";

// Read-only readiness check. Never creates a purchase or calls image generation.
try {
  cloudConfig();
  if (
    process.env.MODEL_PROVIDER !== "opencode-go" ||
    !process.env.OPENCODE_GO_API_KEY
  )
    throw Error(
      "Configure MODEL_PROVIDER=opencode-go and OPENCODE_GO_API_KEY.",
    );
  if (!process.env.FAL_KEY) throw Error("Configure FAL_KEY.");
  if (!storageReady())
    throw Error(
      "Configure R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
    );
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const rows = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    const names = new Set(rows.rows.map((row) => row.name));
    for (const name of [
      "users",
      "sessions",
      "oauth",
      "orders",
      "ledger",
      "jobs",
      "cloud_jobs",
      "planning_sessions",
    ])
      if (!names.has(name))
        throw Error("Database migration required: npm run db:migrate");
    console.log("Turso connection and tables: OK");
  } finally {
    client.close();
  }
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET }), {
      abortSignal: AbortSignal.timeout(15000),
    });
    console.log("R2 bucket access: OK");
  } finally {
    s3.destroy();
  }
  const oauth = ["GOOGLE", "GITHUB"].some(
    (provider) =>
      process.env[provider + "_CLIENT_ID"] &&
      process.env[provider + "_CLIENT_SECRET"],
  );
  console.log(
    "OAuth configuration: " +
      (oauth ? "present (verify callback URL in provider console)" : "missing"),
  );
  const billing = [
    "PADDLE_API_KEY",
    "PADDLE_CLIENT_TOKEN",
    "PADDLE_WEBHOOK_SECRET",
    "PADDLE_PRICE_STARTER",
    "PADDLE_PRICE_CREATOR",
    "PADDLE_PRICE_STUDIO",
  ].every((key) => Boolean(process.env[key]));
  console.log(
    "Paddle configuration: " +
      (billing
        ? "present (verify sandbox checkout before launch)"
        : "missing; purchases remain disabled"),
  );
  console.log(
    "Image/planner keys are configured; this check does not validate upstream balances or generate a paid image.",
  );
  if (!oauth) process.exitCode = 1;
} catch (error) {
  console.error(
    "Cloud readiness failed: " +
      (error.code || error.name || "Error") +
      (error.missing
        ? " — " + error.missing.join(", ")
        : error.message && !error.$metadata
          ? " — " + error.message
          : ""),
  );
  process.exitCode = 1;
}
