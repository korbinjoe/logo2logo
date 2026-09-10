# Logo2logo 登录与收款配置

## 免费额度与账号管理

每个账号首次 OAuth 登录后一次性赠送 3 次额度，旧账号在读取登录状态时自动补发一次。唯一流水 `welcome:<userId>` 与余额更新在同一数据库事务中提交，重复登录、并发请求不会重复赠送。手动把余额改为 0 后，也不会再次领到赠送额度。Google 与 GitHub 仍是独立账号。

Vercel / 云端后台地址：`https://logo2logo.vercel.app/admin.html`。先在首页使用管理员账号登录，再打开后台；账户菜单也会显示入口。管理员由服务端 `ADMIN_USER_IDS` 环境变量中的账号 UUID（逗号分隔）确定，默认为空，无人有管理权限；不依赖用户名或客户端 localStorage。可在 Turso 的 `users` 表中查询 UUID，修改环境变量后重新部署。

后台支持按用户名 / UUID 搜索、设置最终余额、查看最近 50 条流水。每次修改必须填写原因，账本记录操作人、差额、目标余额和时间。提交会核对当前余额，遇到生成扣费等并发变化时要求重新选择账号，避免覆盖新余额；网络重试通过操作 ID 去重。管理员可把余额设为 0–1,000,000 的整数。该后台通过云端 API 访问 Turso；本地验证请运行云端适配器 `npm run dev:cloud`。

