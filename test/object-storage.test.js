import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createObjectStorage,
  storageProvider,
  storageReady,
} from "../lib/object-storage.ts";

const env = {
  STORAGE_PROVIDER: "cloudinary",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret",
};

test("storage selection requires complete credentials and honors explicit provider", () => {
  assert.equal(storageReady(env), true);
  assert.equal(storageProvider(env), "cloudinary");
  assert.equal(storageReady({ ...env, CLOUDINARY_API_SECRET: "" }), false);
  assert.equal(storageReady({ ...env, STORAGE_PROVIDER: "r2" }), false);
  assert.equal(storageReady({ ...env, STORAGE_PROVIDER: "typo" }), false);
  const r2 = {
    R2_ENDPOINT: "https://example.test",
    R2_BUCKET: "bucket",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
  };
  assert.equal(storageProvider(r2), "r2");
  assert.equal(storageReady(r2), true);
});

test("Cloudinary uploads protected PNGs and downloads with a short-lived valid signature", async (t) => {
  const bytes = Buffer.from("test png bytes");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    const target = new URL(url);
    assert.equal(target.hostname, "api.cloudinary.com");
    if (init.method === "POST") {
      assert.equal(target.pathname, "/v1_1/test-cloud/image/upload");
      assert.equal(init.body.get("type"), "authenticated");
      assert.equal(init.body.get("public_id"), "logo2logo/outputs/test-123");
      assert.equal(init.body.get("overwrite"), "true");
      assert.deepEqual(
        Buffer.from(await init.body.get("file").arrayBuffer()),
        bytes,
      );
      assert.equal(
        init.headers.Authorization,
        `Basic ${Buffer.from("test-key:test-secret").toString("base64")}`,
      );
      return Response.json({
        type: "authenticated",
        public_id: "logo2logo/outputs/test-123",
      });
    }
    assert.equal(target.pathname, "/v1_1/test-cloud/image/download");
    assert.equal(target.searchParams.get("type"), "authenticated");
    assert.equal(
      target.searchParams.get("public_id"),
      "logo2logo/outputs/test-123",
    );
    assert.equal(target.searchParams.get("format"), "png");
    const expiry =
      Number(target.searchParams.get("expires_at")) -
      Math.floor(Date.now() / 1000);
    assert.ok(expiry > 0 && expiry <= 60);
    const params = [...target.searchParams]
      .filter(([key]) => !["signature", "api_key"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const expected = createHash("sha1")
      .update(
        params.map(([key, value]) => `${key}=${value}`).join("&") +
          "test-secret",
      )
      .digest("hex");
    assert.equal(target.searchParams.get("signature"), expected);
    assert.equal(target.href.includes("test-secret"), false);
    return new Response(bytes);
  });
  const storage = createObjectStorage(env);
  await storage.put("test-123", bytes);
  assert.deepEqual(await storage.read("test-123"), bytes);
  await assert.rejects(storage.read("../other"), { code: "OUTPUT_NOT_FOUND" });
  assert.equal(calls, 2);
});

test("Cloudinary failures remain private and never masquerade as successful storage", async (t) => {
  let mode = "404";
  t.mock.method(globalThis, "fetch", async () => {
    if (mode === "network") throw Error("signed URL with secret");
    if (mode === "public")
      return Response.json({
        type: "upload",
        public_id: "logo2logo/outputs/test",
      });
    return new Response("provider details", { status: Number(mode) });
  });
  const storage = createObjectStorage(env);
  await assert.rejects(storage.read("test"), { code: "OUTPUT_NOT_FOUND" });
  mode = "401";
  await assert.rejects(storage.read("test"), { code: "STORAGE_UNAVAILABLE" });
  mode = "network";
  await assert.rejects(
    storage.read("test"),
    (error) =>
      error.code === "STORAGE_UNAVAILABLE" && !error.message.includes("secret"),
  );
  mode = "public";
  await assert.rejects(storage.put("test", Buffer.from("png")), {
    code: "STORAGE_UNAVAILABLE",
  });
});
