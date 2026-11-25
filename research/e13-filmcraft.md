# E13 · FilmCraft 适配实测证据（2026-11-25，Linux headless）

对应 `demo/09-risks-research.md` §2 的 E13 必做实验。复现脚本：[`scripts/check_filmcraft_e13.py`](../scripts/check_filmcraft_e13.py)（退出 0 即通过）。

## 环境与固定版本

- FilmCraft 固定 commit `ba6fe10529c7bf5d2a9283f9de2e35c0ccff926c`（workspace `0.20.1`），`cargo build --locked -p filmcraft-cli` 构建成功（dev profile，Rust 1.100.0，Cargo.lock 锁定，craft-libs `33be3562` / craft-fcproj-format `3af2280e` 按 pin 拉取）。CLI 自报 `filmcraft-cli 0.20.1`。
- 对照 FFmpeg：静态构建 `N-129267-g9ec5cf1aac-20261124`（BtbN ffmpeg-master linux64 gpl），仅本地测试工具，不随仓库发布、不改变 FFmpeg LGPL 默认构建策略。
- 样本全部由 FFmpeg 现场生成：CFR 25fps 3s（75 帧，H.264+AAC 48k）、VFR（25/30/24 fps 三段 concat，79 帧）、多流（视频+双 AAC 48k/44.1k+mov_text 字幕）、纯音频 WAV 48k 与 M4A 44.1k。

## 双跑结果（白名单操作：单段 trim 0.5–2.0s + h264/aac 导出）

| 样本 | FilmCraft CLI | FFmpeg 对照 | 结论 |
| --- | --- | --- | --- |
| CFR 25fps | h264 25/1，38 帧，1.520s，PTS 0 起步；AAC 48k 1.514s；全解码 0 错误 | 38 帧，1.520s（PTS 起点差一拍 0.040s）；AAC 1.500s；0 解码错误 | 达标（帧数/时长一致，起始 PTS 差一拍为编码器偏移） |
| VFR（79 帧源） | 输出归一化为序列 CFR 25fps，38 帧，1.520s | 保留源 VFR：33 帧，avg 825/38，1.520s | 不达标：不保留源 PTS，重采样到序列帧率 |
| 多流（v+2a+字幕） | 导出仅 video+audio（单路混音），字幕流不携带 | 同白名单操作下同样只出 V+A | 字幕/多音轨不透传（FilmCraft另有 burnCaptions/captionSidecar 路径，未纳入本次白名单） |
| 纯音频 WAV→WAV、M4A→AAC（0.2–1.5s） | 1.300s，采样率 48k/44.1k 保留，0 解码错误 | 1.300s，采样率一致，0 解码错误 | 达标 |

## kill/restart 与离线素材

- 导出中 `kill -9`（rc=-9）：`.fcproj` 项目 revision 完好（rev 2、未 dirty、条目齐全），重新打开后再次导出成功（75 帧、3.000s）。达标。
- 素材缺失：导出列出 `offlineMedia`（含 os error 2 与路径）、以占位帧渲染、stderr 警告、退出码 1；显式 `--allow-offline` 才退出 0。符合 fail-closed 设计，达标。

## 结论

仅 CFR A/V 白名单操作（单段 trim + h264/aac 导出、音频导出）达到 E13 通过条件；VFR 时间保真、字幕与多音轨透传不达标。按 §2 退出条件，FilmCraft 不承担这些能力，保持为受限后端，FFmpeg 仍是 ffprobe/VFR/多流/字幕/生成回合与独立 QA 的基线后端（ADR 005/006 不变）；ADR 011 的 E13 前置实验已落档。桌面/Android/远程三平台仍未验证，不在本轮范围。
