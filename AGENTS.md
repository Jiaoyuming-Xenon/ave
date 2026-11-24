# AGENTS.md

本文件约束在本仓库工作的编码 Agent。

## 先读

1. `demo.md`：文档地图与当前项目状态。
2. `demo/06-interfaces.md`：跨端唯一契约来源。
3. `demo/07-team-workflow.md`：所有权、并行和集成顺序。
4. `task_plan.md`、`progress.md`：已有决策、错误和验证边界。

## 工程边界

- 当前是设计基线，不得把文档、空目录、假进度、静态图或模拟 Worker 说成已运行应用。
- `pi/`、`paseo/`、`filmcraft/` 是锁定版本参考 checkout，默认只读且被根仓库忽略。不得在其中留下隐蔽产品改动；需要上游补丁时先写 ADR 并确定 fork。
- M1 产品代码位于团队 Paseo downstream fork，按 `plugins/video-editor/shared/contracts` → daemon/Worker → desktop/Android 的依赖方向组织。UI 不直接访问数据库、模型文件或 shell。
- 会话、EditJob、审批、渲染进度分别以真实服务状态为准；`agent_settled` 不等于任务完成。
- 原始资产不可变。所有写操作限制在授权工作区；模型输出不能直接成为路径、URL、命令行或权限。
- 生产 Agent 不添加通用 shell、任意文件读写或未经 schema 校验的执行逃生口。
- 密钥、素材、生成媒体、模型权重、缓存和安装包不得提交。

## 修改契约

跨端改动先更新 schema、兼容策略和 contract test，再改生产者和消费者。新增 RPC 使用可选字段和版本化错误；破坏性变更必须走新命名空间或显式 migration。不得让 Android、桌面、daemon 各自复制出不同实体定义。

## 验证

- 文档/工作流改动：运行 `python3 scripts/check_project.py`。
- 参考仓库边界：运行 `python3 scripts/bootstrap_references.py`。
- 实现代码：运行该包最窄的行为测试，再运行受影响的 contract/integration test；不能用文档校验代替应用测试。
- UI 必须验证实际界面；视频导出必须验证真实媒体、源 hash、完整解码、时间戳、音频和 QA，不以退出码 0 单独认定成功。
- 未运行的平台、模型、转码和安装包明确标为未验证。

## 团队统计

- `DIVISION.svg` 只能由 `python3 scripts/update_division.py` 生成；人员职责与任务状态改 `research/team.json`。
- 完成工作流必须有 `evidence` 指向真实文档、测试或交付物。提交数与有效代码行不是绩效、质量或完成度。
- 功能提交后单独提交统计刷新，提交主题使用 `chore(stats): refresh division`。
