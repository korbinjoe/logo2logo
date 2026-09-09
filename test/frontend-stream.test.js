import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, readGeneration } from "../src/lib/api.ts";
function response(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          );
        controller.close();
      },
    }),
  );
}
test("generation stream preserves split UTF-8, multiple events and final unterminated line", async () => {
  const text =
      '{"stage":"reviewing","message":"检查主体"}\n{"id":"image-1","imageUrl":"/outputs/image-1.png"}',
    bytes = new TextEncoder().encode(text),
    events = [];
  const result = await readGeneration(
    response([bytes.slice(0, 37), bytes.slice(37, 39), bytes.slice(39)]),
    (event) => events.push(event),
  );
  assert.equal(events[0].message, "检查主体");
  assert.equal(result.id, "image-1");
  assert.equal(events.length, 2);
});
test("generation stream rejects server diagnostics and never accepts an incomplete output", async () => {
  await assert.rejects(
    readGeneration(
      response(['{"error":"No credits","code":"CREDITS_REQUIRED"}\n']),
      () => {},
    ),
    (e) => e instanceof ApiError && e.data.code === "CREDITS_REQUIRED",
  );
  await assert.rejects(
    readGeneration(response(['{"stage":"reviewing"}\n']), () => {}),
    /没有返回图片/,
  );
  await assert.rejects(
    readGeneration(response(['{"id":"image-1",']), () => {}),
    SyntaxError,
  );
});
test("202 cloud jobs poll their durable ID without submitting another generation", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, method: init.method });
    return Response.json({
      id: "job-123",
      imageUrl: "/outputs/job-123.png",
      done: true,
    });
  });
  const result = await readGeneration(
    Response.json({ jobId: "job-123" }, { status: 202 }),
    () => {},
  );
  assert.equal(result.id, "job-123");
  assert.deepEqual(calls, [
    { url: "/api/generations/job-123", method: "POST" },
  ]);
});
