# Agentic Video Editor Demo 调研与重写

## 目标

阅读现有 `demo.md`、`pi`、`paseo` 与参考论文，结合一手技术资料验证关键帧视频编辑方案，产出可实施、可验收的重写版 `demo.md`。本次交付是需求、技术架构与实施计划，不将参考仓库改造成未经需求确认的完整产品。

## 阶段

- [x] Phase 0：确认项目输入、范围与已有会话状态
- [x] Phase 1：调研 pi 与 paseo 的可复用边界、扩展机制、运行依赖及许可约束
- [x] Phase 2：精读参考论文，调研关键帧选择、视频理解、局部编辑、时序传播、评估与导出技术
- [x] Phase 3：形成架构决策与可验证的 MVP 路线，记录调研依据与风险
- [x] Phase 4：备份并重写 demo.md，校对需求、技术事实、接口和验收标准
- [x] Phase 5：核验交付文件、链接、计划覆盖范围，报告尚未实证的部分

## 续作：团队可执行版与仓库工作流

- [x] Phase 6：扩展调研 Agent 全生命周期、客户端、远程协议、媒体/模型、数据安全、测试发布与团队并行边界
- [x] Phase 7：重构 `demo.md` 为文档入口，在 `demo/` 中完成项目概述、交付标准、具体分工、技术栈、实现方案与并行开发计划
- [x] Phase 8：绘制并关联 `ARCHITECTURE.svg`，新增 `DIVISION.svg` 及可重复运行的数据/图形更新脚本
- [x] Phase 9：补齐 README、AGENTS/CLAUDE、贡献规范、路线图、进度数据、Git hooks/CI 等工作流文件
- [x] Phase 10：初始化根 Git 仓库，验证文档链接、SVG、脚本、统计口径和读者可理解性

## 已确定的原则

- 优先复用上游扩展接口，避免 fork 后难以跟进。
- 区分已有一手资料支持的设计、待实验的设计与远期能力。
- 不把“少抽帧”直接等同于“可靠的视频编辑”；局部生成必须配时序传播、接缝处理和 QA。
- 先定义端到端可交付的最小工作流，再安排跨平台打包和移动遥控。
- 原视频不可变；所有编辑操作可恢复、可复现，导出必须保留音视频同步。

## 交付物

- `demo.md`：重写后的产品与技术设计
- `findings.md`：带一手来源的调研记录与决策依据
- `progress.md`：执行与核验记录

## 环境记录

- 根目录已初始化 `main` Git 仓库并配置 `.githooks`；`pi` 与 `paseo` 保持独立、锁定且干净的参考 checkout，由根 `.gitignore` 排除。
- 根目录现有九份专题设计、SVG、团队数据和工作流脚本，没有应用源码或构建配置；M1 实施需建立 Paseo downstream fork。
- 已有 Node.js/npm、Python 3、Git 和 Inkscape；本任务只执行文档/脚本校验与 SVG 渲染，不以应用编译安装为验收目标。

## 错误记录

| 记录 | 处理 |
| --- | --- |
| 环境探测命令因 `pnpm` 不在 PATH 返回非零 | 仅记录工具缺失；不以 pnpm 作为本次文档任务依赖 |
| 两次 WebSearch 返回空结果，未给出来源 | 改用官方 GitHub/项目页直接检索，未将空结果当成技术结论 |
| 一次 I2VEdit WebFetch 分类器超时 | 后续检索 GitHub 定位正确官方仓库 |
| 猜测的 `RichardSunnyMeng/I2VEdit` 与另外两个猜测仓库 URL 返回 404 | 不沿用未证实 URL；从 GitHub 检索确认 `Vicky0522/I2VEdit` |
| I2VEdit/VACE 的 GitHub LICENSE 具体页 404 | 只引用官方 README 明示的许可信息，未核实部分要求实施前审计 |
| CVF HTML 抓取 403 | 精读用户提供的 CVF 开放论文 PDF，保留官方链接但不断言网页抓取成功 |
| FFmpeg 首次长文档抓取未覆盖全部时间戳选项 | 继续读取后半部分，确认 `-shortest`/`-fps_mode`/`-copyts` 语义 |
| 参考仓库校验将 `status --porcelain` 错作单个 Git 参数 | 修正为 `status`, `--porcelain` 两个 argv，并重新执行校验 |
| 自进化验证脚本一度使用不存在的 lesson key `bash_timeout` | 改用实际 `long_command`；随后确认五端使用 compose 后的规则文本 |
| 统计脚本对临时测试仓库输出调用 `relative_to(ROOT)` 失败 | 输出实际路径，重新验证提交归属、有效行与统计提交自引用稳定性 |
| gitlink 聚合将带换行的 `rev-parse` 输出与无换行索引 SHA 比较，导致 downstream 永远不计入 | 对实际 HEAD 使用 `.strip()`；以根仓库和 downstream 各 1 提交、2 行有效源码的临时仓库回归 |
