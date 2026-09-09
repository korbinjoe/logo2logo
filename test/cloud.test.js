import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { Readable } from "node:stream";
import sharp from "sharp";
import { createRemoteAccounts } from "../lib/remote-accounts.ts";
import { createCloudState } from "../lib/cloud-state.ts";
import { createCloudGeneration } from "../lib/cloud-generation.ts";
import { createCloudApp, cloudConfig } from "../lib/cloud-app.ts";

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "logo-cloud-"));
  const url = "file:" + join(directory, "db.sqlite"),
    clients = [];
  const open = () => {
    const client = createClient({ url });
    clients.push(client);
    return createRemoteAccounts({ client });
  };
  const store = open();
  const schema = await readFile(
    new URL("../migrations/001-initial.sql", import.meta.url),
    "utf8",
  );
  // Re-running migrations must preserve data and remain safe.
  for (let i = 0; i < 2; i++)
    await store.db.batch(
      schema.split(";").filter((s) => s.trim()),
      "write",
    );
  t.after(async () => {
    clients.forEach((c) => c.close());
    await rm(directory, { recursive: true, force: true });
  });
  return { store, open };
}
async function funded(store, subject = "alice") {
  const user = await store.identify("google", subject, subject);
  const orderId = await store.order(user.id, {
    id: "starter",
    amount: 1200,
    credits: 18,
  });
  const payment = {
    orderId,
    userId: user.id,
    id: "txn_" + subject,
    currency: "USD",
    amount: 1200,
    status: "completed",
  };
  await store.setCheckout(orderId, payment.id);
  await store.fulfill(payment);
  return { user, payment };
}
test("remote transactions preserve billing, OAuth and reservations across cold instances", async (t) => {
  const { store, open } = await setup(t),
    { user, payment } = await funded(store),
    raw = await store.session(user.id);
  const oauth = await store.startOAuth("google", "browser");
  const id = await store.reserve(user.id),
    cold = open();
  assert.equal(
    (await cold.authenticate(raw)).credits,
    17,
    "cold start must not refund an active job",
  );
  await assert.rejects(cold.reserve(user.id), { code: "GENERATION_BUSY" });
  assert.equal(
    await cold.fulfill(payment),
    false,
    "webhook replay grants no credits",
  );
  await assert.rejects(cold.fulfill({ ...payment, amount: 1 }), {
    code: "PAYMENT_MISMATCH",
  });
  assert.equal(
    await cold.finishOAuth(oauth.state, "browser", "google"),
    oauth.verifier,
  );
  await assert.rejects(store.finishOAuth(oauth.state, "browser", "google"), {
    code: "AUTH_EXPIRED",
  });
  await cold.release(id);
  await store.release(id);
  assert.equal((await store.user(user.id)).credits, 18);
  const refund = { id: "refund-1", session: payment.id, amount: 600 };
  await cold.refund(refund);
  await store.refund(refund);
  assert.equal((await store.user(user.id)).credits, 9);
  await cold.logout(raw);
  assert.equal(await store.authenticate(raw), null);
});
test("durable planning checkpoints are account-bound and reject overlapping instances", async (t) => {
  const { store, open } = await setup(t),
    a = createCloudState(store),
    b = createCloudState(open());
  const input = {
    description: "Nova",
    referenceId: "notion",
    accountId: "alice",
    locale: "en",
  };
  let resumeId;
  const first = await a.withPlan(input, async (session, save) => {
    resumeId = session.id;
    session.checkpoint.concepts.push({ brandName: "Nova" });
    await save();
    await assert.rejects(
      b.withPlan({ ...input, resumeId }, () => {}),
      { code: "PLAN_BUSY" },
    );
    return { status: "partial" };
  });
  assert.equal(first.resumeId, resumeId);
  await assert.rejects(
    b.withPlan({ ...input, resumeId, accountId: "bob" }, () => {}),
    { code: "BRIEF_CHANGED" },
  );
  await b.withPlan({ ...input, resumeId }, async (session) =>
    assert.equal(session.checkpoint.concepts[0].brandName, "Nova"),
  );
});
test("queued generation resumes without resubmission; private output, history, refinement and refunds work", async (t) => {
  const { store, open } = await setup(t),
    { user } = await funded(store),
    other = (await funded(store, "bob")).user;
  let submits = 0,
    puts = 0,
    reviews = 0,
    submitFailure = false,
    storageFailure = false;
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#fff" },
  })
    .png()
    .toBuffer();
  const objects = new Map(),
    storage = {
      read: async (id) => objects.get(id),
      put: async (id, data) => {
        if (storageFailure) throw Error("Temporary storage outage");
        puts++;
        objects.set(id, data);
      },
    };
  const submissions = [];
  const provider = {
    queue: {
      submit: async (endpoint, request) => {
        submissions.push({ endpoint, ...request });
        submits++;
        if (submitFailure) throw Error("Network interrupted");
        return { request_id: "fal_" + submits };
      },
      status: async () => ({ status: "COMPLETED" }),
      result: async () => ({
        data: {
          images: [{ url: "https://fal.media/test.png" }],
          has_nsfw_concepts: [false],
        },
      }),
    },
  };
  const options = {
    env: { APP_URL: "https://logo.test", FAL_KEY: "test" },
    storage,
    provider,
    review: async () => {
      reviews++;
      return { status: "pass", reason: "Test review" };
    },
    fetcher: async () => new Response(bytes),
  };
  const state = createCloudState(store),
    generation = createCloudGeneration({ ...options, state });
  const input = {
    prompt: "An N logo",
    referenceId: "notion",
    referenceFile: "notion.svg",
    designSpec: { subject: "letter N", brandName: "Nova" },
    locale: "en",
    promptVersion: "exploration-v2",
  };
  await assert.rejects(generation.submit(user.id, { prompt: "No reference" }), {
    code: "REFERENCE_REQUIRED",
  });
  const first = await generation.submit(user.id, input);
  assert.equal((await generation.submit(user.id, input)).jobId, first.jobId);
  assert.equal(submits, 1);
  assert.equal(submissions[0].endpoint, "fal-ai/flux-2/klein/4b");
  assert.equal(
    submissions[0].input.image_urls,
    undefined,
    "exploration uses the planned style, not reference pixels",
  );
  const callback = new URL(submissions[0].webhookUrl);
  assert.equal(
    await state.callback(first.jobId, callback.searchParams.get("token")),
    user.id,
  );
  await assert.rejects(state.callback(first.jobId, "forged"), {
    code: "INVALID_CALLBACK",
  });
  await assert.rejects(generation.poll(first.jobId, other.id), {
    code: "OUTPUT_NOT_FOUND",
  });
  // Separate instance sees both reservation and provider request ID.
  const cold = createCloudGeneration({
    ...options,
    state: createCloudState(open()),
  });
  storageFailure = true;
  await assert.rejects(cold.poll(first.jobId, user.id), /storage outage/);
  assert.equal(
    (await store.user(user.id)).credits,
    17,
    "transient finalization failure keeps its reservation",
  );
  storageFailure = false;
  const result = await cold.poll(first.jobId, user.id);
  assert.equal(result.id, first.jobId);
  assert.equal(result.review.status, "pass");
  assert.equal(puts, 1);
  await generation.poll(first.jobId, user.id);
  assert.equal(submits, 1);
  assert.equal(reviews, 2, "completed jobs are never reviewed again");
  assert.equal((await store.history(user.id)).total, 1);
  assert.equal((await store.history(other.id)).total, 0);
  const app = createCloudApp({ store, env: options.env, storage, generation });
  const authenticated = "l2l_session=" + (await store.session(user.id));
  assert.equal((await request(app, `/outputs/${first.jobId}.png`)).status, 401);
  assert.deepEqual(
    (
      await request(app, `/outputs/${first.jobId}.png`, {
        cookie: authenticated,
      })
    ).body,
    objects.get(first.jobId),
  );
  const history = JSON.parse(
    (await request(app, "/api/history", { cookie: authenticated })).body,
  );
  assert.equal(history.items[0].id, first.jobId);
  const webhook = await request(app, callback.pathname + callback.search, {
    method: "POST",
    body: { images: [{ url: "http://127.0.0.1/private" }] },
  });
  assert.deepEqual(
    JSON.parse(webhook.body),
    { received: true },
    "webhook ignores untrusted image URLs and returns no private image",
  );
  assert.equal(submits, 1);
  assert.equal(
    (await state.job(first.jobId, user.id)).metadata.concept.locale,
    "en",
  );
  await assert.rejects(
    generation.submit(other.id, { ...input, sourceId: first.jobId }),
    { code: "OUTPUT_NOT_FOUND" },
  );
  const refined = await generation.submit(user.id, {
    ...input,
    sourceId: first.jobId,
    designSpec: { subject: "spoof" },
  });
  assert.equal(submissions[1].endpoint, "fal-ai/flux-2/klein/4b/edit");
  assert.match(submissions[1].input.image_urls[0], /^data:image\/png;base64,/);
  assert.equal(
    (await state.job(refined.jobId, user.id)).input.designSpec.subject,
    "letter N",
  );
  await state.fail(refined.jobId, "TEST_FAILURE");
  await state.fail(refined.jobId, "TEST_FAILURE");
  assert.equal((await store.user(user.id)).credits, 17);
  submitFailure = true;
  await assert.rejects(generation.submit(user.id, input), {
    code: "GENERATION_SUBMIT_FAILED",
  });
  assert.equal(
    (await store.user(user.id)).credits,
    17,
    "ambiguous submit errors refund exactly once",
  );
  assert.equal((await state.active(user.id)).length, 0);
});
test("lease expiry recovers abandoned finalizers while current instances stay exclusive", async (t) => {
  const { store, open } = await setup(t),
    { user } = await funded(store);
  let now = 100;
  const a = createCloudState(store, { now: () => now }),
    b = createCloudState(open(), { now: () => now });
  const { id } = await a.reserve(user.id, { prompt: "x" }, "test");
  const lease = await a.claim(id);
  assert.ok(lease);
  assert.equal(await b.claim(id), null);
  now += 280001;
  const replacement = await b.claim(id);
  assert.ok(replacement);
  await assert.rejects(a.complete(id, lease, {}), { code: "JOB_LEASE_LOST" });
  await b.complete(id, replacement, { review: { status: "pass" } });
  assert.equal((await a.job(id, user.id)).status, "complete");
});
async function request(
  app,
  path,
  { method = "GET", cookie = "", body = "", origin } = {},
) {
  const req = Readable.from([
    Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  ]);
  Object.assign(req, {
    url: path,
    method,
    headers: { cookie, ...(origin ? { origin } : {}) },
  });
  const result = { status: 200, headers: {}, body: "" };
  const res = {
    statusCode: 200,
    setHeader: (k, v) => (result.headers[k] = v),
    writeHead: (status, headers) => {
      res.statusCode = status;
      Object.assign(result.headers, headers);
    },
    end: (body) => {
      result.body = body;
      result.status = res.statusCode;
    },
  };
  await app(req, res);
  return result;
}
test("cloud HTTP enforces auth, CSRF and readiness; production never bypasses credits", async (t) => {
  const { store } = await setup(t),
    { user } = await funded(store),
    raw = await store.session(user.id);
  const env = {
    APP_URL: "https://logo.test",
    BILLING_REQUIRED: "false",
    MODEL_PROVIDER: "opencode-go",
  };
  const app = createCloudApp({ store, env });
  assert.equal((await request(app, "/api/history")).status, 401);
  const account = JSON.parse(
    (await request(app, "/api/account", { cookie: "l2l_session=" + raw })).body,
  );
  assert.equal(account.localMode, false);
  assert.equal(account.user.id, user.id);
  assert.equal(
    (
      await request(app, "/api/generate", {
        method: "POST",
        origin: "https://evil.test",
      })
    ).status,
    403,
  );
  const missing = await request(app, "/api/generate", {
    method: "POST",
    cookie: "l2l_session=" + raw,
    body: { prompt: "x", referenceId: "notion" },
  });
  assert.equal(missing.status, 503);
  assert.equal((await store.user(user.id)).credits, 18);
  const logos = JSON.parse((await request(app, "/api/logos")).body);
  assert.ok(logos.logos.length > 1000);
  assert.equal(
    (await request(app, "/reference/notion.svg")).headers["content-type"],
    "image/svg+xml",
  );
  assert.equal((await request(app, "/reference/..%2F.env")).status, 404);
  assert.throws(() => cloudConfig({}), { code: "CLOUD_CONFIG_REQUIRED" });
  assert.throws(
    () =>
      cloudConfig({
        APP_URL: "https://logo.test",
        TURSO_DATABASE_URL: "file:db",
        TURSO_AUTH_TOKEN: "test",
      }),
    { code: "REMOTE_DATABASE_REQUIRED" },
  );
});

test("Vercel rewrites preserve OAuth queries and raw webhook bytes without starting a server", async () => {
  const { createHandler } = await import("../api/index.ts");
  const handler = createHandler(() => async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    res.end(
      JSON.stringify({ url: req.url, raw: Buffer.concat(chunks).toString() }),
    );
  });
  const oauth = await request(
    handler,
    "/api/index?__path=/api/auth/google/callback&code=abc&state=xyz",
  );
  assert.equal(
    JSON.parse(oauth.body).url,
    "/api/auth/google/callback?code=abc&state=xyz",
  );
  const raw = ' { "event": "test" }\n';
  const webhook = await request(
    handler,
    "/api/index?__path=/api/billing/webhook",
    { method: "POST", body: raw },
  );
  assert.equal(JSON.parse(webhook.body).raw, raw);
  assert.equal(JSON.parse(webhook.body).url, "/api/billing/webhook");
});
