# PayPal 接入验证记录 — 2026-09-15

后续更新：2026-09-16 已完成真实 Sandbox 付款、Webhook 验签与退款，见 [沙盒验收记录](paypal-sandbox-test-20260916.md)。下文保留初次无凭据阶段的历史结果。

## 范围与结果

项目已从 Stripe 收款实现切换为 PayPal Orders v2 托管结账，适配通过 paypal.cn 开通全球收单的商户。保留原有 USD 额度套餐、账号、订单和历史账本，删除 Stripe SDK 与旧运行脚本。

- `npm test`：构建、前后端类型检查及 97 项测试通过，其中 PayPal 专项 13 项。
- 最后补充响应 ID 校验与付款确认提示后，`npm run build` 和 13 项 PayPal 专项测试再次通过。
- `npm run check:bundle`：云函数依赖追踪通过，37.2 MiB，不含本地模型、输出或密钥。
- `git diff --check`：通过。
- `npm run paypal:check`：按预期报告 Client ID、Client Secret、Merchant ID、Webhook ID 缺失，没有发起 PayPal 网络请求。

## 自动化覆盖

通过注入模拟 HTTP transport 测试真实的 PayPal OAuth/REST 适配代码，所有付款与退款均为本地测试数据，并未连接 PayPal 沙盒或正式服务：

- 创建订单使用服务端 $12/18 次套餐，忽略客户端的金额/额度；使用 DIGITAL_GOODS、不收配送地址。
- 只接受匹配环境的 PayPal Checkout URL，禁止外域、错误 token 和混用 Live/Sandbox。
- 普通返回 URL 和只读查询不发额度；capture 前检查本站登录及订单所有者。
- 未批准、PENDING、DECLINED、FAILED 不发额度；服务端确认 COMPLETED 后记账。
- APPROVED Webhook 可补完成 capture，处理买家付款后不回站；重复 capture 使用稳定请求 ID。
- Webhook 必须调用官方签名验证 API 并收到 SUCCESS；测试中验证响应为模拟，不代表真实密码学签名已获官方验收。
- 重新核对商户、币种、总额、订单和用户绑定、唯一 capture；伪造或错配数据均被拒绝。
- SQLite 与云端 libSQL 记账流程：余额 `3 → 21 → 12 → 3`；重复/乱序通知不会重新增减额度。
- 部分退款、零头退款、全额退款、退款先于付款通知、撤销付款均覆盖。
- 云端 capture 的跨站请求返回 403，签名 webhook 正常处理。
- OAuth token 缓存及失效刷新、Live 发布开关、配置缺失均覆盖。

## 本地浏览器检查

使用隔离 SQLite 和临时本地服务 `127.0.0.1:4193`，未使用真实登录或支付：

- 中文 `checkout.html` 正常渲染“前往 PayPal 安全结账”。
- 首页三种套餐在缺少支付配置时显示 Purchases coming soon，三个按钮均 disabled。
- 浏览器未发现 error 日志。
- 临时浏览器标签及本地服务在验证后关闭。

## 尚未完成

用户报告 paypal.cn 全球收单审核中。本机 `.env` 已增加 PAYPAL 配置模板但没有凭据，默认 Sandbox，Live 开关关闭。

尚未进行官方 Sandbox 实际买家付款、真实 Webhook 验签与投递、沙盒后台退款、Live 付款或提现；未部署 Vercel。历史 Stripe 实付验收不能替代上述验证。

配置步骤见 [登录与收款配置](commerce-setup.md)。本地日志位于 `.runtime/paypal-all-tests.log`、`.runtime/paypal-final-build.log`、`.runtime/paypal-final-targeted-tests.log`、`.runtime/paypal-bundle-check.log`。
