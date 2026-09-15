# PayPal Sandbox 实际验收 — 2026-09-16（北京时间）

## 结果

使用真实 PayPal Sandbox REST API、托管结账页面与美国 Personal 测试买家，完成 $12 / 18 次额度套餐付款、取消、签名回调、重复请求与两次部分退款。没有 Live 扣款，没有部署生产环境。

本机 Sandbox OAuth 凭据通过验证。将误填为商户邮箱的 `PAYPAL_MERCHANT_ID` 修正为该 Sandbox 商户实际 ID，通过订单 payee 校验其邮箱一致性；API Secret 不进入记录。

| 测试 | 结果 |
| --- | --- |
| 取消 PayPal 付款 | 未 capture，订单未支付，额度维持 3 |
| Starter $12 沙盒付款 | capture COMPLETED；返回页显示付款成功；额度 3 → 21 |
| 第一笔 $6 退款 | refund COMPLETED；真实签名通知通过官方验签；额度 21 → 12 |
| 第二笔 $6 退款 | refund COMPLETED；capture 最终 REFUNDED；真实回调后额度 12 → 3 |
| 重复 APPROVED / COMPLETED / REFUNDED 通知 | HTTP 200，不重复记账 |
| 全额退款后重放旧退款、完成通知和 capture 请求 | HTTP 200，额度保持 3 |
| 篡改真实通知的签名头 | HTTP 400 / INVALID_SIGNATURE，额度不变 |

签名测试使用 PayPal 实际投递的原始事件与签名头，由正式应用处理器调用 Sandbox 官方验签 API；并非 Webhook Simulator 或模拟验签返回。临时网关初次转发请求失败，改为仅转发 PayPal 签名头与 content-type 后，真实投递及重放均成功。

## 沙盒对象（均为测试数据）

- 取消的订单：`4BG203909T278641B`。
- 成功付款订单：`7MW83113RK314925B`。
- Capture：`60G83649C0581263C`，USD 12.00，最终 REFUNDED。
- 第一笔退款：`10K9912721391532R`，USD 6.00。
- 第二笔退款：`0T983144H05553156`，USD 6.00。
- 商户核对用的未支付诊断订单：`2WR87900D76453038`；未批准、未扣款。

## 代码及检查

兼容 PayPal API 响应链接中的官方 `api.sandbox.paypal.com` / `api.paypal.com` 别名，继续严格限制同一环境和资源路径；实际认证请求仍发送到固定 API 主机。新增回归测试，验证 Sandbox 别名可用、Live 域名不可混入 Sandbox。

- `npm run build`：前后端类型检查和构建通过；现有 hero-scene 大于 500 kB 的分包提示仍在。
- `node --test test/paypal-billing.test.js`：14 项通过。
- `git diff --check`：通过。
- 初次全量 97 项自动化检查见 [前次记录](paypal-local-test-20260915.md)，本次仅重跑相关测试与构建。

## 隔离与后续

使用 `.runtime/paypal-acceptance.sqlite` 隔离数据库、临时本地登录会话和只开放 Webhook 路由的 HTTPS 隧道。测试没有修改生产用户或账本。原有指向 Vercel 的 Sandbox Webhook 配置保留；临时新增的隧道 Webhook 在验收后删除，本地服务与测试标签关闭。新增美国 Sandbox Personal 买家保留供后续测试。

本机仍为 Sandbox，`PAYPAL_CHECKOUT_ENABLED=false`。沙盒验收不能证明全球收单商户审核通过、Live 收款或提现可用；开发者后台仍提示需升级 Business 才能查看 Live 凭据。下一步需要确认商户正式资格及对应 Live App，再配置生产环境并验收。

本地测试日志：`.runtime/paypal-verified-build.log`、`.runtime/paypal-verified-tests.log`；原始通知保存在 Git 忽略的 `.runtime/paypal-events/`，含签名等测试数据，不应公开上传。
