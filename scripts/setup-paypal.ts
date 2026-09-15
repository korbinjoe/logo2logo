import "../lib/load-env.ts";
import { writeFileSync } from "node:fs";
import {
  createPayPalClient,
  paypalConfigurationErrors,
  paypalEvents,
} from "../lib/paypal-billing.ts";

const env = process.env;
const url = new URL(
  env.PAYPAL_WEBHOOK_URL || `${env.APP_URL}/api/billing/webhook`,
);
if (
  url.protocol !== "https:" ||
  url.pathname !== "/api/billing/webhook" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw Error(
    "Set PAYPAL_WEBHOOK_URL to a public HTTPS /api/billing/webhook endpoint.",
  );
const environment = env.PAYPAL_ENVIRONMENT || "sandbox";
console.log(
  JSON.stringify(
    {
      environment,
      url: url.href,
      events: paypalEvents,
      apply: process.argv.includes("--apply"),
    },
    null,
    2,
  ),
);
if (!process.argv.includes("--apply")) {
  console.log(
    "Preview only. Add --apply to register this webhook; existing endpoints are not changed.",
  );
} else {
  const errors = paypalConfigurationErrors(env);
  if (errors.length) throw Error(errors.join("; "));
  const client = createPayPalClient(env);
  type Endpoint = { id: string; url: string; event_types: { name: string }[] };
  const listing = await client.request<{ webhooks: Endpoint[] }>(
    "/v1/notifications/webhooks",
  );
  const existing = listing.webhooks.filter((w) => w.url === url.href);
  if (existing.length > 1)
    throw Error("Multiple matching webhooks; review them in the dashboard.");
  let endpoint = existing[0];
  if (
    endpoint &&
    !paypalEvents.every((name) =>
      endpoint.event_types.some((e) => e.name === name || e.name === "*"),
    )
  )
    throw Error(
      "Existing webhook is missing required events. Update it in the dashboard.",
    );
  endpoint ||= await client.request<Endpoint>("/v1/notifications/webhooks", {
    url: url.href,
    event_types: paypalEvents.map((name) => ({ name })),
  });
  const file = `.env.paypal-${environment}`;
  writeFileSync(
    file,
    `# Merge these fields into the matching environment.\nPAYPAL_ENVIRONMENT=${environment}\nPAYPAL_WEBHOOK_ID=${endpoint.id}\nPAYPAL_WEBHOOK_URL=${url.href}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Webhook registered/verified. Settings saved to ${file}; .env and deployments were not changed.`,
  );
}
