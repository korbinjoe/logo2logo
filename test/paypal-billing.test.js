import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccounts } from "../lib/accounts.ts";
import { createClient } from "@libsql/client";
import { createRemoteAccounts } from "../lib/remote-accounts.ts";
import { createCommerce, plans } from "../lib/commerce.ts";
import { createCloudApp } from "../lib/cloud-app.ts";
import {
  createPayPalBilling,
  createPayPalClient,
} from "../lib/paypal-billing.ts";

const env = {
  APP_URL: "https://logo.example",
  GOOGLE_CLIENT_ID: "oauth-id",
  GOOGLE_CLIENT_SECRET: "oauth-secret",
  PAYPAL_ENVIRONMENT: "sandbox",
  PAYPAL_CLIENT_ID: "sandbox-client",
  PAYPAL_CLIENT_SECRET: "sandbox-secret",
  PAYPAL_MERCHANT_ID: "MERCHANT12345",
  PAYPAL_WEBHOOK_ID: "WEBHOOK12345",
  PAYPAL_CHECKOUT_ENABLED: "false",
};
const money = (value) => ({ currency_code: "USD", value });
const orderId = "5O190127TN364715T",
  captureId = "74L756601X447022Y";
const signature = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url":
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  "paypal-transmission-id": "transmission-1",
  "paypal-transmission-time": "2026-09-15T00:00:00Z",
  "paypal-transmission-sig": "verified-fixture",
};
async function request(
  commerce,
  path,
  { method = "GET", headers = {}, body = "" } = {},
) {
  const req = Readable.from([
    Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  ]);
  Object.assign(req, { method, url: path, headers });
  const result = { status: 0, body: "", headers: {} };
  const res = {
    setHeader(k, v) {
      result.headers[k] = v;
    },
    writeHead(status, h) {
      result.status = status;
      Object.assign(result.headers, h);
    },
    end(body) {
      result.body = body || "";
    },
  };
  const read = async (r) => {
    const chunks = [];
    for await (const c of r) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks));
  };
  if (typeof commerce === "function") await commerce(req, res);
  else result.handled = await commerce.handle(req, res, read);
  result.status = res.statusCode || result.status;
  return result;
}
async function fixture(t, remote = false) {
  let store;
  if (remote) {
    const dir = await mkdtemp(join(tmpdir(), "logo-paypal-"));
    store = createRemoteAccounts({
      client: createClient({ url: "file:" + join(dir, "accounts.sqlite") }),
    });
    const schema = await readFile(
      new URL("../migrations/001-initial.sql", import.meta.url),
      "utf8",
    );
    await store.db.batch(
      schema.split(";").filter((s) => s.trim()),
      "write",
    );
    t.after(async () => {
      store.close();
      await rm(dir, { recursive: true, force: true });
    });
  } else {
    store = createAccounts(":memory:");
    t.after(() => store.close());
  }
  const user = await store.identify("google", "alice", "Alice");
  await store.grantWelcomeCredits(user.id);
  const cookie = `l2l_session=${await store.session(user.id)}`;
  const state = {
    order: null,
    capture: null,
    refunds: new Map(),
    calls: [],
    captureCalls: 0,
    failCapture: false,
    approvalURL: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
  };
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(
      url.startsWith("https://api-m.sandbox.paypal.com/"),
      "credentials never reach another host",
    );
    const path = new URL(url).pathname,
      input =
        options.body && path !== "/v1/oauth2/token"
          ? JSON.parse(options.body)
          : undefined;
    state.calls.push({ path, options, input });
    if (path === "/v1/oauth2/token") {
      assert.equal(
        options.headers.authorization,
        `Basic ${Buffer.from("sandbox-client:sandbox-secret").toString("base64")}`,
      );
      assert.equal(options.body, "grant_type=client_credentials");
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    assert.equal(options.headers.authorization, "Bearer test-token");
    if (path === "/v2/checkout/orders") {
      state.order = {
        ...input,
        id: orderId,
        status: "PAYER_ACTION_REQUIRED",
        links: [{ rel: "payer-action", href: state.approvalURL }],
      };
      state.capture = {
        id: captureId,
        status: "COMPLETED",
        final_capture: true,
        amount: money("12.00"),
        supplementary_data: { related_ids: { order_id: orderId } },
        payee: { merchant_id: env.PAYPAL_MERCHANT_ID },
      };
      return Response.json(state.order, { status: 201 });
    }
    if (path === `/v2/checkout/orders/${orderId}`)
      return Response.json(state.order);
    if (path === `/v2/checkout/orders/${orderId}/capture`) {
      state.captureCalls++;
      assert.equal(options.headers["paypal-request-id"], `capture-${orderId}`);
      state.order.status = "COMPLETED";
      state.order.purchase_units[0].payments ||= {
        captures: [state.capture],
        refunds: [],
      };
      if (state.failCapture)
        return Response.json(
          { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] },
          { status: 422 },
        );
      return Response.json(state.order, { status: 201 });
    }
    if (path === `/v2/payments/captures/${captureId}`)
      return Response.json(state.capture);
    if (path.startsWith("/v2/payments/refunds/"))
      return Response.json(state.refunds.get(path.split("/").at(-1)));
    if (path === "/v1/notifications/verify-webhook-signature") {
      assert.equal(input.webhook_id, env.PAYPAL_WEBHOOK_ID);
      return Response.json({
        verification_status:
          input.transmission_sig === "verified-fixture" ? "SUCCESS" : "FAILURE",
      });
    }
    throw Error(`Unexpected PayPal API call: ${path}`);
  };
  const client = createPayPalClient(env, fetcher);
  const commerce = createCommerce({ env, store, paypalClient: client });
  const buy = () =>
    request(commerce, "/api/billing/checkout", {
      method: "POST",
      headers: { cookie },
      body: { plan: "starter", amount: 1, credits: 999 },
    });
  const capture = () =>
    request(commerce, "/api/billing/capture", {
      method: "POST",
      headers: { cookie },
      body: { orderId },
    });
  const event = (type, id = captureId, headers = signature) =>
    request(commerce, "/api/billing/webhook", {
      method: "POST",
      headers,
      body: { id: "EVENT123", event_type: type, resource: { id } },
    });
  function paid() {
    state.order.status = "COMPLETED";
    state.order.purchase_units[0].payments = {
      captures: [state.capture],
      refunds: [],
    };
  }
  function refund(id, value, total, status = "COMPLETED") {
    const r = {
      id,
      amount: money(value),
      status,
      seller_payable_breakdown: { total_refunded_amount: money(total) },
      links: [
        {
          rel: "up",
          href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`,
        },
      ],
    };
    state.refunds.set(id, r);
    state.order.purchase_units[0].payments.refunds.push(r);
    if (status === "COMPLETED")
      state.capture.status =
        total === "12.00" ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return r;
  }
  return {
    store,
    user,
    cookie,
    state,
    client,
    commerce,
    buy,
    capture,
    event,
    paid,
    refund,
    balance: async () => (await store.user(user.id)).credits,
  };
}

test("PayPal checkout uses server price, digital goods, fixed merchant and validated approval URL", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    request(f.commerce, "/api/billing/checkout", {
      method: "POST",
      body: { plan: "starter" },
    }),
    { code: "AUTH_REQUIRED" },
  );
  await assert.rejects(
    request(f.commerce, "/api/billing/checkout", {
      method: "POST",
      headers: { cookie: f.cookie },
      body: { plan: "unknown" },
    }),
    { code: "INVALID_PLAN" },
  );
  const result = await f.buy();
  assert.equal(JSON.parse(result.body).url, f.state.approvalURL);
  const call = f.state.calls.find((c) => c.path === "/v2/checkout/orders"),
    unit = call.input.purchase_units[0];
  assert.equal(unit.amount.value, "12.00");
  assert.equal(unit.items[0].category, "DIGITAL_GOODS");
  assert.equal(unit.items[0].quantity, "1");
  assert.equal(unit.payee.merchant_id, env.PAYPAL_MERCHANT_ID);
  assert.equal(call.options.headers["paypal-request-id"], unit.reference_id);
  assert.equal(unit.custom_id, `logo2logo:${f.user.id}`);
  assert.equal(
    call.input.payment_source.paypal.experience_context.return_url,
    "https://logo.example/?checkout=approved",
  );
  const account = JSON.parse((await request(f.commerce, "/api/account")).body);
  assert.equal(account.paymentProvider, "paypal");
  assert.equal(account.paymentEnvironment, "sandbox");
  assert.equal(account.billingReady, true);
  assert.ok(!JSON.stringify(account).includes("sandbox-secret"));
  await request(f.commerce, `/?checkout=success&session_id=${orderId}`);
  assert.equal(
    JSON.parse(
      (
        await request(f.commerce, `/api/billing/status?session_id=${orderId}`, {
          headers: { cookie: f.cookie },
        })
      ).body,
    ).paid,
    false,
  );
  assert.equal(await f.balance(), 3);
});

for (const remote of [false, true])
  test(`capture + webhook replay + partial/full refunds are idempotent (${remote ? "libSQL" : "SQLite"})`, async (t) => {
    const f = await fixture(t, remote);
    await f.buy();
    // Returning before buyer approval cannot capture or grant credits.
    assert.equal(JSON.parse((await f.capture()).body).paid, false);
    assert.equal(f.state.captureCalls, 0);
    f.state.order.status = "APPROVED";
    assert.equal(JSON.parse((await f.capture()).body).paid, true);
    assert.equal(await f.balance(), 21);
    await f.capture();
    await f.event("PAYMENT.CAPTURE.COMPLETED");
    assert.equal(f.state.captureCalls, 1);
    assert.equal(await f.balance(), 21);
    f.refund("REFUND0001", "6.00", "6.00");
    await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001");
    assert.equal(await f.balance(), 12);
    await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001");
    assert.equal(await f.balance(), 12);
    f.refund("REFUND0002", "6.00", "12.00");
    await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0002");
    assert.equal(await f.balance(), 3);
    await f.event("PAYMENT.CAPTURE.COMPLETED");
    await f.capture();
    assert.equal(await f.balance(), 3);
    f.state.capture.status = "PARTIALLY_REFUNDED";
    f.state.order.purchase_units[0].payments.refunds.pop();
    await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001");
    assert.equal(
      await f.balance(),
      3,
      "older snapshot must not restore credits",
    );
  });

test("approved webhook recovers abandoned return; already captured response is reconciled", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.state.order.status = "APPROVED";
  f.state.failCapture = true;
  await f.event("CHECKOUT.ORDER.APPROVED", orderId);
  assert.equal(await f.balance(), 21);
  await f.event("CHECKOUT.ORDER.APPROVED", orderId);
  assert.equal(await f.balance(), 21);
});

test("capture ownership is checked before PayPal is called", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.state.order.status = "APPROVED";
  const bob = await f.store.identify("github", "bob", "Bob");
  const before = f.state.calls.length;
  await assert.rejects(
    request(f.commerce, "/api/billing/capture", {
      method: "POST",
      headers: { cookie: `l2l_session=${await f.store.session(bob.id)}` },
      body: { orderId },
    }),
    { code: "ORDER_NOT_FOUND" },
  );
  await assert.rejects(
    request(f.commerce, "/api/billing/capture", {
      method: "POST",
      body: { orderId },
    }),
    { code: "AUTH_REQUIRED" },
  );
  assert.equal(f.state.calls.length, before);
  assert.equal(await f.balance(), 3);
});

test("webhook verification is mandatory; forged or mismatched notifications grant nothing", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.paid();
  await assert.rejects(f.event("PAYMENT.CAPTURE.COMPLETED", captureId, {}), {
    code: "INVALID_SIGNATURE",
  });
  await assert.rejects(
    f.event("PAYMENT.CAPTURE.COMPLETED", captureId, {
      ...signature,
      "paypal-transmission-sig": "forged",
    }),
    { code: "INVALID_SIGNATURE" },
  );
  assert.equal(await f.balance(), 3);
  const patches = [
    () => (f.state.order.purchase_units[0].amount = money("0.01")),
    () => (f.state.order.purchase_units[0].amount.currency_code = "EUR"),
    () => (f.state.order.purchase_units[0].payee.merchant_id = "OTHER12345"),
    () => (f.state.order.purchase_units[0].reference_id = "unrelated-order"),
    () => (f.state.order.purchase_units[0].custom_id = "logo2logo:other-user"),
    () => (f.state.capture.amount = money("0.01")),
    () => (f.state.capture.final_capture = false),
    () =>
      f.state.order.purchase_units[0].payments.captures.push({
        ...f.state.capture,
        id: "OTHER12345",
      }),
  ];
  for (const patch of patches) {
    const saved = structuredClone({
      order: f.state.order,
      capture: f.state.capture,
    });
    patch();
    await assert.rejects(f.event("PAYMENT.CAPTURE.COMPLETED"), {
      code: "PAYMENT_MISMATCH",
    });
    Object.assign(f.state, saved);
    assert.equal(await f.balance(), 3);
  }
});

test("pending and denied captures do not fulfill; delayed completed payment does", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.paid();
  for (const status of ["PENDING", "DECLINED", "FAILED"]) {
    f.state.capture.status = status;
    await f.event("PAYMENT.CAPTURE.COMPLETED");
    assert.equal(await f.balance(), 3);
  }
  f.state.capture.status = "COMPLETED";
  await f.event("PAYMENT.CAPTURE.COMPLETED");
  assert.equal(await f.balance(), 21);
});

test("refund before payment, fractional refunds and reversal revoke credits exactly once", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.paid();
  f.refund("REFUND0001", "0.01", "0.01");
  await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001");
  assert.equal(await f.balance(), 20);
  f.refund("REFUND0002", "5.99", "6.00");
  await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0002");
  assert.equal(await f.balance(), 12);
  await f.event("PAYMENT.CAPTURE.REVERSED");
  assert.equal(await f.balance(), 3);
  await f.event("PAYMENT.CAPTURE.REVERSED");
  await f.event("PAYMENT.CAPTURE.COMPLETED");
  assert.equal(await f.balance(), 3);
});

test("refund binding, currency, amount and completion are validated", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.paid();
  await f.event("PAYMENT.CAPTURE.COMPLETED");
  const refund = f.refund("REFUND0001", "6.00", "6.00", "PENDING");
  await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001");
  assert.equal(await f.balance(), 21);
  refund.status = "COMPLETED";
  refund.links[0].href = `https://evil.example/v2/payments/captures/${captureId}`;
  await assert.rejects(f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001"), {
    code: "PAYMENT_MISMATCH",
  });
  refund.links[0].href = `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`;
  refund.amount.currency_code = "EUR";
  await assert.rejects(f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001"), {
    code: "PAYMENT_MISMATCH",
  });
  refund.amount = money("13.00");
  await assert.rejects(f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001"), {
    code: "PAYMENT_MISMATCH",
  });
  assert.equal(await f.balance(), 21);
});

