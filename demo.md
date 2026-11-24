# Agentic Video Editor 设计总览

> 版本：团队可执行设计基线，2026-11-24。原始需求见 [`research/demo.original.md`](research/demo.original.md)，证据见 [`findings.md`](findings.md)。
>
> 本仓库当前交付的是设计、接口契约、团队工作流和可执行校验脚本，**不是已经实现的视频编辑应用**。任何模型效果、安装包、真机、性能或兼容性结论都必须在对应验收阶段提供真实证据。

## 项目一句话

构建一个本地优先的跨平台 AI 视频编辑工作台：Agent 将自然语言意图转成可审查、可撤销、可复现的 EditGraph，桌面端执行真实媒体与生成任务，Android 通过同一 daemon 远程监督、审批和接收视频交付。

## 四项目标如何落地

| 原始目标 | 工程实现 | 不可接受的替代 |
| --- | --- | --- |
| Windows `.exe`、macOS `.dmg`、Linux `.AppImage`、Android `.apk` | Electron + Expo Web 桌面，Expo Android，复用 Paseo 构建与远程基础设施 | 浏览器能打开就宣称安装包完成 |
| 桌面 GUI 与本地 Agent 编辑本地视频 | 视频专用 Pi Runtime、受控 ToolGateway、非破坏 EditGraph、FFmpeg/Worker | 通用 shell 直接改文件；聊天文本冒充编辑结果 |
| 移动端监控与控制同一工作区 | 配对、typed RPC/events、预览、审批、取消、上传下载、断线重连 | 手机 UI 直接操作 Worker 或绕过 daemon 权限 |
| 上传视频并以视频交付 | 内容寻址资产、代理、局部/全片 QA、原子导出、manifest | 静态图、源片、假进度或无效链接冒充输出 |

## 文档地图

| 文档 | 内容 | 主要读者 |
| --- | --- | --- |
| [01 产品与交付标准](demo/01-product.md) | 用户、范围、功能/非功能需求、平台和完成定义 | 全员 |
| [02 总体架构](demo/02-architecture.md) | 进程、数据、状态、部署、所有权和故障边界 | K、L |
| [03 Agent Runtime](demo/03-agent-runtime.md) | Pi 集成、工具、prompt、模型配置、会话和事件 | K、L |
| [04 媒体与生成流水线](demo/04-media-pipeline.md) | EditGraph、FFmpeg、SAM2、VACE、Worker、QA | K、L、C |
| [05 客户端与远程控制](demo/05-clients-remote.md) | 桌面、Android、Paseo 插件、传输、权限和联调 | J、C |
| [06 接口与数据契约](demo/06-interfaces.md) | DTO、RPC、事件、错误、Worker 消息和兼容策略 | 全员 |
| [07 团队分工与并行开发](demo/07-team-workflow.md) | K/L/J/C 工作包、依赖、里程碑、统计与集成 | 全员 |
| [08 测试、发布与验收](demo/08-delivery.md) | 测试矩阵、benchmark、CI/CD、签名、发布与回滚 | 全员 |
| [09 风险、许可与实验](demo/09-risks-research.md) | ADR、实验问题、许可、隐私、风险和退出条件 | K、L |

## 已确定的系统决策

1. **EditJob 与 Agent 会话分离**：对话停止不取消持久任务；Pi 的 `agent_settled` 只表示模型轮次结束。
2. **视频领域服务是唯一所有者**：不再让 Paseo 通用 Pi provider 与视频服务同时写同一会话；客户端不直接访问 Worker、SQLite 或 CAS 私有路径。
3. **确定性优先**：裁切、拼接、缩放、音频和字幕走 EditGraph + FFmpeg；只有语义创作进入生成后端。
4. **关键帧是条件和审批点**：不是整片理解的唯一输入，也不保证任意镜头只改一帧；需要 mask、时序传播、合成和 QA。
5. **首个生成后端收口**：实验 Wan2.1-VACE-1.3B 的 480p 短镜头，固定代码/权重 digest；未通过 benchmark 前不成为默认能力。
6. **原片不可变、派生物内容寻址**：Revision、mask lineage、SamplingMap、模型/构建 digest 和 QA 均进入可追溯 manifest。
7. **权限在服务端执行**：配对和 E2EE 不替代逐 RPC principal、项目、操作、revision 和预算校验。
8. **无 GPU 仍有真实价值**：确定性导入、编辑和导出可用；生成后端不可用时明确未配置，不生成伪结果。
9. **契约先行、四人并行**：Paseo downstream fork 中 `plugins/video-editor/shared/contracts` 是唯一跨端事实源，按后端、桌面、Android 分工作业，跨端变更走同一 contract PR。

## 当前状态与下一阶段

- 已完成：需求重构、一手资料调研、架构与接口设计、分工图及统计生成、文档/链接校验、根 Git 工作流。
- 未实现：产品源码、Pi/Paseo 探针、桌面/Android UI、daemon、Worker、模型接入、安装包和发布管线。
- 下一道门：按 [M1 集成探针](demo/08-delivery.md) 验证真实上游 API，再锁定实施版本；不得直接按设计文档大规模并行写代码后才发现上游边界不成立。

## 快速导航

[架构 SVG](ARCHITECTURE.svg) · [分工 SVG](DIVISION.svg) · [README 与初始化](README.md) · [贡献规范](CONTRIBUTING.md) · [路线图](ROADMAP.md) · [执行记录](progress.md)
