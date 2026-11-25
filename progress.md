# 执行记录

## 2026-11-24

- [x] 确认根目录内容与现有需求。
- [x] 启动 PDF 与持久化调研流程。
- [x] 创建任务计划，确定交付为研究支撑的需求/架构重写。
- [x] 调研两个参考项目：版本、SDK/RPC、插件/协议、远程权限、构建目标和许可。
- [x] 精读 CVPR 2025 参考论文，补充 ProPainter、I2VEdit、VACE、SAM 2.1、PySceneDetect、FFmpeg 官方资料。
- [x] 备份原始需求至 `research/demo.original.md`，`cmp` 验证备份与原文件一致。
- [x] 重写 `demo.md`：12 章、385 行，包含需求、架构、状态、工具、prompt、UI、远程安全、QA 和阶段验收。
- [x] 静态校验：6 个相对链接目标全部存在，Markdown 代码围栏成对。
- [x] 核对 Pi 1.5.2、Paseo 0.17.4 和本机 FFmpeg/ffprobe 8.0.1-3ubuntu2 版本；只执行版本探测，未测试转码。

## 2026-11-24 · 团队可执行版续作

- [x] 完成 Pi Runtime、Paseo 客户端/远程、媒体/模型、测试发布四路独立源码与官方资料调研。
- [x] 将 `demo.md` 重构为入口，在 `demo/` 完成产品、架构、Agent、媒体、客户端、接口、团队、交付、风险九份专题文档。
- [x] 修正生产 Agent 集成：独立 agent-worker 内使用 `createAgentSession`，自有 IPC；不再把原始 Pi RPC/RpcClient 作为生产控制面。
- [x] 修正远程媒体与权限：专用 `video.v1` 授权协议、WS 分块媒体；Range 仅作桌面直连可选优化，不向 viewer 暴露 daemon.manage。
- [x] 绘制 `ARCHITECTURE.svg` 并链接到架构文档；生成 `DIVISION.svg`，成员只显示 K/L/J/C 代号。
- [x] 实现 `research/team.json` + `scripts/update_division.py`：工作状态、证据进度、Git 提交数和有效代码行自动统计。
- [x] 补齐 README、AGENTS/CLAUDE、CONTRIBUTING、ROADMAP、PR 模板、Git hook、文档 CI、上游锁和参考恢复脚本。
- [x] 初始化根 `main` 仓库，设置 `core.hooksPath=.githooks`；确认 `pi/`、`paseo/`、会话文本和 PDF 不进入根仓库。
- [x] `python3 scripts/check_project.py` 通过：18 份 Markdown、2 份 SVG、团队数据和相对链接一致。
- [x] `python3 scripts/bootstrap_references.py` 通过：Pi `fcc33744b072`、Paseo `c626bf370714` 均锁定且干净。
- [x] 使用 Inkscape 实际渲染 1000px 宽架构图与分工图并检查布局、文本、箭头和卡片边界。
- [x] 接续完成 Gate B 并行措辞，并复核读者评审修正：审批/上传契约、语义幂等、Worker 路由、暂停状态、发布门和 CI 证据链接。
- [x] 在无 `.git`、`pi/`、`paseo/`、PDF 和预览图的临时干净副本中运行项目校验，18 份 Markdown、2 份 SVG 全部通过。
- [x] 用临时根仓库和 `vendor/paseo` gitlink 实测统计聚合：K、L 各 1 提交和 2 行有效源码；统计提交前后 SVG 字节一致。
- [x] 修复 gitlink 聚合的 HEAD 换行比较问题，并记录到 `task_plan.md`；用脏参考仓库负向测试确认校验退出码为 1。

## 2026-11-25 · FilmCraft 增量调研与架构优化

- [x] 固定 FilmCraft `ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c`（0.20.1），核验 Cargo/craft-libs、engine/automation、导出、控制服务和许可源码；调研 PhotoCraft、EffectCraft、SoundCraft 官方材料。
- [x] 选择共享 EditCommand/EditGraph + 可插拔确定性后端，不把原生 MCP/650+ 命令直接暴露给 Agent，不将 egui 作为主工作台，不形成第二套项目/Job 事实源。
- [x] 明确 GUI 手动工具和 Agent 使用同一操作 schema、后端路由、Revision、审批和 QA；FilmCraft/FFmpeg 失败不静默互切，换后端必须新审批。
- [x] 增加 FilmCraft capability、私有 snapshot/backendJobId 映射、actualEncoder/warnings/offlineMedia、后端错误码及 E13 双后端验收矩阵；离线占位成功为硬失败。
- [x] 更新架构图、产品、Agent、媒体、客户端、接口、团队、发布、风险、上游锁和参考恢复脚本；Photo/Effect/SoundCraft 不进入首版。
- [x] 主仓库与无 `.git`/参考检出的干净源码副本分别通过 18 份 Markdown、2 份 SVG 校验；架构图重新渲染检查，FilmCraft commit 与依赖锁核对通过。
- [x] FilmCraft 以 `upstream.json` 明示的稀疏范围恢复并核验干净；完整历史恢复遇到多次网络 EOF，未完成全量源码包下载，中间状态保留为本地忽略备份。
- [ ] 构建 FilmCraft 并执行 E13 真实媒体/性能/三平台对照；本轮只做源码与文档调研，不宣称后端已运行或已验收。

## 验证边界

- 本次没有编写应用代码，没有构建 GUI/APK/安装包，没有运行模型、素材转码或效果 benchmark。
- WebSearch 空结果与部分 WebFetch 失败已记录到 `task_plan.md`，未将失败的抓取当作资料事实。
- 原始 `pi`、`paseo` 仓库未修改；仅新增根目录调研/计划文件并重写 `demo.md`。

## K · 审片续验

- 构建 protocol 后，Linux Chrome 三种工作台场景通过；server/video 另 8 套 26 项通过（含 25/30 fps CFR、25 fps VFR、批准成品下载后完整解码）。本轮非 Electron 或 Android 验收。
