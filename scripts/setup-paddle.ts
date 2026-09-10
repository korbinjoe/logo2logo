import "../lib/load-env.ts";
import { chmodSync, writeFileSync } from "node:fs";
import { Paddle, Environment, type Price } from "@paddle/paddle-node-sdk";
import { plans } from "../lib/commerce.ts";

// Sandbox provisioning only. Never enables billing on the public deployment.
const apply = process.argv.includes("--apply");
const origin = process.env.PADDLE_SETUP_URL;
const events = [
  "transaction.completed",
  "adjustment.created",
  "adjustment.updated",
] as const;

function matchesPrice(price: Price, amount: number) {
  return (
    price.status === "active" &&
    !price.billingCycle &&
    !price.trialPeriod &&
    price.unitPrice.currencyCode === "USD" &&
    price.unitPrice.amount === String(amount) &&
    price.taxMode === "external" &&
    price.unitPriceOverrides.length === 0 &&
    price.quantity.minimum === 1 &&
    price.quantity.maximum === 1
  );
}

async function main() {
  console.log("Paddle sandbox: one-time USD credit packs, tax category saas.");
  console.table(
    plans.map(({ name, amount, credits }) => ({
      name,
      usd: amount / 100,
      credits,
    })),
  );
  if (!apply) {
    console.log(
      "Dry run. Set PADDLE_SANDBOX_API_KEY and PADDLE_SETUP_URL, then use --apply.",
    );
    return;
  }
  const key = process.env.PADDLE_SANDBOX_API_KEY || process.env.PADDLE_API_KEY;
  if (!key?.startsWith("pdl_sdbx_"))
    throw Error(
      "A Paddle sandbox API key is required; live keys are rejected.",
    );
  if (!origin || new URL(origin).protocol !== "https:")
    throw Error("Set PADDLE_SETUP_URL to the HTTPS test deployment origin.");
  if (new URL(origin).origin !== origin)
    throw Error(
      "PADDLE_SETUP_URL must be an origin without a trailing slash or path.",
    );
  const paddle = new Paddle(key, { environment: Environment.sandbox });
  const values: Record<string, string> = {
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_API_KEY: key,
  };
  const checkpoint = () => {
    const path = ".env.paddle-sandbox";
    writeFileSync(
      path,
      Object.entries(values)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
      { mode: 0o600 },
    );
    chmodSync(path, 0o600);
  };
  const products = [];
  for await (const product of paddle.products.list({ status: ["active"] }))
    products.push(product);
  for (const plan of plans) {
    const matching = products.filter(
      (p) =>
        p.customData?.app === "logo2logo" && p.customData?.plan === plan.id,
    );
    if (matching.length > 1)
      throw Error(
        `Multiple products match ${plan.id}; inspect the catalog before retrying.`,
      );
    const product =
      matching[0] ||
      (await paddle.products.create({
        name: `Logo2logo ${plan.name}`,
        description: `${plan.credits} logo generation credits. One-time purchase.`,
        taxCategory: "saas",
        customData: { app: "logo2logo", plan: plan.id },
      }));
    if (product.taxCategory !== "saas")
      throw Error(`Unexpected tax category for ${plan.id}.`);
    let price: Price | undefined;
    for await (const candidate of paddle.prices.list({
      productId: [product.id],
      status: ["active"],
    })) {
      if (matchesPrice(candidate, plan.amount)) {
        price = candidate;
        break;
      }
    }
    price ||= await paddle.prices.create({
      productId: product.id,
      description: `${plan.name} — ${plan.credits} credits, one-time USD`,
      unitPrice: { amount: String(plan.amount), currencyCode: "USD" },
      billingCycle: null,
      trialPeriod: null,
      taxMode: "external",
      quantity: { minimum: 1, maximum: 1 },
      customData: { app: "logo2logo", plan: plan.id, credits: plan.credits },
    });
    if (!matchesPrice(await paddle.prices.get(price.id), plan.amount))
      throw Error(`Price verification failed for ${plan.id}.`);
    values[`PADDLE_PRICE_${plan.id.toUpperCase()}`] = price.id;
    checkpoint();
    console.log(`${plan.name}: product ${product.id}, price ${price.id}`);
  }
  const tokenName = "Logo2logo sandbox checkout";
  let clientToken;
  for await (const token of paddle.clientTokens.list({ status: ["active"] })) {
    if (token.name === tokenName) {
      clientToken = token;
      break;
    }
  }
  clientToken ||= await paddle.clientTokens.create({ name: tokenName });
  if (!clientToken.token.startsWith("test_"))
    throw Error("Unexpected client token environment.");
  values.PADDLE_CLIENT_TOKEN = clientToken.token;
  checkpoint();
  const destination = `${origin}/api/billing/webhook`;
  const existing = (await paddle.notificationSettings.list()).filter(
    (n) => n.type === "url" && n.destination === destination,
  );
  if (existing.length > 1)
    throw Error(
      "Multiple webhook destinations match; inspect before retrying.",
    );
  const settings = {
    description: "Logo2logo sandbox billing",
    subscribedEvents: [...events],
    trafficSource: "all" as const,
    includeSensitiveFields: false,
  };
  const notification = existing[0]
    ? await paddle.notificationSettings.update(existing[0].id, {
        ...settings,
        active: true,
      })
    : await paddle.notificationSettings.create({
        ...settings,
        destination,
        type: "url",
      });
  const verified = await paddle.notificationSettings.get(notification.id);
  if (
    !verified.active ||
    !verified.endpointSecretKey ||
    events.some((e) => !verified.subscribedEvents.some((s) => s.name === e))
  )
    throw Error("Webhook verification failed.");
  values.PADDLE_WEBHOOK_SECRET = verified.endpointSecretKey;
  checkpoint();
  console.log(`Webhook ${verified.id}: ${destination}`);
  console.log(
    "Sandbox credentials saved to ignored .env.paddle-sandbox (0600); no secrets printed.",
  );
  console.log(
    `Set the Paddle sandbox default payment link to ${origin}/checkout.html before testing.`,
  );
}

main().catch((error: unknown) => {
  // Do not dump SDK requests or credential-bearing objects.
  const e = error as { code?: string; message?: string };
  console.error("Paddle setup failed:", e.code || e.message || "Unknown error");
  process.exitCode = 1;
});
