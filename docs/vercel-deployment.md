# Vercel 全栈部署

项目支持同一仓库部署 React + TypeScript 前端与 Node.js + TypeScript API。无需迁移 Next.js，也无需在 Vercel 上启动 `server.ts`。

生产站点：https://logo2logo.vercel.app 。Vercel 项目为 `korbinzhaos-projects/logo2logo`，已关联 GitHub 仓库。缺少云数据库配置时，公开品牌墙、参考 SVG、套餐介绍与社交链接仍可浏览；登录、购买、生成和私有历史保持关闭，不使用临时数据库或免额度模式。完整服务还需以下云资源。

| 部分 | 云端实现 |
| --- | --- |
| 页面 | Vite 构建 `dist/`，Vercel 静态托管 |
| API | `api/index.ts` → `lib/cloud-app.ts`，Node.js 24，单次最长 300 秒 |
| 数据库 | Turso/libSQL：账户、OAuth 会话、订单、额度账本、生成任务、历史元数据、规划检查点 |
| 图片 | Cloudinary 受保护图片或 R2 私有桶，同源 API 校验所属账户后读取 |
| 创意规划 / 初筛 | OpenCode Go，继续使用现有配置 |
| 图片生成 | fal 的 FLUX.2 klein 4B 异步队列；首轮文生图，微调使用已通过初筛的生成图 |

选 Turso 是为了保留现有 SQLite 数据结构与事务逻辑，同时可从 Vercel 直接连接。上一版的本机 SQLite、输出目录和 Mac GPU 不能作为 Vercel 的持久化方案。Vercel 函数文件系统不可用作持久数据库，函数也不能运行这里的 MLX/MFLUX Mac 模型。

## 1. 创建 Turso 数据库