test("unrelated product events are ignored", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.paid();
  f.state.order.purchase_units[0].custom_id = "another-app";
  await f.event("PAYMENT.CAPTURE.COMPLETED");
  await f.event("CHECKOUT.ORDER.APPROVED", orderId);
  assert.equal(await f.balance(), 3);
  assert.equal(f.state.captureCalls, 0);
});

test("refund links accept the official sandbox alias but reject live hosts", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.paid();
  await f.event("PAYMENT.CAPTURE.COMPLETED");
  const refund = f.refund("REFUND0001", "6.00", "6.00");
  for (const host of ["api.paypal.com", "api-m.paypal.com"]) {
    refund.links[0].href = `https://${host}/v2/payments/captures/${captureId}`;
    await assert.rejects(f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001"), {
      code: "PAYMENT_MISMATCH",
    });
    assert.equal(await f.balance(), 21);
  }
  refund.links[0].href = `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}`;
  await f.event("PAYMENT.CAPTURE.REFUNDED", "REFUND0001");
  assert.equal(await f.balance(), 12);
});

test("missing configuration and live launch gate disable checkout; redirects cannot leave PayPal", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { PAYPAL_CLIENT_ID: "" },
    { PAYPAL_CLIENT_SECRET: "" },
    { PAYPAL_WEBHOOK_ID: "" },
    { PAYPAL_MERCHANT_ID: "" },
    { PAYPAL_ENVIRONMENT: "typo" },
  ]) {
    const billing = createPayPalBilling(
      { ...env, ...patch },
      f.store,
      f.client,
    );
    assert.equal(billing.ready, false);
    await assert.rejects(
      billing.checkout(f.user.id, plans[0], env.APP_URL, "en"),
      { code: "BILLING_UNAVAILABLE" },
    );
  }
  const live = createPayPalBilling(
    { ...env, PAYPAL_ENVIRONMENT: "live" },
    f.store,
    f.client,
  );
  assert.equal(live.allowed(), false);
  await assert.rejects(live.checkout(f.user.id, plans[0], env.APP_URL, "en"), {
    code: "BILLING_UNAVAILABLE",
  });
  assert.equal(
    createPayPalBilling(
      { ...env, PAYPAL_ENVIRONMENT: "live", PAYPAL_CHECKOUT_ENABLED: "true" },
      f.store,
    ).allowed(),
    true,
  );
  for (const url of [
    "https://evil.example",
    `https://www.paypal.com/checkoutnow?token=${orderId}`,
    "https://www.sandbox.paypal.com/checkoutnow?token=OTHERORDER",
    `https://evil@www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
  ]) {
    f.state.approvalURL = url;
    await assert.rejects(f.buy(), { code: "PAYMENT_MISMATCH" });
  }
});

test("cloud adapter protects capture against CSRF while accepting verified webhooks", async (t) => {
  const f = await fixture(t);
  await f.buy();
  f.state.order.status = "APPROVED";
  const app = createCloudApp({
    env,
    store: f.store,
    commerceOptions: { paypalClient: f.client },
  });
  const bad = await request(app, "/api/billing/capture", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://evil.example" },
    body: { orderId },
  });
  assert.equal(bad.status, 403);
  assert.equal(f.state.captureCalls, 0);
  const good = await request(app, "/api/billing/capture", {
    method: "POST",
    headers: { cookie: f.cookie, origin: env.APP_URL },
    body: { orderId },
  });
  assert.equal(good.status, 200);
  assert.equal(JSON.parse(good.body).paid, true);
  const webhook = await request(app, "/api/billing/webhook", {
    method: "POST",
    headers: signature,
    body: {
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: captureId },
    },
  });
  assert.equal(webhook.status, 200);
  assert.equal(await f.balance(), 21);
});

test("PayPal client switches API hosts by environment and refreshes an expired token", async () => {
  let tokenCalls = 0,
    requestCalls = 0;
  const client = createPayPalClient(
    { ...env, PAYPAL_ENVIRONMENT: "live" },
    async (url, options) => {
      assert.ok(url.startsWith("https://api-m.paypal.com/"));
      if (url.endsWith("/token")) {
        tokenCalls++;
        return Response.json({
          access_token: `token-${tokenCalls}`,
          expires_in: 3600,
        });
      }
      requestCalls++;
      if (requestCalls === 1) return Response.json({}, { status: 401 });
      assert.equal(options.headers.authorization, "Bearer token-2");
      return Response.json({ id: orderId });
    },
  );
  assert.equal(
    (await client.request(`/v2/checkout/orders/${orderId}`)).id,
    orderId,
  );
  assert.equal(tokenCalls, 2);
  await client.request(`/v2/checkout/orders/${orderId}`);
  assert.equal(tokenCalls, 2);
  await assert.rejects(client.request("https://evil.example"), {
    code: "INVALID_PAYPAL_PATH",
  });
});
