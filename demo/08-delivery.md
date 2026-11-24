# 08 · 测试、发布与验收

[返回总览](../demo.md) · [产品标准](01-product.md) · [团队工作流](07-team-workflow.md)

## 1. 当前与目标流水线

当前根仓库只有 `project-check.yml`：校验 Markdown、相对链接、SVG、团队数据和统计图，没有应用构建能力。以下是实现阶段必须新增的流水线，不表示已经存在或已通过。

上游证据显示 Paseo 已有 Electron Builder NSIS/DMG/AppImage、Expo/EAS APK 和多 OS 测试路径，Pi 已有跨平台二进制构建；这些只证明可复用，不证明新视频应用可构建。

## 2. 测试金字塔

| 层 | 范围 | 必须通过的行为 |
| --- | --- | --- |
| L0 静态/契约 | 格式、类型、lint、schema、fixtures、依赖/许可 | v1 双向兼容、生成物无 diff、插件 import allowlist |
| L1 单元 | 状态机、权限、PTS、存储、幂等、视图模型 | 非法转换、重复请求、取消竞争、损坏输入和迁移 |
| L2 真实组件 | 临时 FS、真实 DB、插件进程、FFmpeg、Worker IPC | 文件锁/长路径/非 ASCII、真实小样本导出、崩溃恢复 |
| L3 E2E | daemon、Electron、浏览器、Android、relay | 完整导入→审批→任务→导出/下载；弱网和双客户端 |
| L4 安装包 | NSIS/DMG/AppImage/APK 正常生产启动路径 | 包内 Pi/FFmpeg/Worker、文件授权、签名、升级、源 hash |
| L5 真实模型 | 固定 GPU/模型/corpus 的 nightly/weekly | 实际视频、QA、资源和人工评审；fake 不算生成验收 |

fake service 只用于客户端并行开发和 contract conformance，不得进入最终 E2E 或发布证据。packaged smoke 不添加专用启动分支。

## 3. 必测数据集

### 3.1 媒体符合性

CFR/VFR、非零首 PTS、B 帧、旋转、SAR、多音轨/5.1、文本/位图字幕、章节/附件、SDR/HDR10/HLG、短/长 GOP、空格/非 ASCII/长路径。每个样本有明确来源和再分发权限。

### 3.2 生成质量

静态、平移、遮挡、形变、多人物、夜景、文字、快速运动、dissolve、长镜头。对照 no-op 确定性渲染、逐帧图片拼接、VACE；ProPainter 仅非商业研究，I2VEdit 许可未核实前不分发。

记录技术通过率、mask IoU/J&F（有 GT 时）、mask 外误差、人工语义通过率、跨段一致性、人工接管率、冷/热时间、峰值 RAM/VRAM、磁盘和重试。输出、输入 hash、配置、seed、代码/权重/依赖 digest、FFmpeg build 和 QA 全部保存。

### 3.3 故障矩阵

- plan DB 提交后/tool result 前 kill；provider job 创建前后 kill。
- Worker 被杀、daemon 重启、插件 crash、桌面 sleep/resume。
- lease 重复、stale complete、乱序/重复 event、磁盘不足、CUDA OOM。
- 输出帧数错误、临时文件完整但未提交、取消发生在每个阶段。
- 手机杀进程、后台、网络切换、relay 断开、重复审批、双客户端审批。
- 旧 app + 新 daemon、新 app + 旧 daemon、旧工程 + 新 reader。

## 4. CI 矩阵

实现时所有 GitHub Actions 固定完整 commit SHA；Node/Bun/Java/EAS 版本锁定，不以 `latest` 作为发布输入。缓存只保存下载内容，不直接复用 `node_modules/dist`。

| 触发 | Job | 环境 | 必过内容 |
| --- | --- | --- | --- |
| PR/main | supply-chain | Ubuntu | 上游 commit/干净树、各自 npm ci、lockfile、漏洞、许可、SBOM |
| PR | contract | Ubuntu | Zod/JSON Schema/fixtures、fake/server conformance、兼容 |
| PR | core-unit | Win/macOS/Linux | 状态机、权限、PTS、迁移、进程树、恢复 |
| PR | app-browser | Ubuntu | App Vitest、真实 daemon + Playwright trace/截图/视频 |
| 桌面路径 PR | desktop-e2e | Ubuntu/Windows，相关时 macOS | 生命周期、preload、文件选择、插件、重连 |
| Android 路径 PR | android-native | Ubuntu + Java 21 | prebuild、Gradle unit、独立 Android lint |
| main/package PR | package-smoke | 对应桌面 runner | 未发布测试包安装/启动/真实导出 |
| nightly | android-emulator | KVM，API 29/35 | APK 安装、配对、权限、审批、取消、重连、logcat |
| nightly/weekly | real-generation | 隔离自托管 GPU | 真实短镜头、QA、资源；fork PR 不暴露 secrets |
| protected tag | release | 受保护环境 + 人工审批 | 签名、安装、SBOM、hash、attestation、draft release |

## 5. 平台构建与发布门

### Windows

复用 `paseo/packages/desktop/electron-builder.yml` 的 NSIS 路径和 `desktop-release.yml` 的 Windows runner。当前上游 release job 未提供 Windows 证书环境变量，因此“可生成 NSIS”不等于“已签名”。

