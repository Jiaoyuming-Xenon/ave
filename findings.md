# 调研记录

> 结论优先引用论文、官方文档和当前仓库源码。访问日期：2026-11-24。固定版本：Pi `fcc33744b072b9bb5529fa4ff8b151f9fa578e14`，Paseo `c626bf37071491981fc8e11c3e2f4df093381d37`。实际实施仍需锁定发布版并重验 API。

## 1. 输入与交付范围

- 根目录 `demo.md` 是需求构想；`pi` 和 `paseo` 是完整上游参考仓库，不存在产品应用源码或构建配置。因此本次重写设计文档，不宣称交付了 GUI 或视频模型。
- 原始关键帧思路值得保留：把昂贵的视觉内容创作集中在少数可人工确认的帧。但它不是完整的视频编辑算法，更不能把逐帧图像生成直接拼回视频。

## 2. Pi：复用 agent 内核，而非修改 CLI

证据：
- [Pi SDK](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/packages/coding-agent/docs/sdk.md)：`createAgentSession` 可显式配置 cwd、模型、工具、资源和持久化 SessionManager；支持 subscribe 事件流、prompt/steer/followUp/abort、`agent_settled`。
- [Pi 扩展](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/packages/coding-agent/docs/extensions.md)：`pi.registerTool()`、`before_agent_start` 可注册工具和修改 system prompt；扩展与 Pi 同进程同权限。
- [Pi RPC](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/packages/coding-agent/docs/rpc.md)：可供独立进程进行 JSON 控制。
- [Pi 安全](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/packages/coding-agent/docs/security.md)：没有内置沙箱，cwd 和 project trust 不构成文件系统边界；外部内容可形成提示注入。
- [README](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/README.md)：MIT，Node.js >= 22.19。

决定：
1. **已被第 10 节与 ADR-003 supersede**：早期曾选择独立 Pi RPC 子进程；后续源码核验发现 RpcClient 生命周期限制，现改为独立 agent-worker 内使用 `createAgentSession`，由自有版本化 IPC 承载生产控制，原始 RPC 仅作探针。
2. 生产会话不开放通用 read/write/edit/bash，只暴露 schema 校验的视频工具；开发排错另开用户显式启用的专家模式。
3. system prompt 不声称“保证视频一致性”，而要求先分析再计划、工具结果为准、禁止覆盖源文件、生成前提交计划、QA 失败必须诊断或请求人工处理。
4. 系统 prompt 不能替代权限；工具服务必须独立验证工作区、资产、参数和状态转换。
5. 锁版本；扩展也按不可信代码管理。

待验证：Pi 事件到视频任务进度的映射；模型能否稳定输出结构化 EditPlan；不同视觉模型支持的图片数量/大小与费用。

## 3. Paseo：复用宿主与远程连接，视频功能插件化