在 [Turso](https://turso.tech/) 创建数据库，取得 Database URL 和数据库访问令牌。设置：

```dotenv
TURSO_DATABASE_URL=libsql://your-database-your-org.turso.io
TURSO_AUTH_TOKEN=your-database-token
```

将这些值加入本地 `.env`（保留原有配置），执行一次初始化：

```bash
npm ci
npm run db:migrate
```

迁移使用事务并可重复执行，不清空已有表。不要在每次冷启动中创建表或释放任务。迁移不会自动复制本机 `.runtime/accounts.sqlite` 和 `outputs/`；已有真实账户、订单或图片需要单独备份、迁移和校验所有权，不能把匿名本地图片归到任意线上账户。

## 2. 配置图片存储（推荐免绑卡 Cloudinary）

Cloudinary Free 无需绑定银行卡。注册后，在 Console → Settings → API Keys 获取以下三项，作为服务端环境变量配置到本地 `.env` 和 Vercel：

```dotenv
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

上传使用 `authenticated` 类型，原图和衍生图都受到保护。网站验证图片所属账户后，服务端通过有效期 60 秒的签名下载地址读取图片；签名地址和密钥不返回浏览器。图片保存在 `logo2logo/outputs/`，无需手动创建文件夹或开启 unsigned upload preset。

免费额度由存储、流量和图片处理共享，并非无限存储；以 [Cloudinary 当前套餐](https://cloudinary.com/pricing)为准。更换已有存储提供商不会自动迁移旧作品，需要先迁移相同 ID 的图片；不要直接切换有历史图片的环境。

### 可选：R2 私有存储桶

在 Cloudflare R2 创建桶，为该桶创建允许读写对象的 API 凭据，配置：

```dotenv
STORAGE_PROVIDER=r2
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=logo2logo
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
```

不需要公开桶，不需要启用 r2.dev，也不需要浏览器直传/CORS。图片只通过 `/outputs/:id.png` 提供；数据库保存元数据，所选存储服务保存 PNG。服务端把输出规范为不超过 1024 × 1024，避免大图片超出函数响应限制。

## 3. 配置云端模型与登录

```dotenv
MODEL_PROVIDER=opencode-go
OPENCODE_GO_API_KEY=your-existing-key
OPENCODE_GO_PLANNER=kimi-k2.6
OPENCODE_GO_VISION=kimi-k2.6
FAL_KEY=your-fal-key
APP_URL=https://your-site.vercel.app
BILLING_REQUIRED=true
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

至少配置一种登录。Google/GitHub 控制台的回调地址分别为：

```text
https://your-site.vercel.app/api/auth/google/callback
https://your-site.vercel.app/api/auth/github/callback
```

`APP_URL` 必须是当前用户实际访问的固定域名。更换自定义域名时同步更新它及 OAuth 回调。不要把生产用户导向随机 Preview 域名；若需要 Preview 联调，使用独立数据库、固定测试域名与 PayPal 沙盒支付配置。

OpenCode Go 只处理文字规划和图像理解，不提供这里的图片生成能力。fal 需要单独的密钥及可用额度，图片推理不属于 Vercel/Turso 免费额度。首轮 `exploration-v2` 使用 `fal-ai/flux-2/klein/4b`；选稿微调使用 `fal-ai/flux-2/klein/4b/edit`。

## 4. 导入 Vercel

将包含这些改动的 Git 仓库导入 Vercel，设置：

- Framework Preset：Vite。
- Root Directory：仓库根目录。
- Node.js：24.x；启用 Fluid compute。
- Build Command：`npm run build`；Output Directory：`dist`。
- Environment Variables：以上 Turso、图片存储、模型、APP_URL、OAuth 字段；支付和社交字段见 `.env.example`。

`api/tsconfig.json` 为 Vercel 函数独立选择服务端类型配置，并显式固定类型定义目录，兼容 Vercel 在临时目录调用 TypeScript 7 的编译流程；`npm run build` 仍会执行完整的前后端严格类型检查。品牌图库的冷启动加载共享一个请求并限制文件读取并发，避免云函数文件句柄限制导致品牌缺失。

仓库中的 `vercel.json` 已配置 API、品牌参考 SVG、私有图片路由和 300 秒函数时限。`.vercelignore` 排除本机模型、虚拟环境、日志、生成图片和 `.env`。**不要使用 `npm start` 作为 Vercel 构建命令，也不要给密钥加 `VITE_` 前缀。**

正常提交到已关联的 Git 仓库后，Vercel 会构建部署。也可在完成 Vercel 登录与项目关联后执行 `vercel --prod`。Vercel 项目已完成关联，Turso、图片存储、fal 和支付资源仍需分别配置。

## 5. 配置付款与回调

使用 PayPal Checkout 一次性额度包。完整变量和 PayPal 沙盒测试步骤见 [登录与收款配置](commerce-setup.md)。PayPal 通知目标：

```text
https://your-site.vercel.app/api/billing/webhook
```

仅服务端验证过的 PayPal capture 结果可以增加额度；浏览器参数不能证明付款成功。Webhook 使用 PayPal 官方接口验签。未配置付款时，购买按钮保持不可用；云端绝不启用本地免登录、免额度模式。先完成 PayPal 沙盒验证，再使用获准收款的正式账户与 Live 配置。

fal 的完成回调由服务器提交每个任务时自动设置，无需在控制台另填。每个回调有独立随机凭据，服务器只把它用作查询任务的授权，**不会相信回调正文中的图片 URL 或完成状态**，而会用服务端密钥向 fal 查询结果。完成后写入图片存储和 Turso；重复回调不重复扣费或生成。域名必须可被 fal 访问，不能被 Vercel Deployment Protection 登录页拦截。

## 6. 上线检查与恢复

```bash
npm test
npm run check:bundle
npm run check:cloud
```

`check:cloud` 只读检查数据库表、Cloudinary API 凭据或 R2 桶权限与配置是否完整，不消费出图额度，不代替真实 OAuth、PayPal 或模型验收。

随后在部署地址确认：首页与品牌墙加载 → 登录 → PayPal 沙盒购买后到账 → 选择参考 → 生成 → 刷新历史 → 微调 → 退出后无法访问原账户图片。真实云服务验收需你自己的已启用账号和密钥；自动化测试使用 libSQL 临时数据库与模拟的 fal/R2 响应。

出图 POST 返回任务 ID，浏览器轮询该任务。数据库保留任务和上游请求 ID，冷启动、刷新、重试都不会重新提交已有任务。用户关闭页面后，由 fal 回调完成入库。若回调暂时失败，可在“生成历史”中手动“查看生成进度”恢复；不自动创建另一笔付费出图。规划检查点保存 30 分钟，每接受一个方向就写库；单次规划在 240 秒内返回已有方向，之后可续跑。技术性出图失败返还一次额度；暂时的网络或存储异常保留任务供恢复。

`npm run dev` / `npm start` 继续运行原本的本地 SQLite + Ollama/MFLUX 方案。`npm run dev:cloud` 可查看使用真实云 API 适配器的构建产物，但由于安全 Cookie 与同源限制，完整登录/支付测试应在固定 HTTPS 部署域名进行。

## 官方文档与费用边界

- [Vercel Functions 限制](https://vercel.com/docs/functions/limitations)：当前 Fluid compute 的 Hobby 单次最长 300 秒；本项目不把 GPU 出图放进函数等待。
- [Turso TypeScript SDK](https://docs.turso.tech/sdk/ts/reference)：远程 libSQL 和事务。
- [Cloudflare R2 S3 SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)：从 Node.js 访问 R2。
- [fal 队列与回调](https://fal.ai/docs/documentation/model-apis/inference/queue)：异步任务。
- [Vercel Hobby 使用范围](https://vercel.com/docs/plans/hobby)：个人非商业用途；正式销售 Logo 服务应使用允许商业用途的方案。第三方免费额度和条款可能调整，不保证永久免费。
