# Logo2logo

## 技术栈与运行

前后端统一使用 **TypeScript（strict）**，前端为 **React 19 + Vite 8**，服务端为 **Node.js 24 + TypeScript**。页面与结账页分别构建，React 组件管理图库、参考版本、简报、流式生成、草稿画布、外观、语言与账户状态。支持两种全栈运行方式：本地 Node.js + SQLite + MFLUX，以及 **Vercel Functions + Turso 数据库 + R2 私有图片存储 + fal 云端出图**。

Vercel 部署已配置 `vercel.json` 与 `api/index.ts`。账户、订单、额度、历史与规划检查点持久化到云数据库，图片独立存储；OAuth、PayPal 签名回调和所属账户权限在服务端执行。部署步骤、环境变量、迁移与验收见 [Vercel 全栈部署](docs/vercel-deployment.md)。现有 `.env` 与本机图片不会自动上传，云资源和真实密钥需要自行配置。

```bash
npm install
npm run dev        # Vite 热更新与 API 同源运行：http://127.0.0.1:4173
npm run typecheck  # 前后端 TypeScript 严格检查
npm run typecheck:server # 仅检查服务端
npm run build      # 生成 dist/
npm start          # 自动构建后启动；已有产物可直接 node server.ts
npm test           # 构建 + 自动化测试
```

- `server.ts`：本地服务入口；`api/index.ts`：Vercel 函数入口；`lib/*.ts`：账户、支付、数据库、规划和生成业务。
- `lib/types.ts`：服务端共享类型；`tsconfig.server.json`：独立的严格类型检查配置。Node.js 24 直接运行可擦除类型的 TypeScript，无需额外运行时转译器；构建时仍执行完整类型检查。
- `src/components/`：React 页面组件及工作台；`src/Checkout.tsx`：独立结账入口。
- `src/state.tsx`、`src/commerce.tsx`：偏好、国际化与账户状态。
- `src/lib/`：类型化 API、NDJSON 流读取、存储校验；`src/types.ts`：前端接口契约。
- `src/data/`：双语文案、13 套主题；`public/`：样式与品牌 SVG 静态资源。
- `index.html`、`checkout.html`：Vite 入口；生产环境只提供 `dist/` 产物，开发模式通过 `--dev` 显式启用。

浏览器回归使用 playwright-cli 技能，在隔离浏览器运行：`playwright-cli -s=react-check open http://127.0.0.1:4173`，随后 `playwright-cli -s=react-check run-code --filename=scripts/check-react-ui.cjs`。该脚本模拟规划、出图、登录状态和支付，不调用模型、不实际收费，检查部分失败续跑、参考图微调、刷新恢复和退出账户隔离；运行后恢复原浏览器偏好。

## 登录、套餐与额度

首页提供 GitHub、X、YouTube 入口（YouTube 地址待配置），以及双语 Pricing 和账户弹窗。Google/GitHub OAuth 登录和 PayPal Checkout 一次性购买已实现，真实登录/收款需要配置并激活自己的第三方账户。配置缺失时明确显示暂未开放，默认不会绕过付费校验。

Starter $12 / 18 次、Creator $24 / 60 次、Studio $59 / 180 次；无自动续费，额度不设到期日。一张交付图片消耗一次，完整探索三张消耗三次，技术失败自动返还。价格从后端统一提供，付款由服务端核对 PayPal capture 结果后入账，Webhook 需通过官方验签。SQLite 持久化用户、会话、订单、余额及图片权限，输出文件仅可由所属账户访问。

需要 **Node.js 24+**。详细步骤、Google/GitHub 回调地址、PayPal 沙盒配置、提现适用性及正式启用条件见 [登录与收款配置](docs/commerce-setup.md)。环境字段见 [.env.example](.env.example)，补充现有 `.env` 时保留已配置的模型密钥。

## 国际化

界面默认英文。页眉的 EN / 中文选择器会即时切换并保存语言选择，不改变品牌名称、简报、参考版本或已有画布。十三套外观均支持两种语言。界面及商业流程文案集中在 `src/data/messages.ts`，主题文案位于 `src/data/themes.ts`，由 React 状态层和 `src/lib/i18n.ts` 渲染。

