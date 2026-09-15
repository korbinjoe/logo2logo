# Logo2logo 登录与收款配置

## 免费额度与账号管理

每个账号首次 OAuth 登录后一次性赠送 3 次额度，旧账号在读取登录状态时自动补发一次。唯一流水 `welcome:<userId>` 与余额更新在同一数据库事务中提交，重复登录、并发请求不会重复赠送。手动把余额改为 0 后，也不会再次领到赠送额度。Google 与 GitHub 仍是独立账号。

站内额度与 fal 服务余额独立：赠送额度不代表 fal 免费提供推理。若 fal 返回 `403 User is locked. Reason: TOP_UP.`，需站点管理员在当前 API Key 所属账号的 [fal 计费后台](https://fal.ai/dashboard/billing) 充值。接口会返回 `IMAGE_PROVIDER_BILLING_REQUIRED`，返还本站预扣额度并停止本批后续生成；不会引导用户购买站内额度来解决服务商余额问题。服务端 `generation.submit.failed` 日志记录关联 requestId、任务 ID、模型端点和上游状态码，不记录密钥、图片或原始请求内容。

Vercel / 云端后台地址：`https://logo2logo.vercel.app/admin.html`。先在首页使用管理员账号登录，再打开后台；账户菜单也会显示入口。管理员由服务端 `ADMIN_USER_IDS` 环境变量中的账号 UUID（逗号分隔）确定，默认为空，无人有管理权限；不依赖用户名或客户端 localStorage。可在 Turso 的 `users` 表中查询 UUID，修改环境变量后重新部署。

后台支持按用户名 / UUID 搜索、设置最终余额、查看最近 50 条流水。每次修改必须填写原因，账本记录操作人、差额、目标余额和时间。提交会核对当前余额，遇到生成扣费等并发变化时要求重新选择账号，避免覆盖新余额；网络重试通过操作 ID 去重。管理员可把余额设为 0–1,000,000 的整数。该后台通过云端 API 访问 Turso；本地验证请运行云端适配器 `npm run dev:cloud`。

数据库原始数据可在 [Turso 控制台](https://app.turso.tech/) 中打开 `logo2logo` 数据库查看。日常调整额度使用上述后台，让余额和流水保持一致，不要单独修改 `users.credits`。

当前代码具备 Google/GitHub 登录、PayPal Checkout 一次性结账、签名回调、持久化额度账本和生成权限校验。尚未填写凭据时，登录和购买会明确显示暂未开放，不会模拟登录或支付成功。

## 当前支付选择与账户状态

当前支付提供方为 PayPal。商户通过 paypal.cn 的个人卖家入口申请全球收单，网站通过 PayPal 全球 REST API 接入 Checkout；不要将 API 请求发往 paypal.cn。

截至 2026-09-16，本机 Sandbox 凭据已配置并通过真实沙盒付款、验签回调与退款测试。全球收单审核是否获批仍待确认，正式收款未启用。历史 Paddle / Stripe 验收文档和订单保留；原 Stripe SDK 与运行入口已移除，旧环境密钥不再用于收款。本次没有修改远程 Stripe/Paddle 账户。

## 1. 服务地址和存储

需要 Node.js 24+。在现有 `.env` 中补充 `.env.example` 的对应字段，保留已经配置的模型密钥。不要将任何 Client Secret、API Key 或 Webhook Secret 放进 `public/` 或 Git。

OAuth 的令牌交换和用户资料请求支持启动环境中的 `https_proxy` / `http_proxy` / `no_proxy`（也支持大写）。需要本机代理时，启动服务前设置对应环境变量；服务不会自动读取 macOS 系统代理。OAuth 与 PayPal REST API 的服务端请求均使用该代理配置。

- 本地：`APP_URL=http://127.0.0.1:4173`。
- 正式环境：`APP_URL=https://你的域名`，启动时设置 `NODE_ENV=production`，通过 HTTPS 反向代理转发到本机 4173 端口。
- `BILLING_REQUIRED=true` 默认启用。缺少配置会关闭付费能力，不会放行生成。
- `ACCOUNTS_DB=.runtime/accounts.sqlite`：账户、会话、订单、余额与图片所属关系持久化到 SQLite，数据库文件权限 0600。
- 以单个 Node 进程运行，保留数据库、WAL 文件及 `outputs/` 在同一个持久卷；备份数据库时使用 SQLite 一致性备份。启动时会返还上个进程中断的预扣额度，不支持多个应用进程共享这一恢复流程。
- 旧的匿名生成图片不会被自动分配给新账户；付费模式禁止匿名访问 `outputs/`。历史本地文件仍保留。
- 明确进行本机模型开发时可设置 `BILLING_REQUIRED=false`；该选项只在非生产环境且 APP_URL 为 localhost/回环地址时生效。不要在公开部署使用此开发配置。

## 2. Google / GitHub 登录

在自己的 Google Cloud 项目和 GitHub 设置中创建 OAuth Web 应用，填入：

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

回调地址必须与 APP_URL 完全一致：

| 提供方 | 本地回调 | 正式回调 |
| --- | --- | --- |
| Google | `http://127.0.0.1:4173/api/auth/google/callback` | `https://你的域名/api/auth/google/callback` |
| GitHub | `http://127.0.0.1:4173/api/auth/github/callback` | `https://你的域名/api/auth/github/callback` |

Google 申请 `openid profile`，GitHub 申请 `read:user`，只使用提供方的稳定用户 ID 和展示名，不请求仓库写权限。OAuth 使用 PKCE、绑定浏览器且一次有效的 state；登录后 Cookie 为 HttpOnly、SameSite=Lax，HTTPS 时设置 Secure，有效期 30 天；退出立即撤销会话。Google 与 GitHub 身份各自独立，不以同名或邮箱隐式合并账户。切换服务前填写的简报和选定参考版本通过 localStorage 恢复，连同设计方向、所选套餐和登录提供方一起保留；不会自动重启结账或生成请求。

官方流程：[Google](https://developers.google.com/identity/protocols/oauth2/web-server)、[GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。

## 3. PayPal 配置

一次性 USD 额度包由服务端确定价格，无需在 PayPal 预建商品或价格：Starter $12 / 18 次、Creator $24 / 60 次、Studio $59 / 180 次。当前按上述固定总额收款，不包含自动计算销售税的功能。

```dotenv
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_MERCHANT_ID=
PAYPAL_WEBHOOK_ID=
PAYPAL_CHECKOUT_ENABLED=false
PAYPAL_WEBHOOK_URL=https://你的测试域名/api/billing/webhook
```

- 在 [PayPal Developer Apps & Credentials](https://developer.paypal.com/dashboard/applications) 中获取自己的 REST App 凭据；沙盒和正式环境分别配置。Client ID、Secret、商户 ID 与 Webhook 必须属于同一环境和相应商户/App。
- `PAYPAL_MERCHANT_ID` 是实际收款商户的 PayPal Merchant ID，不是登录邮箱、Client ID、Payer ID 参数或银行卡号。沙盒使用对应 Sandbox Business 账户的商户 ID。
- `PAYPAL_WEBHOOK_ID` 是 App 的通知目标 ID，不是 Secret 或事件 ID。此方案使用服务端 OAuth 和托管跳转，不需要在浏览器中放任何密钥。
- `PAYPAL_ENVIRONMENT=sandbox` 使用 `https://api-m.sandbox.paypal.com`；`live` 使用 `https://api-m.paypal.com`。没有凭据或环境值拼错时购买保持关闭。
- `PAYPAL_CHECKOUT_ENABLED=true` 只在实际审核通过并准备正式收款后启用。沙盒不受此发布开关限制，但仍需齐全的沙盒配置。此开关只控制创建新订单，已批准订单与支付/退款通知仍可完成核对。
- 不自动开通银行卡、Apple Pay 等独立产品；本次先接 PayPal 托管付款，付款方式以商户资格和买家结账页面为准。

### 配置 Webhook

通知地址必须是公开可访问的 HTTPS：`https://你的域名/api/billing/webhook`。订阅事件：

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

可在 App 后台配置，或者运行：

```bash
npm run paypal:setup
npm run paypal:setup -- --apply
npm run paypal:check
```

`setup` 默认仅显示预览；`--apply` 才创建缺失通知目标，相同 URL 已存在则复用并检查事件，不修改已有目标。结果写入 Git 忽略的 `.env.paypal-sandbox` / `.env.paypal-live`（0600），需合并到运行环境。`check` 只读验证 OAuth 凭据、Webhook URL 和事件列表，不创建支付，也不能证明商户身份、审核获批、付款或提现成功。

### 本地沙盒实付验收

1. 使用隔离的本地数据库与 Sandbox App；设置本地 `APP_URL`，例如 `http://127.0.0.1:4173`。不要将本地测试数据写入生产数据库。
2. 将一个公开 HTTPS 隧道转发到本地端口，用它配置 `PAYPAL_WEBHOOK_URL`。只供沙盒测试，不能把 PayPal 后台 Webhook 直接设成 localhost。
3. 配置凭据并重启服务；用本站 Google/GitHub 账号登录，选套餐后进入 `www.sandbox.paypal.com`，使用独立 Sandbox Personal 买家账户完成测试付款。
4. 验证取消、付款后返回、付款后关闭页面（由 APPROVED 通知补完成 capture）、重复 capture、重复通知、待处理转成功、部分/全额退款。
5. 从商户沙盒后台发起测试退款，确认已支付额度按累计金额比例撤销。不要用真实银行卡或 Live 环境做沙盒测试。

## 4. 付款与退款处理

流程：本站登录 → 选套餐 → 服务端创建 Orders v2 订单并绑定本地订单 → PayPal 托管页面批准付款 → 返回后 POST capture，或由已验签的 APPROVED 通知补完成 capture → 服务端查询实际订单与扣款结果 → 额度到账。

- URL 中的 `token` 只是 PayPal 订单编号，不是付款证明。capture 路由先检查本站会话及订单所有者；普通状态查询始终只读。
- capture 使用稳定 `PayPal-Request-Id`，重复或并发请求不重复扣款；若已 capture，则重新读取实际状态。
- 服务端验证 USD 总额、收款商户 ID、订单/用户绑定、唯一完整 capture 和状态。PENDING、DECLINED、FAILED 均不授予额度。
- Webhook 将 PayPal 签名头、事件和本站 Webhook ID 提交官方验签接口；只有 SUCCESS 才处理，并重新请求订单/capture/refund 的权威数据。生产环境不会接受沙盒模拟通知作为付款证明。
- 退款使用同一 capture 下的累计快照；SQLite / libSQL 原子记账，金额只增不减。通知重复、乱序、退款先于付款、全额撤销均不会重复扣减或恢复额度。已消耗额度的退款可形成负余额。
- 退款仍由客服人工审核并通过 PayPal 商户后台处理，本站通知接口只同步结果，不自动发起退款。
- 订单金额固定；自动税务计算和申报不在本次实现中。上线前根据实际业务确认税务处理。

官方参考：[创建订单](https://developer.paypal.com/api/orders/v2/orders-create)、[Webhook 验签](https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post)、[Capture](https://developer.paypal.com/api/payments/v2/captures-get)、[Refund](https://developer.paypal.com/api/payments/v2/refunds-get)。

## 5. 正式启用

1. 等待 paypal.cn 全球收单申请获批，确认 AI Logo 生成业务、实际付款方式和人民币提现能力。
2. 使用该商户对应的 Live App 配置凭据、商户 ID 与线上 Webhook。设置 `PAYPAL_ENVIRONMENT=live`，开始时保持 `PAYPAL_CHECKOUT_ENABLED=false`。
3. 配置 Vercel 的上述变量并部署；`.env` 的变更不会自动同步到 Vercel。正式 Webhook 地址为 `https://logo2logo.vercel.app/api/billing/webhook`。
4. 完成沙盒实付验收，确认业务信息、客服、政策与税务安排后，开启正式购买开关。

当前已完成真实 PayPal 沙盒付款、官方验签回调与退款测试；全球收单审核状态、生产部署、Live 付款和实际提现尚未完成验证。

初次构建、97 项测试及本地页面检查见 [初始验证记录](paypal-local-test-20260915.md)。真实沙盒端到端验收及最新构建检查见 [2026-09-16 沙盒验收](paypal-sandbox-test-20260916.md)。
