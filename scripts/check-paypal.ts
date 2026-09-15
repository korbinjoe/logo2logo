import "../lib/load-env.ts";
import {
  createPayPalBilling,
  createPayPalClient,
  paypalConfigurationErrors,
  paypalEvents,
} from "../lib/paypal-billing.ts";
import { createAccounts } from "../lib/accounts.ts";

const env = process.env,
  errors = paypalConfigurationErrors(env);
for (const key of ["PAYPAL_MERCHANT_ID", "PAYPAL_WEBHOOK_ID"])
  if (!env[key]) errors.push(`${key} is missing`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const store = createAccounts(":memory:");
  try {
    const billing = createPayPalBilling(env, store);
    if (!billing.ready) throw Error("Invalid PayPal configuration format.");
    const client = createPayPalClient(env);
    await client.accessToken();
    const webhook = await client.request<{
      id: string;
      url: string;
      event_types: { name: string }[];
    }>(`/v1/notifications/webhooks/${env.PAYPAL_WEBHOOK_ID}`);
    const expected =
      env.PAYPAL_WEBHOOK_URL ||
      `${new URL(env.APP_URL!).origin}/api/billing/webhook`;
    if (
      webhook.url !== expected ||
      !paypalEvents.every((name) =>
        webhook.event_types.some((e) => e.name === name || e.name === "*"),
      )
    )
      throw Error("Webhook URL or event subscriptions do not match.");
    console.log(
      JSON.stringify(
        {
          environment: billing.environment,
          credentialsAccepted: true,
          merchantId: env.PAYPAL_MERCHANT_ID,
          webhookVerified: true,
          publicCheckoutEnabled: billing.allowed(),
        },
        null,
        2,
      ),
    );
    console.log(
      "Read-only API check passed. Merchant ID ownership, global acquiring approval, actual payment and payout still require account/transaction verification.",
    );
  } catch (error) {
    console.error(
      "PayPal check failed:",
      (error as { code?: string }).code || (error as Error).message,
    );
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