新设计请求携带 `locale`；模型说明和视觉检查依据使用该语言，图像提示词仍使用英文。旧字段 `constructionZh` 保留兼容性，其内容按请求语言生成。已生成内容保留原语言；重试沿用原设计语言。

## 设计流程

必须先从品牌图库选择一个有效的参考 Logo 版本，才能展开并提交品牌简报。首次生成同样要求有效参考；微调继续使用已通过初筛的实际草案。前端入口与 `/api/territories`、`/api/generate` 均校验此约束，缺少参考返回 `REFERENCE_REQUIRED`，无效品牌或版本返回 `INVALID_REFERENCE`。

站点标志资源：`public/logo2logo.svg` 为紧凑的自绘圆角几何字标，橙色数字 2 是唯一强调；桌面端不再并列图标，手机页眉和结账页使用独立模块图标，页脚保留完整字标，`public/logo2logo-mark.svg` 为独立符号，`public/favicon.svg` 为小尺寸图标，`public/logo2logo-dark.svg` 为深色背景字标。

页面顶部提供轻盈工作台、暗色创作室、活力色块、瑞士海报、工程蓝图、薄荷画廊、像素终端，以及新增的掌机乐园、独立杂志、轨道控制室、包豪斯积木、手作拼贴、午夜影院，共十三种外观，支持全部、明亮、深色、趣味分类筛选，保存在浏览器 localStorage；切换仅改变外观，不改变参考选择、简报或模型设置。品牌墙首批展示 72 个品牌，每次继续加载 72 个；支持单色、多色、渐变、紧凑图形和横向标志筛选。字标可通过 `node scripts/build-wordmark.mjs` 重建，不依赖外部字体。

## 浏览器偏好与草稿恢复

首屏使用按需加载的 Three.js 大幅流动光带背景：GPU 驱动的曲面缓慢折叠，暖色与冷色光晕横贯首屏，标题区域降低对比度。鼠标移动时，柔光跟随位置，附近光带轻微隆起、弯曲并产生视差；移开后平滑回落，暂停及减少动态效果时停止联动。背景不占据布局、不接收点击，右侧原有步骤区及各主题插画保留。桌面约 30 帧/秒，触屏约 15 帧/秒，像素比上限分别为 1.25 和 1；离开首屏或切换标签页会停止动画。支持暂停按钮和系统“减少动态效果”，暂停选择保存为 `heroMotion`。移动端保持全幅背景，不新增内容区块。WebGL 不可用时显示静态柔光渐变；无需外部 3D 素材。

语言和外观分别保存在 `logo2logo-locale`、`logo2logo-theme`，其余选择集中在 `logo2logo-preferences-v1`：参考品牌及具体版本、简报、设计方向、搜索词、品牌筛选、已加载数量、外观分类、所选套餐、登录提供方、常见问题及设计依据展开状态。刷新或关闭后重新访问会恢复这些选择；清除参考也会保存。旧版 sessionStorage 简报自动迁移。

工作台按账户缓存最近 24 张的图片 ID、设计元数据，以及调色、保留和淘汰状态；刷新后从服务端读取已有图片，可以恢复淘汰的草稿。图片不存入 localStorage，不会因恢复触发生成、支付或扣额度。账户会话、余额和支付授权仍由服务端管理。浏览器禁用存储或空间不足时提示保存失败；偏好不跨设备同步，清除站点存储会删除本机偏好，但不会删除服务端生成历史。

## 品牌档案与生成历史

点击品牌墙的 Logo 打开品牌档案，包含官网、品牌背景、Logo 解读、配色及版本预览。预览版本后，点击“以此 Logo 为参考”才正式选定参考并展开设计简报。

`src/data/brand-profiles.ts` 收录 12 个精选品牌的双语介绍及来源。官方设计说明与本站图形分析在界面中分别标注；其余品牌通过 `/api/brands/:id` 获取来源网站的简短介绍，无法取得时显示资料待补充和官网入口，不虚构品牌故事。网站预览只请求目录中已有的网址，限制响应大小、时长和重定向，并拒绝私网地址；结果缓存 24 小时。