数据库原始数据可在 [Turso 控制台](https://app.turso.tech/) 中打开 `logo2logo` 数据库查看。日常调整额度使用上述后台，让余额和流水保持一致，不要单独修改 `users.credits`。

当前代码具备 Google/GitHub 登录、Paddle 一次性结账、签名回调、持久化额度账本和生成权限校验。尚未填写凭据时，登录和购买会明确显示暂未开放，不会模拟登录或支付成功。

## 本次支付选择

以中国内地个人、暂无公司为前提，优先申请 Paddle。其官方说明允许个人开发者进行身份验证，中国内地不在供应商禁用名单中。民生银行香港账户能否作为该内地主体的结算账户，需在 Paddle 入驻时确认；香港银行卡本身不能代替身份或经营主体审核。Paddle 支持银行电汇或 Payoneer 提现，通常按月结算，最低提现门槛为 $100；具体入账费用和账户要求以平台及银行确认为准。

Stripe 香港个人开户不接受非香港身份证号码，因此本项目没有将“持有香港卡”视作可直接使用 Stripe 的条件。代码默认使用 Paddle Billing，不包含 Stripe 结账路径。

官方依据：

- [Paddle 个人与企业验证](https://www.paddle.com/help/start/account-verification/what-is-account-verification)
- [Paddle 供应商地区](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle)
- [Paddle 提现方式和门槛](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid)
- [Paddle 费率](https://www.paddle.com/paddle-101)
- [Stripe 香港开户要求](https://support.stripe.com/questions/requirements-for-hong-kong-based-businesses?locale=en-GB)

## 1. 服务地址和存储

需要 Node.js 24+。在现有 `.env` 中补充 `.env.example` 的对应字段，保留已经配置的模型密钥。不要将任何 Client Secret、API Key 或 Webhook Secret 放进 `public/` 或 Git。

OAuth 的令牌交换和用户资料请求支持启动环境中的 `https_proxy` / `http_proxy` / `no_proxy`（也支持大写）。需要本机代理时，启动服务前设置对应环境变量；服务不会自动读取 macOS 系统代理。此设置仅用于 OAuth 服务端请求。

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

## 3. Paddle Sandbox

### 自动配置

已提供基于 Paddle 官方 `catalog-setup`、`checkout-web`、`webhooks` 和 `sandbox-testing` 技能的配置脚本。默认只展示计划，不请求 Paddle：

```bash
npm run paddle:setup
```

在本机 `.env` 中设置 `PADDLE_SANDBOX_API_KEY` 和 `PADDLE_SETUP_URL` 后执行：

```bash
npm run paddle:setup -- --apply
```

`PADDLE_SETUP_URL` 必须是用于测试的 HTTPS 站点源地址，不含路径或末尾斜杠。脚本拒绝正式 API Key，使用当前代码中的三个一次性 USD 额度包，税类为 `saas`、税额另加、购买数量限定为 1。它会复用带有 Logo2logo 标记的商品及匹配价格，创建或复用客户端 Token，并配置 `transaction.completed`、`adjustment.created`、`adjustment.updated` 回调。多条同目标回调等歧义会停止执行。

配置 Key 需要 Products、Prices、Client-side tokens、Notification settings 的读写权限。后续结账需要 Transactions 读写；回调测试和退款验证分别需要 Notifications、Notification simulations、Adjustments 权限。默认支付链接需要在 Paddle 后台设为 `PADDLE_SETUP_URL/checkout.html`。 如果 API 报 `transaction_checkout_url_domain_is_not_approved`，还需在 Checkout → Website Approval 单独登记测试域名；本账户沙盒登记后即时显示 Approved，仅保存默认支付链接不会自动完成登记。

生成结果保存在被 Git 忽略的 `.env.paddle-sandbox`（权限 0600），每次执行会重新生成此文件，终端只输出商品和价格 ID。这个文件是配置结果，不会被应用自动加载；脚本不会修改现有 `.env`、部署环境或开启公开站点购买。应先用于独立的测试部署与数据库，再验证真实沙盒结账、回调入账、退款与重试。脚本成功仅代表资源已配置，不等于端到端支付验证成功。

先建立 Sandbox 账户，在目录中创建三项 **一次性** USD 价格：

| 环境变量 | 套餐 | 单价（美元分） | 额度 |
| --- | --- | --- | --- |
| `PADDLE_PRICE_STARTER` | Starter | 1200 | 18 |
| `PADDLE_PRICE_CREATOR` | Creator | 2400 | 60 |
| `PADDLE_PRICE_STUDIO` | Studio | 5900 | 180 |

价格设为 `billing_cycle=null`、`tax_mode=external`、active；不要添加地区价格覆盖或折扣。数量限定为 1。结账前服务器会核对价格，回调再次核对订单、账户、交易 ID、数量、USD 税前金额及无订阅/折扣，不能通过修改前端价格或额度绕过校验。税额由结账计算并另行展示。

```dotenv
PADDLE_ENVIRONMENT=sandbox
PADDLE_API_KEY=
PADDLE_CLIENT_TOKEN=
PADDLE_WEBHOOK_SECRET=
PADDLE_PRICE_STARTER=pri_...
PADDLE_PRICE_CREATOR=pri_...
PADDLE_PRICE_STUDIO=pri_...
```

API Key 至少需要读取价格、创建交易的权限。客户端 Token 是 Paddle.js 的公开 token，API Key 和 webhook secret 始终仅在服务端使用。需要至少启用一种真实登录方式，购买才会开放。

设置默认结账页为 `APP_URL/checkout.html`，并按 Paddle 要求配置/批准域名。创建通知目标 `APP_URL/api/billing/webhook`，订阅：

- `transaction.completed`：完成支付后发放额度。
- `adjustment.created`、`adjustment.updated`：批准退款后按退款税前金额比例撤销对应额度。

本地测试需要把 webhook 转发到本机，或使用自己控制的 HTTPS 测试部署。Sandbox 与正式环境必须使用各自对应的 API Key、客户端 Token、价格和通知 Secret。

流程：登录 → 选套餐 → 后端创建交易 → Paddle.js 结账 → 带签名 webhook 入账 → 返回页查询到账状态。返回页参数和浏览器的 `checkout.completed` 事件只触发查询，不能授予额度。回调去重以订单为单位；退款以 adjustment ID 去重，支持退款通知早于支付完成通知。付款回调金额不匹配时拒绝发放额度，应核对实际订单后通过 Paddle 处理，不要在浏览器手工补额度。

额度规则：生成一张交付图片扣 1 次，包括初筛不通过的草稿；完整探索三方向最多扣 3 次。重绘、微调每张各扣 1 次；技术失败自动返还。每个账户同时只允许一张图生成，余额变动用事务防止超扣。新探索要求至少 3 次余额。设计规划每账户每小时最多 20 次，结账每账户每小时最多 20 次。已消费后发生退款可产生负余额，余额不足时不能继续生成。账户菜单提供最近 12 张原始生成图；浏览器手动调色需要自行下载。

官方实现依据：[创建交易](https://developer.paddle.com/api-reference/transactions/create-transaction/)、[验签](https://developer.paddle.com/webhooks/about/signature-verification/)、[付款完成事件](https://developer.paddle.com/webhooks/transactions/transaction-completed/)、[Paddle.js](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/)。

## 4. 正式启用

先完成 Paddle 实际身份、域名、产品和结算账户审核，并提供与你真实经营信息一致的隐私政策、服务条款、退款政策及支持联系方式。政策需描述实际使用的模型供应商、账户与输出数据处理方式；本任务没有代填身份信息或虚构法律主体，也没有提交平台申请。

Sandbox 用测试付款完成登录、购买、到账、生成扣减、退款和重复 webhook 验证后，再替换为正式凭据并设置 `PADDLE_ENVIRONMENT=production`。没有真实凭据时，本地自动化只验证模拟的 OAuth/Paddle 交互和真实 SDK 的验签，不代表商户已获准收款。

## 社交入口

GitHub 和 X 已使用用户指定地址；YouTube 未提供时显示灰色待开放图标，不指向平台首页或虚构账号。

```dotenv
SOCIAL_GITHUB_URL=https://github.com/korbinjoe/logo2logo
SOCIAL_X_URL=https://x.com/korbinjoe
SOCIAL_YOUTUBE_URL=
```

修改配置后重启服务。`GET /api/account` 仅返回登录状态、公开套餐、公开社交地址及提供方是否可用，不返回私密凭据。

## 沙盒验收记录

实际 Paddle.js 结账、拒付、签名回调和重复通知的验证结果见 [paddle-sandbox-verification.md](paddle-sandbox-verification.md)。沙盒验收与正式收款开通分别记录，不以后台向导的完成勾选代替测试证据。
