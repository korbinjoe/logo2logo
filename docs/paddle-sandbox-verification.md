# Paddle sandbox verification

Verified against the application's `src/Checkout.tsx` and `lib/commerce.ts` on 2026-09-10. Tests used Paddle sandbox, official test cards, an isolated local SQLite database, and an HTTPS tunnel. No production users, balances, OAuth sessions, or model APIs were used. The test account was a seeded fixture; this run does not revalidate Google/GitHub OAuth.

| Scenario | Result |
| --- | --- |
| Starter checkout | Real Paddle.js checkout opened; $12 subtotal plus $1.20 test tax |
| Declined test card | Paddle declined the payment; balance remained 0 |
| Successful test card | Transaction completed; application received Paddle's signed notification; balance changed 0 → 18 |
| Duplicate payment notification | Replayed through Paddle Notifications API; delivered successfully; balance remained 18 |
| Duplicate approved refund notification | Replayed through Paddle; balance stayed 0 with exactly one purchase and one refund ledger entry |
| Forged notification | Rejected with `INVALID_SIGNATURE` |
| Unauthenticated checkout configuration | Rejected with `AUTH_REQUIRED` |
| Refund pending approval | No premature credit deduction; balance remained 18 |
| Approved full refund | Approved automatically; signed adjustment notification delivered; balance changed 18 → 0 (ledger: +18 purchase, −18 refund) |

Evidence IDs (sandbox only):

- Transaction: `txn_01m25t2bqrse8xy3wbk5bx9scv`
- Payment notification: `ntf_01m25t41fsh49nb9bxr8pnt4g9`
- Replayed payment notification: `ntf_01m25t4pe2zetpbcpna7t1n0jp`
- Full refund: `adj_01m25t54wkfe4mwpgzzmykdqpd`

## Configuration findings

The transaction API checks an explicit `checkout.url` against registered checkout domains even in this sandbox account. Saving the default payment link alone did not register a new domain. Adding the test hostname under Checkout → Website Approval returned `Approved` immediately and unblocked checkout. For each test deployment, align its `APP_URL`, default payment link, registered domain, and notification destination.

A Cloudflare Tunnel using HTTP/2 and IPv4 delivered actual sandbox payment notifications successfully. The earlier aborted simulator run did not establish a defect in the application webhook handler.

Sandbox refunds initially return `pending_approval`. The app deliberately waits for an approved adjustment event before reversing credits. Paddle's sandbox processes approvals periodically, so do not treat the immediate refund API response as successful fulfillment.

## Cleanup

The default sandbox payment link was restored to `https://logo2logo.vercel.app/checkout.html` and the temporary checkout domain was removed. The unused sandbox callback pointing at production was disabled. The temporary test callback was disabled, and the local test server and tunnel were stopped after the final replay check.

## Production status

Public production billing remains disabled. Sandbox notification destinations must not target the production database. Before accepting real money, complete Paddle live account/site approval, provision live products, prices, client token and webhook secret, configure payouts, and run the production launch checklist.

Official references: [Sandbox](https://developer.paddle.com/sdks/sandbox/), [checkout domain error](https://developer.paddle.com/errors/transactions/transaction_checkout_url_domain_is_not_approved/), [go-live checklist](https://developer.paddle.com/build/go-live-checklist/).
