# 贡献与并行开发

## 1. 工作单元

一个 PR 只交付一个可验证切片：契约、后端行为、桌面交互、Android 行为、媒体 Worker 能力或文档决策。禁止把跨端协议、多个模型后端和平台打包混在同一 PR。

开始前在 `research/team.json` 认领工作流并设为 `in_progress`；完成时必须给出可点击 `evidence`，不能把“已提交代码”直接等同于“验收完成”。

## 2. 所有权与评审

| 改动 | 主要作者 | 必须评审 |
| --- | --- | --- |
| 总体架构、跨域 ADR、contracts | K | L + 受影响端 J/C |
| daemon、JobRunner、ToolGateway、Worker | K / L | 另一方；跨端时加 J/C |
| Android、移动审批与移动远程联调 | J | C（协议/远程）+ 后端（契约） |
| Electron、桌面编辑器与桌面远程联调 | C | J（协议/远程）+ 后端（契约） |
| 生成模型、mask、媒体 QA | L | K + C（预览/导出） |
| 发布矩阵与跨平台兼容性 | 对应平台作者 | K |

GitHub 账号和分支保护尚未配置，不能伪造 `CODEOWNERS`。团队确定账号后应把上表映射为真实代码所有者。

## 3. 分支和集成顺序

1. 从最新 `main` 创建短生命周期分支：`feat/<area>-<slice>`、`fix/<area>-<issue>`、`docs/<topic>`。
2. **contracts 先行**：schema、错误、事件和兼容测试独立评审并合并。
3. 后端、桌面、Android 在稳定契约上并行；消费者不得读取生产者内部数据库或复制 DTO。
4. 每日 rebase 到最新 `main`，冲突在契约所有者之间解决；不通过覆盖他人分支消除冲突。
5. 合入顺序：契约 → 后端/Worker → 桌面/Android → 跨端联调 → 发布。独立文档和测试可与所属切片同步合入。
6. 合入采用 squash 或团队约定的线性历史；禁止把本地上游参考仓库加入提交。

## 4. 契约变更

- 先写生产者、消费者和失败路径，包含旧客户端 + 新 daemon、新客户端 + 旧 daemon。
- 新增字段默认可选；新增 RPC 使用 `video.<domain>.<action>` 命名空间。
- revision、审批和导出请求必须幂等；过期 revision 返回可识别错误，不隐式覆盖。
- 破坏性变更需要新 schemaVersion、迁移、回滚策略与双方评审，不能只改 TypeScript 类型。

完整字段和状态见 [`demo/06-interfaces.md`](demo/06-interfaces.md)。

## 5. 提交和本地门

```bash
git config core.hooksPath .githooks
python3 scripts/check_project.py
python3 scripts/bootstrap_references.py
```

提交主题建议：`feat(backend): ...`、`fix(worker): ...`、`docs: ...`。每个提交应是可审查单元，不能依赖后续“补实现”提交才能通过校验。

功能提交后刷新统计：

```bash
python3 scripts/update_division.py
# 只提交 DIVISION.svg，主题固定为：
# chore(stats): refresh division
```

该独立统计提交不进入提交计数，解决“统计图记录自身提交”导致的不稳定。禁止手改 SVG 或用代码行数填进度。

## 6. 最低验证

| 类型 | 必须证据 |
| --- | --- |
| contracts | schema、兼容、非法输入、幂等测试 |
| daemon | 状态转换、权限、重启恢复、并发审批、取消 |
| Worker | 协议、崩溃/超时、检查点、确定性小样本、资源清理 |
| 桌面 | 实际 Electron 界面、文件授权、播放器、导出、平台安装包 |
| Android | 真机权限、后台/杀进程、网络切换、重连、上传/下载 |
| 媒体 | 源 hash、全片解码、PTS/时长/音画、mask 外保真、时序 QA |
| 文档/脚本 | `python3 scripts/check_project.py` 和受影响脚本实际运行 |

CI 失败不得通过删除断言、缩窄素材、伪造模型输出或跳过平台来“修复”。无法在当前机器验证的项目必须明确留给对应平台 CI 或真机验收。