品牌卡片和详情支持点赞、点踩、收藏，点赞与点踩互斥，可再次点击取消。品牌墙提供“已点赞 / 已点踩 / 我的收藏”筛选。点击“换一批 / Shuffle”随机重排当前筛选范围内的品牌，从首批 72 个重新展示；顺序保存在本机，刷新和继续加载会沿用，参考选择与简报保持不变。偏好、筛选和预览版本保存在 `logo2logo-preferences-v1`，目前属于本设备上的个人选择，不提供跨设备同步或全站热度计数。

页眉和账户弹窗均可进入“生成历史”。`GET /api/history?page=0` 从 SQLite 中读取当前账户的全部已完成记录，每页 24 张，按时间倒序；它独立于工作台的 24 张本地缓存。支持预览原图、下载和继续编辑；同设备已有的调色与保留状态会继续恢复。生成图片和制作记录由后端保存，退出或切换账户后清空当前画廊，接口和输出文件均校验所属账户。旧元数据兼容读取；文件缺失保留记录并提示无法预览。仅显式启用本地开发模式时展示本地输出目录历史。

历史数据读取位于 `lib/design-history.ts`，网站介绍读取位于 `lib/brand-info.ts`。浏览器历史回归脚本：`playwright-cli -s=react-check run-code --filename=scripts/check-exploration-ui.cjs`。它使用 29 条隔离的模拟记录验证分页、旧稿编辑、偏好恢复、文件缺失提示及退出账户隔离，不调用生成服务。

## OpenCode Go 接入

服务启动时读取项目 `.env`（已忽略提交，外部环境变量优先）。设置 `MODEL_PROVIDER=opencode-go`、`OPENCODE_GO_API_KEY`，默认使用 `kimi-k2.6` 进行创意规划、参考图风格理解和生成图检查。可通过 `OPENCODE_GO_PLANNER` / `OPENCODE_GO_VISION` 指定兼容当前 Kimi Chat Completions 参数的模型。

Go 当前要求客户端发送自身 User-Agent 和会话 ID，适配器使用 `logo2logo/1.0`，并为同一次规划及重试保持会话。官方将 Go 定位为编程代理流量，Logo 设计用途的长期支持需向供应商确认。

品牌简报及用于视觉理解的图片会发送到 OpenCode Go；FLUX / MFLUX 出图与编辑仍在本地。保留应用侧 JSON 和主体校验。设置 `MODEL_PROVIDER=ollama` 可恢复下述本地 Qwen 流程。密钥只在服务端使用，不返回浏览器。

# 本地 Logo 生成引擎

## 主体优先探索（exploration-v2）

首轮规划三个不同轮廓、视角或正负形方向，分别出图，不再把一个构型复制成三次微调。每个方向描述真实主体、可见辨识特征和容易误读的形象；校验品牌、拼写、重复构型与已知鹦鹉回归案例。校验失败会携带错误输出和具体字段修复一次；仍失败的方向不出图，但其他成功方向保留。页面提供“仅重试失败方向”，不会重抽已成功方案。续跑记录由服务端持有，绑定原描述、风格、参考图与模型；30 分钟未使用或服务重启后失效，不接受客户端伪造的已通过方案。

## 运行日志与排障

默认日志：`.runtime/logs/runtime.jsonl`（可用 `LOG_DIR` 覆盖）。每行一个 JSON，记录请求编号、实际模型、规划方向、每次尝试、耗时、模型文本响应、具体失败字段，以及参考图理解、出图和视觉初筛结果。HTTP 错误及页面错误会携带请求编号，便于追踪，不再把所有错误统称为“主体校验失败”。`/api/health` 返回当前实际配置的规划/视觉模型及安装状态。

日志默认仅本机可读（目录 0700、文件 0600），不通过站点提供下载；不记录请求头、Cookie 或图片 Base64。模型文本每条最多 12000 字符，可能包含品牌描述等业务信息，分享前仍应脱敏。单文件约 5 MiB，保留当前文件及 4 份轮转文件；`.runtime/` 已忽略提交。日志写入失败会输出终端警告，不冒充记录成功。

```bash
tail -f .runtime/logs/runtime.jsonl
npm test
```

