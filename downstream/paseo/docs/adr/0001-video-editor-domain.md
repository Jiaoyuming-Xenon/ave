# ADR 0001: 视频领域服务与受约束后端

## 状态

Accepted for M1 implementation, 2026-11-25.

## 决策

在 Paseo downstream 内建立 first-party `video-editor` 领域。daemon 独占 SQLite、CAS、审批、Job 和 principal 授权；内置插件只提供 schema 校验后的 RPC 与共享 Expo UI。所有写操作绑定 `requestId + expectedRevision`，审批 grant 绑定 plan hash、base revision 和用途。

普通插件继续要求 `daemon.manage`。仅 `video-editor` 的视频命名空间通过经过认证的 `EditorPrincipal` 进行项目级 viewer/operator/owner 授权；不把请求体中的角色视为事实。daemon 将 principal 从 WebSocket admission 传递到内置调用，二进制事件在权限撤销时终止。

FilmCraft 与 FFmpeg 都是受约束的确定性后端。调用方只能选择注册表中的后端偏好，daemon 在接受计划时固定实际后端并纳入 plan hash。后端未经过对应素材矩阵验收时 capability 不可用；FilmCraft 的原始 MCP/TCP/UI 命令、任意路径和离线占位画面不进入产品控制面。

生成 Worker 只消费版本化任务、已批准 BlobRef 和受控参数，不直接修改项目。没有已验证模型时生成 capability 明确不可用，确定性编辑保持可用。

## 可逆性

视频服务不修改上游 Pi/Paseo/FilmCraft 的只读参考 checkout。实现位于本 downstream；回滚通过后续提交移除 domain 注册和插件，不删除原始资产或用户 CAS。DB 采用 expand/contract migration，禁止用降级覆盖用户工程。

## 验收边界

M1 先证明真实 SQLite/CAS、FFmpeg、principal 授权、幂等审批、恢复和取消。真实生成、Android 真机、三桌面安装与签名各有独立验收，未执行的平台不标记完成。
