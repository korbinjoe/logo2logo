import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestInit } from "undici";
import type { AccountStore, Environment as Env } from "./types.ts";
export interface CommerceOptions {
  env?: Env;
  store?: AccountStore;
  fetcher?: typeof oauthFetch;
  paddleClient?: Paddle;
}
export type ReadBody = <T extends object = Record<string, unknown>>(
  req: IncomingMessage,
  limit?: number,
) => Promise<T>;
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { createHash } from "node:crypto";
import { createAccounts, token, fault } from "./accounts.ts";
import { oauthFetch } from "./oauth-fetch.ts";

export const plans = Object.freeze([
  { id: "starter", name: "Starter", amount: 1200, credits: 18 },
  { id: "creator", name: "Creator", amount: 2400, credits: 60 },
  { id: "studio", name: "Studio", amount: 5900, credits: 180 },
]);
const providerInfo = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    profile: "https://api.github.com/user",
    scope: "read:user",
  },
};
function cookie(req: IncomingMessage, name: string) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export function createCommerce({
  env = process.env,
  store,
  fetcher = oauthFetch,
  paddleClient,
}: CommerceOptions = {}) {
  const origin = new URL(env.APP_URL || `http://127.0.0.1:${env.PORT || 4173}`)
    .origin;
  const secure = origin.startsWith("https:");
  const localMode =
    env.BILLING_REQUIRED === "false" &&
    env.NODE_ENV !== "production" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
  store ||= createAccounts(env.ACCOUNTS_DB || ".runtime/accounts.sqlite");
  const environment =
    env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
  const paddle =
    paddleClient ||
    (env.PADDLE_API_KEY
      ? new Paddle(env.PADDLE_API_KEY, {
          environment:
            environment === "production"
              ? Environment.production
              : Environment.sandbox,
        })
      : null);
  const providers = Object.keys(providerInfo).map((id) => ({
    id,
    enabled: Boolean(
      env[id.toUpperCase() + "_CLIENT_ID"]! &&
      env[id.toUpperCase() + "_CLIENT_SECRET"]!,
    ),
  }));
  const ready = Boolean(
    paddle &&
    env.PADDLE_WEBHOOK_SECRET &&
    env.PADDLE_CLIENT_TOKEN &&
    plans.every((p) => env["PADDLE_PRICE_" + p.id.toUpperCase()]) &&
    providers.some((p) => p.enabled),
  );
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const redirect = (res: ServerResponse, path: string) => {
    res.writeHead(303, {
      location: path,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };
  const setCookie = (
    res: ServerResponse,
    name: string,
    value: string,
    age: number,
  ) =>
    res.setHeader(
      "set-cookie",
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`,
    );
  const accounts = store;
  const user = (req: IncomingMessage) =>
    accounts.authenticate(cookie(req, "l2l_session"));
  async function requireUser(req: IncomingMessage) {
    const account = await user(req);
    if (!account) throw fault("AUTH_REQUIRED", 401);
    return account;
  }
  async function authorize(req: IncomingMessage, count = 1) {
    if (localMode) return null;
    const account = await requireUser(req);
    await accounts.requireCredits(account.id, count);
    return account;
  }
  async function providerJSON(
    url: string,
    options: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw fault("AUTH_FAILED", 502);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw fault("AUTH_FAILED", 502);
    return data as Record<string, unknown>;
  }
  const socials = socialLinks(env);
  return {
    store,
    origin,
    localMode,
    authorize,
    requireUser,
    async own(req: IncomingMessage, id: string) {
      if (localMode) return;
      const account = await requireUser(req);
      if (!(await accounts.owns(account.id, id)))
        throw fault("OUTPUT_NOT_FOUND", 404);
    },
    async handle(
      req: IncomingMessage,
      res: ServerResponse,
      readBody: ReadBody,
    ) {
      const url = new URL(req.url || "/", origin),
        route = url.pathname;
      if (req.method === "GET" && route === "/api/account") {
        const account = await user(req);
        send(res, 200, {
          user: account,
          designs: account ? await accounts.designs(account.id) : [],
          providers,
          billingReady: ready,
          localMode,
          plans,
          socials,
          paymentEnvironment: environment,
        });
        return true;
      }
      if (req.method === "POST" && route === "/api/auth/logout") {
        await accounts.logout(cookie(req, "l2l_session"));
        setCookie(res, "l2l_session", "", 0);
        send(res, 200, { ok: true });
        return true;
      }
      const auth = route.match(/^\/api\/auth\/(google|github)(\/callback)?$/);
      if (req.method === "GET" && auth) {
        const id = auth[1] as keyof typeof providerInfo,
          provider = providerInfo[id],
          callback = `${origin}/api/auth/${id}/callback`;
        if (!providers.find((p) => p.id === id)?.enabled) {
          redirect(res, "/?auth=unavailable");
          return true;
        }
        if (!auth[2]) {
          const browser = token(),
            { state, verifier } = await accounts.startOAuth(id, browser);
          const target = new URL(provider.authorize);
          target.search = new URLSearchParams({
            client_id: env[id.toUpperCase() + "_CLIENT_ID"]!,
            redirect_uri: callback,
            response_type: "code",
            scope: provider.scope,
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
          }).toString();
          setCookie(res, "l2l_oauth", browser, 600);
          redirect(res, target.href);
          return true;
        }
        try {
          const verifier = await accounts.finishOAuth(
            url.searchParams.get("state") || "",
            cookie(req, "l2l_oauth"),
            id,
          );
          if (url.searchParams.has("error")) throw fault("AUTH_CANCELLED");
          const code = url.searchParams.get("code");
          if (!code) throw fault("AUTH_FAILED");
          const credentials = await providerJSON(provider.token, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_id: env[id.toUpperCase() + "_CLIENT_ID"]!,
              client_secret: env[id.toUpperCase() + "_CLIENT_SECRET"]!,
              code,
              code_verifier: verifier,
              grant_type: "authorization_code",
              redirect_uri: callback,
            }),
          });
          if (!credentials.access_token) throw fault("AUTH_FAILED");
          const profile = await providerJSON(provider.profile, {
            headers: {
              authorization: `Bearer ${credentials.access_token}`,
              accept: "application/json",
              "user-agent": "Logo2logo",
            },
          });
          const subject = id === "google" ? profile.sub : profile.id;
          if (!subject || !["string", "number"].includes(typeof subject))
            throw fault("AUTH_FAILED");
          const account = await accounts.identify(
            id,
            String(subject),
            String(profile.name || profile.login || "Creator").slice(0, 100),
          );
          await accounts.logout(cookie(req, "l2l_session"));
          setCookie(
            res,
            "l2l_session",
            await accounts.session(account.id),
            30 * 86400,
          );
          redirect(res, "/?auth=success");
        } catch {
          setCookie(res, "l2l_oauth", "", 0);
          redirect(res, "/?auth=failed");
        }
        return true;
      }
      if (req.method === "POST" && route === "/api/billing/checkout") {
        const account = await requireUser(req);
        if (!ready || !paddle) throw fault("BILLING_UNAVAILABLE", 503);
        await accounts.limitPlanning(account.id + ":checkout");
        const input = await readBody(req),
          plan = plans.find((p) => p.id === input.plan);
        if (!plan) throw fault("INVALID_PLAN");
        const orderId = await accounts.order(account.id, plan);
        const priceId = env["PADDLE_PRICE_" + plan.id.toUpperCase()]!;
        const price = await paddle.prices.get(priceId);
        if (
          price.status !== "active" ||
          price.billingCycle ||
          price.unitPrice.currencyCode !== "USD" ||
          Number(price.unitPrice.amount) !== plan.amount ||
          price.taxMode !== "external" ||
          price.unitPriceOverrides.length
        )
          throw fault("PRICE_NOT_CONFIGURED", 503);
        const checkout = await paddle.transactions.create({
          items: [{ priceId, quantity: 1 }],
          currencyCode: "USD",
          collectionMode: "automatic",
          customData: { orderId, userId: account.id },
          checkout: { url: `${origin}/checkout.html` },
        });
        await accounts.setCheckout(orderId, checkout.id);
        send(res, 200, {
          url: `/checkout.html?transaction_id=${encodeURIComponent(checkout.id)}&locale=${input.locale === "zh" ? "zh" : "en"}`,
        });
        return true;
      }
      if (req.method === "GET" && route === "/api/billing/status") {
        const account = await requireUser(req),
          session = url.searchParams.get("session_id");
        const order = await accounts.checkoutOrder(session, account.id);
        if (!order) throw fault("ORDER_NOT_FOUND", 404);
        // The signed webhook is the only path that grants credits.
        send(res, 200, {
          paid: Boolean(order.paid),
          credits: (await accounts.user(account.id))!.credits,
        });
        return true;
      }
      if (req.method === "GET" && route === "/api/billing/config") {
        const account = await requireUser(req),
          transactionId = url.searchParams.get("transaction_id");
        if (!(await accounts.checkoutOrder(transactionId, account.id)))
          throw fault("ORDER_NOT_FOUND", 404);
        if (!ready || !paddle) throw fault("BILLING_UNAVAILABLE", 503);
        send(res, 200, {
          token: env.PADDLE_CLIENT_TOKEN,
          environment,
          transactionId,
        });
        return true;
      }
      if (req.method === "POST" && route === "/api/billing/webhook") {
        if (!paddle || !env.PADDLE_WEBHOOK_SECRET)
          throw fault("BILLING_UNAVAILABLE", 503);
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1_000_000) throw fault("PAYLOAD_TOO_LARGE", 413);
          chunks.push(chunk);
        }
        let event;
        try {
          event = await paddle.webhooks.unmarshal(
            Buffer.concat(chunks).toString("utf8"),
            env.PADDLE_WEBHOOK_SECRET,
            String(req.headers["paddle-signature"] || ""),
          );
        } catch {
          throw fault("INVALID_SIGNATURE");
        }

        if (event.eventType === "transaction.completed") {
          const data = event.data;
          const plan = plans.find(
            (p) =>
              env["PADDLE_PRICE_" + p.id.toUpperCase()] ===
              data.items?.[0]?.price?.id,
          );
          if (
            !plan ||
            data.items.length !== 1 ||
            data.items[0].quantity !== 1 ||
            data.subscriptionId ||
            data.discountId ||
            Number(data.details?.totals?.discount || 0) !== 0
          )
            throw fault("PAYMENT_MISMATCH");
          await accounts.fulfill({
            id: data.id,
            orderId:
              typeof data.customData?.orderId === "string"
                ? data.customData.orderId
                : undefined,
            userId:
              typeof data.customData?.userId === "string"
                ? data.customData.userId
                : undefined,
            status: data.status,
            currency: data.currencyCode,
            amount: Number(data.details?.totals?.subtotal),
          });
        }
        if (
          (event.eventType === "adjustment.created" ||
            event.eventType === "adjustment.updated") &&
          event.data.action === "refund" &&
          event.data.status === "approved"
        ) {
          const data = event.data;
          if (data.currencyCode !== "USD") throw fault("PAYMENT_MISMATCH");
          await accounts.refund({
            id: data.id,
            session: data.transactionId,
            amount: Math.abs(Number(data.totals?.subtotal)),
          });
        }
        send(res, 200, { received: true });
        return true;
      }
      return false;
    },
  };
}

export function socialLinks(env: Env) {
  function social(value: string | undefined, hosts: string[]) {
    try {
      const u = new URL(value || "");
      return u.protocol === "https:" &&
        hosts.includes(u.hostname) &&
        !u.username &&
        !u.password
        ? u.href
        : null;
    } catch {
      return null;
    }
  }
  return {
    github: social(
      env.SOCIAL_GITHUB_URL || "https://github.com/korbinjoe/logo2logo",
      ["github.com"],
    ),
    x: social(env.SOCIAL_X_URL || "https://x.com/korbinjoe", [
      "x.com",
      "twitter.com",
    ]),
    youtube: social(env.SOCIAL_YOUTUBE_URL, [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
    ]),
  };
}
