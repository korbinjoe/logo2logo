import test from "node:test";
import assert from "node:assert/strict";
import { imageProviderError } from "../lib/image-provider-error.ts";
import { readGeneration } from "../src/lib/api.ts";

test("provider errors distinguish billing, authorization, overload and ambiguous failures without leaking upstream data", () => {
  for (const [status, detail, code] of [
    [403, "User is locked. Reason: TOP_UP.", "IMAGE_PROVIDER_BILLING_REQUIRED"],
    [403, "Exhausted balance", "IMAGE_PROVIDER_BILLING_REQUIRED"],
    [402, "Payment required", "IMAGE_PROVIDER_BILLING_REQUIRED"],
    [401, "Invalid key: PRIVATE", "IMAGE_PROVIDER_ACCESS_DENIED"],
    [403, "Permission denied", "IMAGE_PROVIDER_ACCESS_DENIED"],
    [429, "Rate limit", "IMAGE_PROVIDER_BUSY"],
    [422, [{ input: "PRIVATE" }], "GENERATION_SUBMIT_FAILED"],
    [500, "PRIVATE", "GENERATION_SUBMIT_FAILED"],
  ]) {
    const result = imageProviderError(
      Object.assign(new Error("PRIVATE"), { status, body: { detail } }),
    );
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
  assert.equal(
    imageProviderError(new Error("Network timeout")).code,
    "GENERATION_SUBMIT_FAILED",
  );
});

test("generation client preserves provider billing code for actionable UI feedback", async () => {
  const response = new Response(
    JSON.stringify({
      code: "IMAGE_PROVIDER_BILLING_REQUIRED",
      requestId: "test-id",
    }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
  await assert.rejects(
    readGeneration(response, () => {}),
    (e) =>
      e.data.code === "IMAGE_PROVIDER_BILLING_REQUIRED" &&
      e.data.requestId === "test-id",
  );
});