`POST /api/territories` 现在返回 `status: complete | partial`、`failures`、`resumeId`、`requestId` 和所有已通过 `territories`。续跑时发送原输入及 `resumeId`，成功方案保持相同 ID。`INVALID_FIELD`、`TRUNCATED_OUTPUT`、`BRAND_MISMATCH` 等是不同问题；JSON 截断重试会有限提高输出额度，不跳过主体校验。输入超过 1500 字明确拒绝，不静默截断品牌信息。

已复现 `parrot` + Notion 参考的品牌改名问题：模型曾返回 `Parrot Explorer` / `Parrot Palooza`，被品牌校验拒绝。现在单个拉丁名称及明确“品牌名 …”会被提取为固定名称，通过 JSON Schema 枚举约束和独立校验双重锁定；未明确名称的自由描述不会强行当作品牌名，第一条通过的名称也会约束后续方向。迁移期间显式使用旧 Qwen 视觉模型时仍关闭 thinking，避免短输出预算被思考文本耗尽。

隔离浏览器交互测试：`node scripts/check-planning-ui.mjs`，打开它打印的临时端口并输入 `Nova AI editor`。该脚本模拟第二方向字段失败及续跑，**不调用 GPU，图片是历史测试素材，不代表新模型生成质量**；产物写入打印出的独立临时目录。测试完成 Ctrl+C 关闭。`OUTPUT_DIR` 可用于隔离输出目录。

首轮探索不对图库 Logo 做像素级编辑：本地视觉模型读取其色彩、填充、边缘与留白风格，转为描述后使用 MFLUX 文生图生成新主体，防止把参考品牌的动物结构带入新设计。视觉风格读取不可用时使用色板和通用轮廓约束，不保证复刻参考风格。仅在选中草案后的微调阶段使用真正的参考图编辑。这是有意区分探索与精修，不是绕过主体检查。

出图后使用本地视觉模型检查主体与明显结构问题。`pass` 仅代表模型初筛通过，不是审美认证；`reject` 建议淘汰；模型不可用或超时为 `unreviewed`，不伪造分数。仅初筛通过的候选开放选中微调，后端也复查持久化状态。微调输入为选中的生成 PNG，保留原图，不再从图库参考重抽。生成记录保存 `review`、`sourceId`（微调时）与设计规格。

规划按方向分三次短请求，规划、参考图风格解读和视觉初筛统一默认使用 `qwen3-vl:8b`。可通过 `OLLAMA_PLANNER` / `OLLAMA_VISION` 分别指定已安装的本地 completion / vision 模型，不允许 cloud 覆盖，不自动回退到旧模型。Qwen3-VL 8B 请求关闭 thinking；对 Ollama 0.33.3 将完整 JSON 放入 thinking 字段的情况，只接收已结束且可完整解析的 JSON 对象，仍执行同样的业务校验。规划上下文限制为 4096，超时后停止后续方向并保留已通过的结果，规划结果记录 `plannerModel`。存在于模型列表不代表能加载，运行失败会明确返回未检查。以上检查仍不能保证大师级质量，也不能代替商标与人工审美审查。

## Logo 广场

### 本地参考图编辑后端

新环境首次使用参考图时运行 `npm run setup:reference`（需要已安装 `uv`）。该命令在项目内创建 Python 3.11 `.venv`，安装固定版本 MFLUX，下载固定修订的权重，并自动执行圆形、十字形保轮廓改色测试；仅测试通过后启用参考图生成和精修。本机存在 Ollama FLUX 权重时会复用生成模型、文本编码器和 VAE，否则下载完整权重。安装进度可通过 `/api/editor-status` 查看，失败后可以重新运行同一命令续传。模型和环境保存在忽略提交的 `models/`、`.venv/` 下。