证据：
- [架构](https://github.com/getpaseo/paseo/blob/c626bf37071491981fc8e11c3e2f4df093381d37/docs/architecture.md)：Node daemon + Expo Android/Web + Electron 桌面；同一 WebSocket 协议；可选 E2EE relay。Pi 是进程适配器，通过 `pi --mode rpc`，不是直接 SDK。
- [插件](https://github.com/getpaseo/paseo/blob/c626bf37071491981fc8e11c3e2f4df093381d37/docs/plugins.md)：插件有独立 server subprocess 和 client runtime，支持 typed RPC、订阅、workspace panels、screen、composer attachment sources、设置、agent hooks。插件本身不沙箱化。
- [权限](https://github.com/getpaseo/paseo/blob/c626bf37071491981fc8e11c3e2f4df093381d37/docs/permissions.md)：daemon 有 principal/grant 和 owner/operator/viewer 预设；当前 grant 为 daemon-wide。文档明确说明文件预览可能读任意 daemon 可读文件，因此在 workspace-scoped 授权补齐前不能声称严格的移动端工作区隔离。
- [协议兼容](https://github.com/getpaseo/paseo/blob/c626bf37071491981fc8e11c3e2f4df093381d37/docs/protocol-compatibility.md) 和 [架构](https://github.com/getpaseo/paseo/blob/c626bf37071491981fc8e11c3e2f4df093381d37/docs/architecture.md)：协议向后兼容，新字段 optional、新 RPC 用 dotted namespace；媒体/文件已有独立分块二进制传输，WebSocket 有高水位背压。
- [README](https://github.com/getpaseo/paseo/blob/c626bf37071491981fc8e11c3e2f4df093381d37/README.zh-CN.md)：Apache-2.0。

决定：
1. 在 Paseo 中加视频 domain 作为内置插件 `video-editor`，桌面以同一 Expo Web UI 为编辑器，移动复用相同只读/审批操作。
2. daemon 新增受控 `MediaService`，而不是将原始路径或大段 base64 视频放进对话。大文件使用分块上传/下载、hash 校验、流式磁盘写入，不经过模型上下文。
3. Pi 由视频插件/provider 进程拥有。不要同时走 Paseo 的通用 Pi provider 和自管 SDK 两套会话状态。
4. 传输加密不等于工具授权；移动端 viewer 仅可读预览/进度，暂停/取消、生成与导出需要 operator 权限。服务端仍需检查每种操作的权限。
5. 第一版禁用来源不明的工作区脚本、插件、自动资源加载和网络转发，减少远程攻击面。

待验证：内置插件对桌面原生文件拖放/选择的支持是否足够；大文件预览应采用 HTTP Range 还是现有文件协议；插件权限能否限制到视频 domain，不扩大成整个 workspace.write。

## 4. 参考论文 VideoRepainter（CVPR 2025）

来源：本地论文 `Guo_Keyframe-Guided_Creative_Video_Inpainting_CVPR_2025_paper.pdf`，[官方开放获取](https://openaccess.thecvf.com/content/CVPR2025/html/Guo_Keyframe-Guided_Creative_Video_Inpainting_CVPR_2025_paper.html)。

实际机制：
1. 输入视频、逐帧 mask，以及可选的已编辑关键帧；先由图像 inpainting 得到关键帧，再由视频模型传播修改。
2. 不是将编辑帧光学流 warp 到全片；它将 SVD 图像到视频模型改造成视频 inpainting 模型。
3. 对称 mask condition 分别编码黑/白填充图，靠 latent 差异避免低分辨率 mask 的边界歧义。
4. 训练输入卷积及 attention LoRA，可训练参数 27.9M，UNet 总参数约 1525.9M（<2% 更新不代表推理只需 2% 资源）。
5. SVD 一次 14 或 25 帧；长视频用稀疏锚帧 + 重叠子序列 MultiDiffusion。
6. 训练使用自采 300K 视频、16 A100、50K 迭代；推理 25 steps；实验为 320×576 和 576×1024。
7. 定量集为 50 个 DAVIS inpainting 和 20 个自制编辑样本；不能把论文指标直接外推到所有真实视频。
8. 局限：依赖图像模型和 I2V 域能力，跨域新增物体可能几乎不动；假定用户已经给 mask，自然语言到 mask 并非论文已解决的能力。

开源状态：2026-11-24 对 GitHub `VideoRepainter` 仓库搜索无结果，未确认官方代码/权重；因此架构参考其思路，不把它作为 MVP 可直接依赖的组件。

## 5. ProPainter 调研

来源：[官方仓库](https://github.com/sczhou/ProPainter)。

- ICCV 2023，面向物体移除和视频补全，需要视频/帧和逐帧 mask；包括光流补全与传播/Transformer 模块。
- 默认 subvideo_length=80 用于解耦显存与总视频长度；可调 neighbor/ref stride、分辨率与 fp16。
- 官方表：720p、80 帧 fp16 约 25GB；720×480、80 帧 fp16 约 8GB，320×240 约 3GB。这证明不能承诺任意消费级机器原生 1080p/4K 本地生成。
- NTU S-Lab License 1.0 限制非商业使用，不能默认纳入商业产品分发。
- 作用：作为对象移除/补全的实验 baseline，不等于新物体创作，也不作为默认商业引擎。

## 6. 编辑流水线的方向

- **关键帧是“创意条件/审批点”，不是唯一的信息来源。** 分析阶段可读取镜头摘要、接触表、少量上下文帧、音频转写；执行阶段需读取片段和 mask。
- **每个镜头至少一个编辑锚点，数量自适应。** 运动、遮挡、视角、形变、曝光变化、失败 QA 会增加锚点；段落内不能靠固定 1 帧保证效果。
- **引擎按任务路由。** 确定性编辑（裁剪、重定时、转场、调色）走 FFmpeg/时间线；对象移除走传统补全；局部语义创作走关键帧 + 视频传播；全镜头重绘是显式高成本模式。不能让扩散模型承担所有任务。
- **在镜头边界分段。** 先检测候选 cut，再让人工/agent 校正；保留 VFR 时间戳、原始音频、原色彩和帧率策略。
- **低分辨率预览 + 原分辨率最终导出。** 预览不能承诺最终分辨率细节一致；最终结果必须重新 QA。
- **QA 是门而非文字评语。** 解码完整性、时长/时间戳、音画同步、mask 外像素、接缝/闪帧、身份/对象持久性、文本与品牌、语义符合需求；失败可重选锚点、缩短片段或切换引擎。

## 7. 候选组件与实测边界

### SAM 2.1

来源：[官方仓库](https://github.com/facebookresearch/sam2)、[Meta 介绍](https://ai.meta.com/sam2/)。

- 点击/框/掩码提示后在视频中传播，可追加帧修正、多目标跟踪；适合“用户/agent 选对象 → 逐帧 mask”，而非无条件自动理解意图。
- 仓库说明 checkpoint、demo 和训练代码 Apache-2.0；页面另列 BSD-3-Clause 与第三方组件许可，集成时需按实际文件生成 NOTICE，不能只写单一许可。
- Python >=3.10、PyTorch >=2.5.1；Windows 官方强烈建议 WSL Ubuntu；官方性能测于 A100。不能承诺所有桌面平台有相同速度/显存。
- 必须在镜头边界重置视频状态，在遮挡/跟丢/镜头切换处要求修正；这些是产品安全约束，不冒充官方已报告的定量失败率。

### I2VEdit

来源：[官方仓库](https://github.com/Vicky0522/I2VEdit)。首次猜测的 `RichardSunnyMeng/I2VEdit` 是 404，已纠正为 GitHub 检索出的作者仓库。

- 输入首帧编辑结果和源视频，motion LoRA + inversion/denoising + attention matching，提供 skip interval 支持多段。
- README：默认 512×896；自定义 motion LoRA 推荐至少 A100、300GB 磁盘；已有示例一段约需 20GB GPU、100GB 磁盘。长视频需要额外时间/存储，单个 timestep 的 attention maps 约 3GB。
- 适合作为技术对照，不作为轻量桌面 MVP 默认推理后端。仓库 LICENSE 页面读取失败，未独立确认许可，禁止默认分发。

### VACE

来源：[官方仓库](https://github.com/ali-vilab/VACE)。

- 支持 text + video + mask + reference image，覆盖 V2V/MV2V/R2V 等；是候选“统一视频生成后端”，不代表其关键帧控制等效于 VideoRepainter。
- `Wan2.1-VACE-1.3B` 约 81×480×832；`Wan2.1-VACE-14B` 约 81×720×1280。仓库 Apache-2.0，Wan 系模型页面标注 Apache-2.0；LTX 模型为 RAIL-M，不应混为同一许可。
- 文档没有最低 GPU/VRAM 数字，不能自行宣称低配置可运行。提供本地/远程 Worker 接口，用真实硬件 benchmark 决定默认模型。
- 官方提醒 prompt extension 在编辑时可能与输入不匹配并损害效果。Agent 不能擅自扩写关键对象/否定约束。

### PySceneDetect

来源：[官方仓库](https://github.com/Breakthrough/PySceneDetect)。

- ContentDetector/AdaptiveDetector 候选切点，ThresholdDetector 用于淡入淡出；能输出 scene 时间码/帧号。BSD-3-Clause。
- 镜头检测只给候选边界；产品需处理 dissolve、闪光灯、快速运动和跨镜头对象身份，并允许手动合并/拆分。

### FFmpeg

来源：[官方文档](https://ffmpeg.org/ffmpeg.html)。

- `-map` 必须显式选择视频、音频等流；`-c copy` 不能配 filter；`-fps_mode passthrough` 保留 demuxer 时间戳，`vfr` 可能去重相同时间戳，`cfr` 会重复/丢帧。
- `-shortest` 在最短流结束，可能截音/视频且存在缓冲延迟，不能作为音画同步的通用解法。
- 工程上每条 EditOperation 明确时间区间、PTS 映射、帧率策略与音频策略；导出后 ffprobe 和全片解码检查。未用真实素材验证前，不承诺 stream copy、HDR、字幕或附件保持。
- 优先 FFmpeg 8.x 稳定版并锁构建；版本是实施锁定建议，不是跨平台已验证事实。当前环境检测到 `/usr/bin/ffmpeg`、`ffprobe` 8.0.1-3ubuntu2，只验证了版本探测，尚未运行视频转码样本。

## 8. 需要写入最终设计的核心决策

1. **双层任务模型**：用户会话（Pi）与持久 EditJob 分开；对话中止不丢任务，重连可恢复。模型计划不是数据库事实。
2. **非破坏编辑图**：Asset immutable + Project/Revision + deterministic operations + generative clip revisions + output manifest。文件使用内容 hash，保留参数、seed、模型 digest、依赖版本、mask lineage。
3. **状态机**：draft → analyzing → awaiting_plan → awaiting_keyframes → rendering_preview → awaiting_review → rendering_final → validating → completed / failed / cancelled。agent 不可自行越过用户审批门。
4. **三段式 agent 工具**：inspect（探测、镜头、接触表、转写）、propose（结构化计划/锚点/mask）、execute（提交已审批的 DAG，进度/QA/取消/导出）。execute 只接受 job id，不接受任意 shell。
5. **移动端监督而非大文件编辑器**：看预览、时间线状态、回答问题、审批、暂停/取消、下载成品；桌面负责 mask/帧精修和本地文件管理。
6. **性能预算按片段**：记录模型加载、首 token、mask、每关键帧生成、传播、编码和 QA；不做虚假的固定时间承诺。预览默认短镜头，长片增量。
7. **基线与降级**：确定性 FFmpeg 工作流无 GPU 可交付；生成后端不可用时明确标记未配置，不生成假结果。
8. **MVP 收口**：先桌面端到端 + Android 监控 + 一种真实生成后端；Mac/Win/Linux 打包矩阵按阶段验收，而不是同时铺开多个模型和平台。
9. **研究问题通过试验定参数**：关键帧数量、镜头长度、预览分辨率、重试次数均是配置和实验变量，不写无依据的固定“最优值”。
10. **试验矩阵**：静态/平移/遮挡/形变/转场/夜景/文字/多人物/长镜头；与逐帧图像、ProPainter（非商业）、候选 VACE 后端比较。同时记录语义成功、mask 外保真、时序闪烁、时间/显存/磁盘与人工接管率。

## 9. 媒体链路增量核验

### VACE 输入、长视频与输出边界

- [VACE User Guide](https://github.com/ali-vilab/VACE/blob/main/UserGuide.md)：`src_video` 以灰值 127 标待生成区，`src_mask` 白色生成、黑色保留；reference image 不是任意稀疏关键帧严格约束。官方长视频建议是约 5 秒分段和 `firstclip` 延续，`frameref` 支持首/尾帧，不承诺任意中间锚点。
- [Wan 推理入口](https://github.com/ali-vilab/VACE/blob/main/vace/vace_wan_inference.py)：默认 81 帧且要求 `4n+1`；脚本输出无声 `out_video.mp4` 和预处理输入，没有源音频、字幕或原时间线合成路径。因此 VACE 只产生候选视觉资产，应用必须重接音频/字幕、恢复时间映射、合成保护区域并重新 QA。
- [VACE LICENSE.txt](https://github.com/ali-vilab/VACE/blob/main/LICENSE.txt) 为 Apache-2.0；annotator、第三方依赖和权重仍需独立 SBOM/NOTICE。官方测试环境为 Python 3.10.13、CUDA 12.4、PyTorch >=2.5.1，未给消费级最低显存。

### SAM2 状态与恢复

- [SAM2 video predictor](https://github.com/facebookresearch/sam2/blob/main/sam2/sam2_video_predictor.py) 的 `inference_state` 持有输入帧、对象、prompts、memory features 和缓存；`reset_state()` 清空状态。每镜头独立 state，修正事件进入后续传播。
- 未找到稳定的跨版本 inference-state 序列化契约。持久化 prompts/correction log、源帧索引、模型 digest 和已输出 mask，崩溃后重放或重跑；最后一张 mask 不等于完整跟踪检查点。

### FFmpeg 构建与合规

- [硬件选项](https://ffmpeg.org/ffmpeg.html#Advanced-options)：`-hwaccels` 只表示构建能力，实际依赖硬件/驱动；GPU 回传可能更慢。必须逐平台探测 decode/filter/encode 链路并记录软件回退，不能承诺零拷贝。
- [法律说明](https://ffmpeg.org/legal.html)：默认 LGPL 2.1-or-later，GPL/nonfree 组件会改变分发约束；libx264 是 GPL。每平台保存二进制 hash、configure、对应源码和 NOTICE，不能只记 FFmpeg 版本。
- `libvmaf_cuda` 官方示例要求 `--enable-nonfree`，不得悄悄并入 LGPL-only 构建；VMAF 只用于同源编码质量对照，不衡量生成语义。

### 时间线、音频、字幕和色彩

- [OTIO 架构](https://opentimelineio.readthedocs.io/en/stable/tutorials/architecture.html) 可交换 Timeline/Track/Clip 和有理数时间，但不替代 EditJob、mask 或生成数据库；CMX3600 只作为明确有损交换。
- 内部事实源采用版本化 EditGraph JSON + SQLite Revision；所有持久时间用有理数，导入保存 decoded presentation PTS/duration/time_base，proxy 和模型 CFR 输入各存 SamplingMap，禁止用平均帧率反推 VFR 源帧。
- 视频生成不修改音频。音频使用 sample-clock timeline，字幕使用 cue timeline，导出显式流映射、期望 sample 数、encoder delay/padding 和字幕转码/烧录策略；禁止用 `-shortest` 掩盖同步错误。
- 生成 MVP 固定 SDR/BT.709 工作路径。`setparams` 只改色彩标签，不转换像素；HDR 生成、tone map、字幕/附件/HDR 全组合往返均为独立验收项。

### 可恢复 Worker 与 QA

- Scheduler 独占 SQLite 状态；Worker lease 使用递增 `leaseEpoch` fencing，完成按至少一次投递 + 幂等提交。输出先写临时 CAS，经 hash/manifest 验证后事务提交；过期 Worker 的 complete/checkpoint 必须拒绝。
- VACE 官方 CLI 未提供 mid-diffusion checkpoint 或协作逐步取消。首版取消终止独立进程组，未完成的短镜头从头重跑；不得宣称冻结 CUDA 上下文或任意 sampler 内部续跑。
- QA 分导入、执行前、生成 clip、合成前、最终文件和发布六门。编码前保护区可与源渲染逐像素比较；编码后与同编码 baseline 比较，区分有损噪声和真实越界。
- 黑帧/冻结/静音检测只作有上下文告警；光流、LPIPS、身份 embedding、VLM 和唇同步阈值必须经人工标注集标定，未标定前不能自动放行。
- 首个真实生成后端收口为 Wan2.1-VACE-1.3B、480p、短段、`4n+1`；14B/LTX/I2VEdit/ProPainter 不进入首版生产依赖。无兼容 GPU 时保留确定性编辑，明确生成能力未配置，不返回源片或静态图冒充成功。

## 10. Pi Runtime 增量核验

- [`createAgentSession`](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/packages/coding-agent/src/core/sdk.ts) 提供 modelRuntime、sessionManager、settingsManager、resourceLoader、tools/customTools 等完整宿主接缝。生产设计改为独立 agent-worker 内使用 SDK，自有 IPC 管理生命周期；不再优先把原始 Pi RPC/RpcClient 暴露给应用。
- [`rpc-client.ts`](https://github.com/earendil-works/pi/blob/fcc33744b072b9bb5529fa4ff8b151f9fa578e14/packages/coding-agent/src/modes/rpc/rpc-client.ts) 当前有固定 100ms 启动等待、固定 30s 命令超时、SIGTERM 后 1s SIGKILL、缺少公开 extension_ui_response 等限制。原始 JSONL RPC 只作探针。
- SessionManager 是 JSONL 对话树，能恢复上下文但不恢复 Promise/工具/外部任务；写入不是领域事务，message_end 事件也不等于磁盘提交。Plan/Approval/Job/Artifact 必须独立 SQLite。
- ResourceLoader 可禁扩展、技能、prompt、context files；生产配置不读取素材项目的资源和 MCP。扩展与 Pi 同权限，project trust/cwd 不是沙箱。
- `submit_edit_plan` 用 strict JSON Schema constrained sampling + terminate。`outputSchema` 声明不等于验证，daemon 仍需 schema/语义/canonical hash/幂等校验。模型没有 approve/apply/render 工具。
- `session.abort()` 只中止 Agent，不取消已接受媒体任务；任务取消走 daemon。`agent_end` 不是最终空闲，`agent_settled` 后仍需检查计划/任务。
- Pi Durable 提供 requestId 去重、durable task/replay/park，但当前为 Experimental；首版不隐式依赖。
- 关键证据：`core/{sdk,agent-session,session-manager,resource-loader,model-runtime}.ts`、`core/extensions/types.ts`、`docs/{security,extensions,rpc-extension-ui,compaction}.md`。仅源码调研，未运行探针。

## 11. 构建、发布与团队工作流核验

- `paseo/packages/desktop/electron-builder.yml` 和 `.github/workflows/desktop-release.yml` 已有 NSIS、DMG/ZIP、AppImage 路径；`packages/app/eas.json` 与 `android-apk-release.yml` 已有 APK 路径。均是可复用构建基础，不是新应用已通过构建。
- Windows release job 当前未传入 CSC 证书变量，不能宣称 NSIS 已签名；macOS 已有 hardened runtime/notarize，但最终 DMG 仍需 stapler/Gatekeeper 验收；Android 使用 `eas-version: latest` 且 release 跳过 lint，必须锁版本并另设 lint/emulator 门。
- `paseo/packages/plugin/src/rpc.ts` 的 defineRpc/defineSubscription 使用 Zod；二进制帧和 media-stream 示例可复用。内置插件需注册到 builtinPlugins，只允许 plugin SDK、zod 和 Node built-ins，且不沙箱化。
- Paseo 当前通过 `pi --mode rpc` 且默认另行安装 Pi；新产品必须显式打包受控 runtime 或声明前置条件。Pi 的 `scripts/build-binaries.sh` 和 build-binaries workflow 可作为跨平台打包参考。
- 上游各有 lockfile/overrides/patches，不合并为新的根 npm workspace。当前 M0 根仓库用 `research/upstream.json` 锁定并忽略本地参考 checkout；M1 需要修改 Paseo 时必须建立团队 downstream fork，再以精确 gitlink 管理，不能提交 dirty nested repo 或浮动 main。
- 当前 autoUpdater `allowDowngrade=false`，Android 也不能依赖降级。事故采用停止灰度 + 更高版本号 roll-forward；工程/DB 用 expand/contract。
- 当前未运行上游 build/lint/tests，未产出任何安装包。完整路径和发布证据要求见 `demo/08-delivery.md`。

## 12. Paseo 客户端与远程链路增量核验

- Expo Web 和 Android 是同一 Expo Router 壳，Metro 支持 `.electron.ts(x)` overlay；可共享 DTO/视图模型/RN 基础组件，但桌面时间线和移动审批不能共用整个编辑器实现。
- `PluginClientContext` 支持 workspace/agent panels、commands 和 attachments；composer plugin attachment 最终是文本，只传 asset/revision/range 引用，不传视频字节。
- `plugin.rpc.invoke/subscribe` 当前要求 `daemon.manage`，不能直接开放 viewer/operator。M1 必须新增 first-party `video.v1` 协议和授权 broker，对 inbound、outbound、binary、项目资源和 connected-host 权限交集逐项校验。
- 插件 subscription 断线不重放，agent permission 通知 hook 不是阻塞审批门。Job/Approval 必须 daemon 持久化，恢复用 snapshot + epoch/seq + idempotency 查询。
- 当前 file transfer 顺序读取整文件，客户端最终拼完整字节数组；FileChunk 没有 offset/length/续传。HTTP 下载无 Range/206/416/ETag，token 单次消费，relay 只转发 WebSocket。首版采用 WS 分块 + 流式写盘；Range 只作桌面直连可选 adapter。
- 当前 ConnectionOfferV2 无 invitation expiry、single-use、client identity/grants，密码/local credential 登录得到完整 owner。远程审批前必须新增可撤销 device credential + scoped grants，不能把指纹确认当设备授权。
- `daemon.relay.requireProtectedSecurity` 当前默认 false；legacy 无同等 replay protection。远程审批强制 protected，Noise NK 不替代持久设备身份。
- HostProfile 密码可存 AsyncStorage；新设备凭据使用 expo-secure-store，并验证 Keystore 升级/卸载/备份行为。
- 当前 app 无 expo-video/转码/后台渲染依赖；新增 expo-video 仅播放 proxy。Android 不负责生成，background-task 不用于实时同步。F-Droid 无 QR/push 时用 pasted-link + 前台拉取。
- 外部插件 server 无沙箱、client bundle eval，首版只启用 first-party 签名插件；Electron 主窗口 sandbox 需要显式开启并验证 preload。
- 证据：`packages/{app,desktop,plugin,protocol,server,client,relay}` 对应源码与 `docs/{permissions,connected-hosts,relay-endpoint-security}.md`。仅静态调研，未运行真机或媒体传输测试。

## 13. FilmCraft 增量调研（2026-11-25，进行中）

### 官方材料首轮观察，待源码复核

- [FilmCraft README](https://github.com/storytold/filmcraft)：Rust NLE，支持三桌面和 WebAssembly；GUI、CLI、JSON-lines TCP 控制通道与 MCP 共用带 ID、类型参数和 enabled 状态的命令注册表，宣称超过 650 个 engine commands。这个“同一命令内核、多入口”的分层比把 GUI 点击动作逐个暴露给 LLM 更值得复用。
- 其 `engine` 管命令/session/undo/jobs，`ui-egui` 只是可替换前端；`time/project/edit/render/gpu/export` 分层与本项目 EditGraph/Worker/ToolGateway 存在直接比较价值。
- README 宣称自研 H.264/HEVC/ProRes/AAC 等、无 FFmpeg 运行时依赖、254016000000 ticks/s 整数时间、原子保存/恢复、内容缓存预览、OTIO/FCPXML/AAF 等交换。以上均是上游声明，尚未在本项目环境编译或跑真实素材验证。
- 上游同时明确自身是 alpha：估算 ready for real work 约 56%；调色、keys 和部分导出仍走 CPU；Windows/Linux 测试少于 macOS；HEVC 导出依赖硬件，AV1 无导出；实际相机/手机文件覆盖有限。因此不能把“命令多”直接视为成熟生产后端。
- 许可为 MIT OR Apache-2.0，需保留 NOTICE 和第三方资产/字体归属；ArtCraft 品牌与 logo 不属于代码许可，修改/再发行版本必须移除。
- 同组织值得进一步核验的相关项目是 PhotoCraft（图像图层/mask）、EffectCraft（动态图形/VFX）、SoundCraft（音频）以及各项目共享的 command/control 机制；Pdf/Word 等与本项目无直接关系，不纳入集成范围。
- 初步设计假设：优先研究“一个共享、可撤销的编辑命令服务，同时供 Agent 和 GUI 调用”，而不是分别做 Agent 工具和手动 GUI 两套执行路径。是否采用 FilmCraft 本体，取决于源码中的协议、进程隔离、任务恢复、时间戳/流保真和 headless 运行能力。

### 控制协议、项目模型与任务边界

- [架构](https://github.com/storytold/filmcraft/blob/main/docs/architecture.md)确认 headless engine 通过 `Session::execute(id, params)` 统一处理编辑；`CommandSpec` 含 ID、参数说明、enabled/journal，修改用 `Arc<Project>` copy-on-write 快照，undo 200 项。254016000000 tick/s 是常见帧率和采样率的公共整数时基；本项目可以在 FilmCraft 边界转换 Rational，不应为接入它而放弃原 PTS/SamplingMap。
- [控制协议](https://github.com/storytold/filmcraft/blob/main/docs/control-protocol.md)的桌面 JSONL 仅监听 loopback，但要求每次会话随机 token；同机其他 OS 用户仍可能访问 loopback。`engine.execute` 可运行 engine/UI 命令，`ui.*` 可输入、截图、写指定路径，不能把该原始端口暴露到 relay/Android。
- [Agent 文档](https://github.com/storytold/filmcraft/blob/main/docs/agents.md)明确 headless MCP **没有目录限制**，绝对路径导入且能按用户权限读写。MCP 的 readOnly/destructive/idempotent annotations 只是客户端提示，不是本项目授权；生产仍走封闭 ToolGateway + daemon 白名单，不直接加载上游 `.mcp.json`。
- 长导出可用 `wait:false` 返回 job 并轮询/取消；但任务/队列是 session 状态，项目保存不合并并发会话，CLI `--save` 锁不覆盖 desktop/MCP。故本项目每个 engine session 单写者，Job/审批/lease/结果未知仍由 daemon 持久化，不能把 FilmCraft job ID 当作恢复协议。
- 离线素材会渲染占位画面：MCP 导出仍可成功，只在结果中列 `offlineMedia`。适配器必须 preflight 检查所有资产并令 `offlineMedia != []` 为硬失败，禁止占位画面进入 completed/导出。
- 项目格式是有版本迁移的 `.fcproj` JSON，原子写+fsync、自动保存和恢复日志完善，但媒体按路径引用，identity 只是 size+首尾各 1MiB 的 64-bit fingerprint，不是本项目要求的 SHA-256。源资产身份和 CAS 仍由 MediaService 负责，FilmCraft 项目仅作后端私有临时状态。
- CPU 参考渲染与 GPU 快路径、代理、线性光合成、颜色管理、字幕、音频混合和 OTIO 等是真实复用价值；但不因为上游宣称“跨机器可复现”就省略本平台 ffmpeg/全片解码/PTS/音画 QA。硬件编码 auto 可能回退软件，结果 manifest 必须记录实际 encoder/warnings。
- [PhotoCraft](https://github.com/storytold/photocraft) 同样 command-first，适合未来锚帧图层/蒙版/PSD 精修；early alpha 且官方说不能作为日常 Photoshop 替代，不纳入首版。
- [EffectCraft](https://github.com/storytold/effectcraft) 覆盖合成、动效和表达式，但项目年轻、Windows/Linux 有基础交互缺陷且模型仍评估；首版 FilmCraft 已含效果/转场，不再引入第二套时间线事实源。
- [SoundCraft](https://github.com/storytold/soundcraft) 的 MCP 有独立 `--automation-read-root/--automation-write-root`，比 FilmCraft 更接近受限 Worker，但为 pre-alpha，且首版 FilmCraft 已有响度、音频效果和 mixing；保留为以后音频专项适配器，不与首版并行集成。

### 固定源码核验与最终选型

- 固定 FilmCraft `ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c`（workspace `0.20.1`，Rust `1.95`），commit 时间 `2026-11-23T17:33:20-06:00`。普通完整 clone 因 HTTP/2 EOF 失败，改用 HTTP/1.1、depth 1、blob:none 稀疏克隆成功；仅审阅与集成相关源码，未构建。
- [Cargo.toml](https://github.com/storytold/filmcraft/blob/ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c/Cargo.toml) 还把大部分 craft-libs 固定到 `33be35625e252cc4f06aa375b3b428521faea37d`；`craft-fcproj-format` 是 `3af2280ee3434a2c860012df2f440652621c2c81`。实施必须锁定 Cargo.lock 和整个依赖图，不能只锁主仓库。
- [commands.rs](https://github.com/storytold/filmcraft/blob/ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c/crates/engine/src/commands.rs) 的 `params` 是供人/Agent 阅读的 JSON-ish 文本；[automation/server.rs](https://github.com/storytold/filmcraft/blob/ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c/crates/automation/src/server.rs) 的 `RunParams` 只给外层 `id: String + params: Value` 生成 schema。结论：**不能把原生 command catalog 当作本项目严格工具契约**，需逐操作写 schema、语义校验和 golden fixtures。
- [engine/lib.rs](https://github.com/storytold/filmcraft/blob/ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c/crates/engine/src/lib.rs) 的 `Session::new` 默认 `FsServices`，文件接口直接接收路径；其 `Session.revision/document_epoch`、jobs、export_queue 都是进程内状态。daemon 必须另存 `approvedRevisionHash + backendSnapshotHash + backendJobId`，重启后对账，不能因 FilmCraft undo/recovery 就取消自己的 Revision/Job。
- [export_tools.rs](https://github.com/storytold/filmcraft/blob/ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c/crates/engine/src/export_tools.rs) 证明 `wait:false` 返回 job/poll/cancel，`wait:true` 仍可在成功结果里携带 `offlineMedia`；适配器非阻塞提交，完成时同时检查 engine result、offlineMedia、产物 hash、ffprobe 和 QA。
- [control_server.rs](https://github.com/storytold/filmcraft/blob/ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c/apps/filmcraft/src/control_server.rs) 有 64 hex token、4MiB 行限制、16 连接和 120 秒 socket 超时，适合本地人工专家桥，但所有 engine/UI 命令都可达，不能作为移动端/模型原始工具表面。

### 方案比较与决定

| 方案 | 优点 | 不可接受/代价 | 结论 |
| --- | --- | --- | --- |
| 原生 MCP 全量暴露给 Agent，GUI 直接嵌入整套 FilmCraft | 最快获得大量按钮与编辑能力 | 无目录限制、无审批/严格 schema、双项目/Job 状态、UI 技术栈分裂，650+ 命令增加规划与误操作面 | 拒绝作为生产路径；仅用于隔离探针 |
| 本项目统一 EditGraph/EditCommand，FilmCraft 做独立 Rust 后端，GUI/Agent 共用 daemon 命令 | 保留现有安全、审批、恢复和生成链；GUI 手动与 Agent 结果天然可比较/撤销；按能力路由可回退 | 需要写适配器、操作映射和真实媒体矩阵 | **采用，待 E13 探针** |
| 完全不采用，只 FFmpeg | 最少依赖 | 放弃现成 NLE、关键帧参数、调色/混音、代理、交换格式和 command-first 设计 | 保留为兼容/QA 与未覆盖能力后端，而非唯一方向 |
| 一次引入 Photo/Effect/SoundCraft | 功能广 | 多套项目/时间/任务事实源、alpha 风险、打包和许可闭包膨胀 | 首版排除，未来独立适配器评审 |

最终边界：GUI 手动工具和 Agent 规划共用 `EditCommand`/EditGraph，**不是两套执行逻辑**。FilmCraft 只消费受控 staging 中的源资产和 canonical operation，输出必须回 CAS；不拥有用户项目、审批、CAS、远程连接或最终 Job 状态。FFmpeg 仍是 ffprobe、VFR/多流/附件、生成回合成和独立 QA 的基准后端。首版不把 FilmCraft WASM 放进 renderer，也不将 egui 窗口当主工作台；可选“专家模式”另开 FilmCraft 窗口只能作用于派生副本并显式重导入。

- 成品审片复测：根快照与本地 downstream 同名文件逐字节一致。首次运行缺少 protocol/dist/plugin-requirements.js，插件编译子进程未能导入 workspace 依赖；先构建依赖再复验。