发布必须配置证书和 `forceCodeSigning`，以 `Get-AuthenticodeSignature` 验证状态为 Valid、publisher 匹配；验证安装、启动、卸载、上一版升级。x64 为首发必过，arm64 只有真实运行验收后加入。

### macOS

复用 hardened runtime、entitlements、Developer ID、notarize 配置。新增 Pi、FFmpeg、Python/native 动态库会改变签名闭包，必须重新检查 nested binaries 和 entitlements。

保留 notary submission ID/log；执行 `codesign --verify --deep --strict`、`spctl -a -vv`、`xcrun stapler validate`，挂载**最终 DMG**后启动。仅 `.app` smoke 不算 DMG/Gatekeeper 验收。

### Linux

复用 AppImage/deb/rpm/tar 路径。Ubuntu 24.04 以普通用户执行 AppImage `--appimage-extract-and-run`，覆盖 AppArmor user namespace 受限/可用环境；desktop entry 不得添加 `--no-sandbox`。包内 Pi/FFmpeg/Worker 都执行真实启动和导出。

### Android

复用 Expo prebuild + Gradle `assembleRelease` 或 EAS `production-apk`。固定 EAS CLI，移除 `eas-version: latest`；release profile 跳过 lint 时，必须另有独立 Android lint。

对最终 APK 执行 `apksigner verify --print-certs`、证书 digest 和 versionCode 检查、`adb install -r`，API 29/35 跑权限/后台/重连。EAS managed keystore 不能只凭配置宣称签名正确。收紧公网 cleartext，不能沿用本地开发 HTTP 配置。

## 6. 版本、迁移和回滚

| 版本 | 规则 |
| --- | --- |
| 产品 SemVer | 根 tag；桌面和 Android 同 release train，Android versionCode 单调递增 |
| 插件 contract | capability 返回 server/client 最低版本和 feature flags |
| Worker contract | 独立版本；不匹配拒绝执行，不猜参数 |
| 工程/DB format | `formatVersion + minReaderVersion`，备份、显式 migration |

v1 只新增 optional 字段、可选 feature 和新 RPC；不删字段、不 optional→required、不缩窄类型、不复用错误码。旧客户端需要稳定 coarse state，新细节放 optional `phaseDetail`。破坏性变更新建 v2，不隐蔽改写 v1。

DB 使用 expand/contract，保证新旧 reader 在支持窗口内可打开前一 release 工程。桌面 `allowDowngrade=false` 和 Android versionCode 决定回滚不能靠降级：先停止灰度/updater manifest，再从最后良好源码发布**更高版本号 roll-forward 修复版**。公开 tag 和二进制不覆盖。

## 7. 日志、崩溃和性能

统一上下文：`traceId/spanId/projectId/jobId/requestId/sessionId` 贯穿 App → plugin → Agent → Worker；metric label 不使用 jobId、prompt、路径等高基数字段。

- 默认本地结构化 JSONL，大小/时间 rotation、磁盘配额和 dropped counter；集中上传必须 opt-in。
- 日志 allowlist，不记录 prompt 原文、token、Authorization、源像素/音频或绝对路径。
- Electron `crashReporter.start({ uploadToServer:false })` 本地 minidump；记录 renderer/daemon/plugin/Worker 退出和恢复。
- Android 保存 fatal/ANR、logcat 摘要和 heartbeat；诊断导出显示文件清单并再次脱敏。
- 保存受控 symbols/source maps；公开包不带内部符号。

核心指标包括任务阶段时延/失败、活动任务、恢复次数、模型加载、Worker 重启、导出时延、远程事件 lag/重连、桌面启动、RSS/VRAM、crash-free sessions 和 dropped diagnostics。固定 runner 的回归阈值先以 15% 作为待校准建议，不作为普适 SLA。

## 8. 分阶段验收

| 阶段 | 工作 | 通过条件 |
| --- | --- | --- |
| M0 设计基线 | 本文档、接口、SVG、统计和 Git 工作流 | 项目校验通过；明确无应用实现 |
| M1 集成探针 | Pi SDK/封闭工具、Paseo 插件、FFmpeg、移动配对 | API/权限/恢复探针有输出；形成 ADR 和版本锁 |
| M2 确定性桌面闭环 | 资产、EditGraph、Job、桌面、导出 | 三 OS 真实导入→批准→编辑→导出；源 hash 不变、重启恢复 |
| M3 生成短镜头 | SAM2、VACE、合成、QA | 固定 corpus 的真实成功/失败报告；质量门通过才启用 |
| M4 Android 远程 | 配对、预览、审批、取消、下载、重连 | 真机控制真实桌面任务；viewer 越权失败、重复审批不重复生成 |
| M5 发布候选 | 安装包、签名、公证、更新、SBOM、roll-forward | 干净机器验收，全部发布证据齐全 |

## 9. 发布证据清单

每个候选版本保存：tag/根与上游 commit、工具版本、contract/DB 版本、测试 JUnit/trace、源 hash、ffprobe/decode、真实生成视频和 QA、安装/升级日志、签名证书指纹、SBOM/notices、漏洞/模型许可报告、FFmpeg buildconf、SHA256SUMS、provenance attestation、灰度与 roll-forward 演练。

缺任何目标平台证据，就把该平台标为未验证，而不是以其他平台结果替代。
