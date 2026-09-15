import type { IncomingHttpHeaders } from "node:http";
import type { AccountStore, Environment, Order, Plan } from "./types.ts";
import { fault } from "./accounts.ts";
import { oauthFetch } from "./oauth-fetch.ts";

export const paypalEvents = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
];
type Money = { currency_code?: string; value?: string };
type Link = { href: string; rel: string };
export interface PayPalPayment {
  id: string;
  status?: string;
  amount?: Money;
  final_capture?: boolean;
  payee?: { merchant_id?: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
  seller_payable_breakdown?: { total_refunded_amount?: Money };
  links?: Link[];
}
export interface PayPalOrder {
  id: string;
  intent?: string;
  status?: string;
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    amount?: Money;
    payee?: { merchant_id?: string };
    payments?: {
      captures?: PayPalPayment[];
      refunds?: PayPalPayment[];
      authorizations?: unknown[];
    };
  }[];
  links?: Link[];
}
export type PayPalClient = ReturnType<typeof createPayPalClient>;

export function paypalConfigurationErrors(env: Environment) {
  const errors: string[] = [];
  if (!["sandbox", "live"].includes(env.PAYPAL_ENVIRONMENT || "sandbox"))
    errors.push("PAYPAL_ENVIRONMENT must be sandbox or live");
  for (const key of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"])
    if (!env[key]?.trim()) errors.push(`${key} is missing`);
  return errors;
}

// paypal.cn is the merchant onboarding portal. Checkout uses PayPal's global REST API.
export function createPayPalClient(env: Environment, fetcher = oauthFetch) {
  const base =
    env.PAYPAL_ENVIRONMENT === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  let cached: { value: string; expires: number } | undefined;
  let loading: Promise<string> | undefined;
  async function accessToken(): Promise<string> {
    if (paypalConfigurationErrors(env).length)
      throw fault("BILLING_UNAVAILABLE", 503);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (loading) return loading;
    loading = (async () => {
      const response = await fetcher(`${base}/v1/oauth2/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      if (!response.ok) throw fault("PAYPAL_AUTH_FAILED", 502);
      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!data.access_token || !Number.isFinite(data.expires_in))
        throw fault("PAYPAL_AUTH_FAILED", 502);
      cached = {
        value: data.access_token,
        expires: Date.now() + Math.max(0, data.expires_in! - 60) * 1000,
      };
      return cached.value;
    })();
    try {
      return await loading;
    } finally {
      loading = undefined;
    }
  }
  async function request<T>(
    path: string,
    body?: unknown,
    requestId?: string,
  ): Promise<T> {
    if (!/^\/v[12]\/[a-zA-Z0-9/-]+$/.test(path))
      throw fault("INVALID_PAYPAL_PATH");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetcher(base + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "content-type": "application/json",
          prefer: "return=representation",
          ...(requestId ? { "paypal-request-id": requestId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401 && attempt === 0) {
        cached = undefined;
        continue;
      }
      const data = (await response.json()) as {
        details?: { issue?: string }[];
      };
      if (!response.ok) {
        // Do not expose upstream credentials, payer data or raw responses in logs/errors.
        throw fault(
          data.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")
            ? "PAYPAL_ALREADY_CAPTURED"
            : "PAYPAL_REQUEST_FAILED",
          502,
        );
      }
      return data as T;
    }
    throw fault("PAYPAL_AUTH_FAILED", 502);
  }
  return { base, request, accessToken };
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{6,40}$/.test(value))
    throw fault("PAYMENT_MISMATCH");
  return value;
}
function cents(money?: Money): number {
  if (
    money?.currency_code !== "USD" ||
    !/^\d{1,10}(\.\d{1,2})?$/.test(money.value || "")
  )
    throw fault("PAYMENT_MISMATCH");
  const [whole, fraction = ""] = money!.value!.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function createPayPalBilling(
  env: Environment,
  accounts: AccountStore,
  injected?: PayPalClient,
) {
  const environment = env.PAYPAL_ENVIRONMENT || "sandbox";
  const live = environment === "live";
  const client = injected || createPayPalClient(env);
  const ready =
    !paypalConfigurationErrors(env).length &&
    /^[A-Z0-9]{6,40}$/.test(env.PAYPAL_MERCHANT_ID || "") &&
    /^[A-Za-z0-9-]{6,80}$/.test(env.PAYPAL_WEBHOOK_ID || "");
  const allowed = () => !live || env.PAYPAL_CHECKOUT_ENABLED === "true";
  const getOrder = async (id: string) => {
    const order = await client.request<PayPalOrder>(
      `/v2/checkout/orders/${identifier(id)}`,
    );
    if (order.id !== id) throw fault("PAYMENT_MISMATCH");
    return order;
  };
  const getCapture = async (id: string) => {
    const capture = await client.request<PayPalPayment>(
      `/v2/payments/captures/${identifier(id)}`,
    );
    if (capture.id !== id) throw fault("PAYMENT_MISMATCH");
    return capture;
  };

  function linkedId(links: Link[] | undefined, path: string) {
    const link = links?.find((l) => l.rel === "up");
    if (!link) throw fault("PAYMENT_MISMATCH");
    const url = new URL(link.href);
    if (
      ![
        client.base,
        live ? "https://api.paypal.com" : "https://api.sandbox.paypal.com",
      ].includes(url.origin) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(path)
    )
      throw fault("PAYMENT_MISMATCH");
    return identifier(url.pathname.slice(path.length));
  }
  async function validate(
    order: PayPalOrder,
    expectedUser?: string,
  ): Promise<Order | null> {
    const units = order.purchase_units;
    if (!units?.some((u) => u.custom_id?.startsWith("logo2logo:"))) return null;
    if (order.intent !== "CAPTURE" || units.length !== 1)
      throw fault("PAYMENT_MISMATCH");
    const unit = units[0],
      userId = unit.custom_id!.slice("logo2logo:".length);
    if (expectedUser && userId !== expectedUser)
      throw fault("ORDER_NOT_FOUND", 404);
    const local = await accounts.checkoutOrder(identifier(order.id), userId);
    if (
      !local ||
      local.id !== unit.reference_id ||
      unit.invoice_id !== `logo2logo-${local.id}` ||
      unit.payee?.merchant_id !== env.PAYPAL_MERCHANT_ID ||
      local.amount !== cents(unit.amount) ||
      local.currency !== "usd" ||
      unit.payments?.authorizations?.length
    )
      throw fault("PAYMENT_MISMATCH");
    return local;
  }
  async function reconcile(
    order: PayPalOrder,
    expectedCapture?: string,
    refund?: PayPalPayment,
    reversed = false,
  ) {
    const local = await validate(order);
    if (!local) return;
    const payments = order.purchase_units![0].payments;
    const captures = payments?.captures || [];
    if (!captures.length && !expectedCapture) return;
    if (
      captures.length !== 1 ||
      (expectedCapture && captures[0].id !== expectedCapture)
    )
      throw fault("PAYMENT_MISMATCH");
    const capture = await getCapture(captures[0].id);
    if (
      capture.id !== captures[0].id ||
      cents(capture.amount) !== local.amount ||
      capture.final_capture !== true ||
      (capture.payee && capture.payee.merchant_id !== env.PAYPAL_MERCHANT_ID) ||
      (capture.supplementary_data?.related_ids?.order_id &&
        capture.supplementary_data.related_ids.order_id !== order.id)
    )
      throw fault("PAYMENT_MISMATCH");

    // Reconcile a cumulative refund snapshot under one ledger key. Older snapshots
    // cannot restore credits; an event arriving before fulfillment is safe too.
    const refunds = new Map<string, PayPalPayment>();
    for (const item of payments?.refunds || [])
      refunds.set(identifier(item.id), item);
    if (refund) refunds.set(identifier(refund.id), refund);
    let total = 0;
    for (const item of refunds.values()) {
      if (item.status !== "COMPLETED") continue;
      total += cents(item.amount);
    }
    const cumulative = refund?.seller_payable_breakdown?.total_refunded_amount;
    if (refund?.status === "COMPLETED" && cumulative)
      total = Math.max(total, cents(cumulative));
    if (capture.status === "REFUNDED" || reversed) total = local.amount;
    if (total > local.amount) throw fault("PAYMENT_MISMATCH");
    if (capture.status === "PARTIALLY_REFUNDED" && total === 0)
      throw fault("PAYPAL_REFUND_PENDING", 503);
    if (total)
      await accounts.refund({
        id: `paypal:${capture.id}`,
        session: order.id,
        amount: total,
        cumulative: true,
      });
    if (
      !reversed &&
      order.status === "COMPLETED" &&
      ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
        capture.status || "",
      )
    ) {
      await accounts.fulfill({
        id: order.id,
        orderId: local.id,
        userId: local.user_id,
        status: "completed",
        currency: "USD",
        amount: local.amount,
      });
    }
  }
  async function captureOrder(id: string, userId?: string) {
    if (!ready) throw fault("BILLING_UNAVAILABLE", 503);
    if (userId && !(await accounts.checkoutOrder(identifier(id), userId)))
      throw fault("ORDER_NOT_FOUND", 404);
    let order = await getOrder(id);
    if (!(await validate(order, userId))) {
      if (userId) throw fault("ORDER_NOT_FOUND", 404);
      return;
    }
    if (order.status === "APPROVED") {
      try {
        await client.request<PayPalOrder>(
          `/v2/checkout/orders/${identifier(id)}/capture`,
          {},
          `capture-${id}`,
        );
      } catch (error) {
        if ((error as { code?: string }).code !== "PAYPAL_ALREADY_CAPTURED")
          throw error;
      }
      order = await getOrder(id);
    }
    await reconcile(order);
  }
  return {
    environment,
    live,
    ready,
    allowed,
    client,
    capture: captureOrder,
    async checkout(
      userId: string,
      plan: Plan,
      origin: string,
      locale: unknown,
    ) {
      if (!ready || !allowed()) throw fault("BILLING_UNAVAILABLE", 503);
      const localId = await accounts.order(userId, plan);
      const amount = {
        currency_code: "USD",
        value: (plan.amount / 100).toFixed(2),
      };
      const order = await client.request<PayPalOrder>(
        "/v2/checkout/orders",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: localId,
              custom_id: `logo2logo:${userId}`,
              invoice_id: `logo2logo-${localId}`,
              description: `Logo2logo ${plan.name} — ${plan.credits} logo generation credits`,
              payee: { merchant_id: env.PAYPAL_MERCHANT_ID },
              amount: { ...amount, breakdown: { item_total: amount } },
              items: [
                {
                  name: `Logo2logo ${plan.name}`,
                  sku: plan.id,
                  quantity: "1",
                  category: "DIGITAL_GOODS",
                  unit_amount: amount,
                },
              ],
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Logo2logo",
                locale: locale === "zh" ? "zh-CN" : "en-US",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                return_url: `${origin}/?checkout=approved`,
                cancel_url: `${origin}/?checkout=cancelled#pricing`,
              },
            },
          },
        },
        localId,
      );
      identifier(order.id);
      const link = order.links?.find(
        (l) => l.rel === "payer-action" || l.rel === "approve",
      );
      if (!link) throw fault("BILLING_UNAVAILABLE", 503);
      const url = new URL(link.href);
      if (
        url.origin !==
          (live
            ? "https://www.paypal.com"
            : "https://www.sandbox.paypal.com") ||
        url.username ||
        url.password ||
        url.pathname !== "/checkoutnow" ||
        url.searchParams.get("token") !== order.id
      )
        throw fault("PAYMENT_MISMATCH");
      await accounts.setCheckout(localId, order.id);
      return url.href;
    },
    async webhook(body: Buffer, headers: IncomingHttpHeaders) {
      if (!ready) throw fault("BILLING_UNAVAILABLE", 503);
      const fields = [
        "auth-algo",
        "cert-url",
        "transmission-id",
        "transmission-sig",
        "transmission-time",
      ];
      const signature: Record<string, string> = {};
      for (const name of fields) {
        const value = headers[`paypal-${name}`];
        if (typeof value !== "string" || !value || value.length > 2048)
          throw fault("INVALID_SIGNATURE");
        signature[name.replaceAll("-", "_")] = value;
      }
      let event: { event_type?: string; resource?: PayPalPayment };
      try {
        event = JSON.parse(body.toString("utf8"));
      } catch {
        throw fault("INVALID_SIGNATURE");
      }
      if (
        !event ||
        typeof event !== "object" ||
        !event.event_type ||
        !event.resource
      )
        throw fault("INVALID_SIGNATURE");
      const verification = await client.request<{
        verification_status: string;
      }>("/v1/notifications/verify-webhook-signature", {
        ...signature,
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      });
      if (verification.verification_status !== "SUCCESS")
        throw fault("INVALID_SIGNATURE");
      if (!paypalEvents.includes(event.event_type)) return;
      const id = identifier(event.resource.id);
      if (event.event_type === "CHECKOUT.ORDER.APPROVED")
        return captureOrder(id);
      let capture: PayPalPayment, refund: PayPalPayment | undefined;
      if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
        refund = await client.request<PayPalPayment>(
          `/v2/payments/refunds/${id}`,
        );
        if (refund.id !== id) throw fault("PAYMENT_MISMATCH");
        if (refund.status !== "COMPLETED") return;
        capture = await getCapture(
          linkedId(refund.links, "/v2/payments/captures/"),
        );
      } else capture = await getCapture(id);
      const orderId =
        capture.supplementary_data?.related_ids?.order_id ||
        linkedId(capture.links, "/v2/checkout/orders/");
      await reconcile(
        await getOrder(orderId),
        capture.id,
        refund,
        event.event_type === "PAYMENT.CAPTURE.REVERSED",
      );
    },
  };
}