参考风格探索使用 MFLUX 的 `Flux2Klein`，选中实际草案后的微调使用 `Flux2KleinEdit`；无参考的首轮探索仍使用 Ollama。MFLUX 使用项目 `.venv`，优先选择已验证的 `models/flux2-klein-local`，其次为 `models/flux2-klein-4b`，可用 `MFLUX_MODEL_PATH` 显式覆盖。需要先通过参考图对照验证并在模型目录写入 `.reference-verified`，才能启用编辑。状态接口根据验证结果和实际模型文件判断，不会被旧下载状态覆盖。安装脚本环境：`uv pip install --python .venv/bin/python mflux`；模型来源为 `Runpod/FLUX.2-klein-4B-mflux-4bit`。原始图片默认保留颜色，换色是可撤销的可选操作。

`scripts/reuse-ollama-weights.py` 将现有 Ollama 4B 生成模型、文本编码器和 VAE 转换到独立的 `models/flux2-klein-local`，不修改 Ollama 原文件。此脚本针对已验证的权重布局，只需下载 tokenizer 及各组件索引；逐一检查转换后的张量名称，并将 Ollama 的 group-32 权重及未量化的嵌入、投影统一转换为 MFLUX 索引要求的 4-bit/group-64 格式。转换后运行 `MFLUX_MODEL_PATH="$PWD/models/flux2-klein-local" .venv/bin/python scripts/verify-mflux.py`，通过圆形/十字形保轮廓改色测试后才能启用；不应手动绕过验证。验证仅证明参考图条件生效，不代表审美质量认证。

首页展示项目内置的 SVG Logos 品牌库，支持品牌搜索、颜色与横向/紧凑构图筛选、单选参考及分批加载。SVG 素材、品牌索引及原始许可证均随项目保存在 `data/svg-logos/`，默认运行不依赖项目外的素材目录，也不需要另行下载图库。仅在需要自定义图库时可通过 `LOGOS_DIR` 显式覆盖，目录须包含 `logos.json` 和 `logos/`。选择参考后，后端读取 SVG 结构特征与视觉风格用于概念规划，不直接沿用参考品牌的主体结构。各 Logo 归其品牌所有，卡片选择区提供品牌来源链接；内置素材来源见 `data/svg-logos/README.md`。

基于 Ollama 与 FLUX.2 Klein 的本地 Logo 创意工作室。它把 Logo 生成从“一条提示词”升级为：品牌简报、差异化创意领地、多种子探索、生成进度、可追溯本地资产。

## 运行

> 模型正确名称是 `x/flux2-klein`，不是 `x/flux2-kleinj`。

```bash
ollama serve
ollama pull qwen3-vl:8b
ollama pull x/flux2-klein:latest
npm start
```

Qwen3-VL 8B 权重约 6.1 GB，负责理解与规划，FLUX 仍负责出图。运行内存还包括上下文和图片处理开销。

当前模型的完整接口验证：`node scripts/verify-local-workflow.mjs`。它实际运行两组简报规划、参考图理解、人形误识别回归检查和三张鹦鹉 Logo 的生成及初筛，结果保存到 `outputs/model-validation/`；生成图片仍需目视检查。旧 `scripts/verify-qwen38.mjs` 仅用于显式指定 Qwen 3.8 的历史检查。

访问 `http://127.0.0.1:4173`。可用环境变量：

```bash
OLLAMA_MODEL=x/flux2-klein:9b OLLAMA_URL=http://127.0.0.1:11434 PORT=4173 npm start
```

4B 版本采用 Apache 2.0，可用于商业项目；9B 版本受 FLUX Non-Commercial License v2.1 约束，不应直接用于商业交付。Ollama 图像生成接口仍处于实验阶段，并且官方当前只标注 macOS 支持。

## 为什么它比普通生成器更接近专业工作流

- 先定义品牌战略，再生成三条本质不同的创意领地。
- 每条领地强制一个单一、可拥有的视觉隐喻，禁止 mockup、渐变和模板化符号。
- 固定 seed，支持有控制地迭代，而不是每次随机重抽。
- 输出 PNG 与同名 JSON 制作记录，保存在 `outputs/`。
- 设计目标明确包含 16px、单色、反白三个压力测试。

## 现实边界

任何生成模型都不能保证“绝对世界级”。真正的顶级 Logo 仍需商标检索、概念选择、人工几何重构、字标定制、视错觉校正和多场景验证。FORMA 的定位是把 AI 变成强创意助理，而不是伪装成无需判断的大师。
