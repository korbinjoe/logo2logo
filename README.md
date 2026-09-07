# FORMA — Local Logo Atelier

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

规划按方向分三次短请求，规划、参考图风格解读和视觉初筛统一默认使用 `qwen3.8:latest`。可通过 `OLLAMA_PLANNER` / `OLLAMA_VISION` 分别指定已安装的本地 completion / vision 模型，不允许 cloud 覆盖，不再自动回退到旧模型。Qwen 3.8 请求关闭 thinking，以控制结构化输出的延迟与长度；规划结果记录 `plannerModel`。存在于模型列表不代表能加载，运行失败会明确返回未检查。以上检查仍不能保证大师级质量，也不能代替商标与人工审美审查。

## Logo 广场

### 本地参考图编辑后端

参考风格探索使用 MFLUX 的 `Flux2Klein`，选中实际草案后的微调使用 `Flux2KleinEdit`；无参考的首轮探索仍使用 Ollama。MFLUX 使用项目 `.venv`，优先选择已验证的 `models/flux2-klein-local`，其次为 `models/flux2-klein-4b`，可用 `MFLUX_MODEL_PATH` 显式覆盖。需要先通过参考图对照验证并在模型目录写入 `.reference-verified`，才能启用编辑。状态接口根据验证结果和实际模型文件判断，不会被旧下载状态覆盖。安装脚本环境：`uv pip install --python .venv/bin/python mflux`；模型来源为 `Runpod/FLUX.2-klein-4B-mflux-4bit`。原始图片默认保留颜色，换色是可撤销的可选操作。

本机已用 `scripts/reuse-ollama-weights.py` 将现有 Ollama 4B 文本编码器和 VAE 转换到独立的 `models/flux2-klein-local`，复用已下载的 MFLUX transformer/tokenizer，不修改 Ollama 原文件。此脚本针对本机权重布局，仍需下载完整的 transformer/tokenizer 及各组件索引。转换后运行 `MFLUX_MODEL_PATH="$PWD/models/flux2-klein-local" .venv/bin/python scripts/verify-mflux.py`，通过圆形/十字形保轮廓改色测试后才能启用；不应手动绕过验证。验证仅证明参考图条件生效，不代表审美质量认证。

首页展示本地 SVG Logos 品牌库，支持品牌搜索、颜色与横向/紧凑构图筛选、单选参考及分批加载。默认读取 `~/work/logos`，可通过 `LOGOS_DIR` 指定其他路径；素材保持在原项目中，只读访问。选择参考后，后端读取 SVG 结构特征与视觉风格用于概念规划，不直接沿用参考品牌的主体结构。各 Logo 归其品牌所有，卡片选择区提供品牌来源链接。

基于 Ollama 与 FLUX.2 Klein 的本地 Logo 创意工作室。它把 Logo 生成从“一条提示词”升级为：品牌简报、差异化创意领地、多种子探索、生成进度、可追溯本地资产。

## 运行

> 模型正确名称是 `x/flux2-klein`，不是 `x/flux2-kleinj`。

```bash
ollama serve
ollama pull qwen3.8
ollama pull x/flux2-klein:latest
npm start
```

Qwen 3.8 默认权重约 18 GB，需要支持此模型的新版 Ollama；如果拉取提示需要新版，请先升级 Ollama。Qwen 负责理解与规划，FLUX 仍负责出图。

本机迁移的实际接口检查：`node scripts/verify-qwen38.mjs`。它使用本地 GPU 验证文字输出、参考图解读、已有“两圆人形”鹦鹉失败案例和三个设计方向的结构化规划；依赖该历史 PNG，不生成新 Logo，也不表示审美质量达标。

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
