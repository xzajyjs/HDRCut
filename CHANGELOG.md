# Changelog

This project follows Semantic Versioning:
- **Major (`+1.0.0`)**: Architectural overhaul or core logic changes / 重大架构重构或核心逻辑变更
- **Minor (`+0.1.0`)**: New feature sets / 较大新功能或成组功能迭代
- **Patch (`+0.0.1`)**: Bug fixes, single small features, or minor refinements / Bug 修复、单个小功能或微小特性变更

---

## [1.4.0] - 2026-11-25

### English
- **Bilingual UI (English & 简体中文) with First-Launch Language Picker**:
  - Added a first-launch onboarding modal prompting users to choose between **English** and **简体中文**, persisted locally across sessions.
  - Added a 1-click `EN / 中文` language switcher button in the top bar that updates all panels, dialogs, tooltips, and the native window title instantly.
- **CI & Release Workflow Improvements**:
  - Separated branch CI (`.github/workflows/ci.yml`) with `paths-ignore` so documentation, README, and changelog edits skip redundant builds.
  - Configured tag-driven release builds (`.github/workflows/build-release.yml`) to automatically publish bilingual English + Chinese release notes from `CHANGELOG.md`.

### 中文
- **应用多语言支持（English / 简体中文）与首次启动语言选择**：
  - 首次打开 HDRCut 时自动弹出语言选择界面，支持选择 **English** 或 **简体中文** 并本地持久化保存。
  - 顶部栏新增一键语言切换按钮（`EN / 中文`），实时切换全部界面面板、弹窗提示与原生窗口标题。
- **CI 与自动发版流程优化**：
  - 拆分分支校验工作流（`.github/workflows/ci.yml`）并配置 `paths-ignore`，仅修改 README / 文档 / Changelog 时自动跳过构建。
  - 优化标签发版工作流（`.github/workflows/build-release.yml`），自动提取 `CHANGELOG.md` 中英文双语日志写入 GitHub Release。

---

## [1.3.1] - 2026-11-25

### English
- **Final Cut Pro–Style Timeline Hover Skimming**:
  - Added a **Skimming** toggle button in the timeline toolbar (shortcut `S`).
  - When enabled, hovering across the timeline displays an orange skimmer line and previews frames live (fast keyframe seek during rapid sweeps, automatically refining to the exact frame after a brief pause) while keeping the cyan playhead anchored; leaving the timeline restores the original playhead frame and playback state, and clicking commits the skimmer position.
  - Pressing `I` / `O` while actively skimming marks In/Out at the currently visible skimmed frame.

### 中文
- **时间轴悬停实时预览（Final Cut Pro 风格浏览预览 / Skimming）**：
  - 时间轴工具栏新增「浏览预览」开关（支持快捷键 `S` 切换）。
  - 开启后，鼠标在时间轴上移动时以橙色浏览线实时预览对应画面（快速移动时极速关键帧跳转，悬停短暂停顿时自动细化至精确帧），同时保持青色主播放头位置不动；鼠标移出时间轴自动恢复原播放头画面与播放状态，点击即可定位到当前浏览位置。
  - 浏览预览期间按 `I` / `O` 可直接以当前屏幕预览的帧设置入点/出点。

---

## [1.3.0] - 2026-11-25

### English
- **Tab Switching Keyboard Shortcuts**:
  - Added `⌘1`–`⌘9` (Windows: `Ctrl+1`–`Ctrl+9`) to jump directly to tabs 1–9 (or the last tab on `9`).
  - Added `⌘⇧[` / `⌘⇧]` and `Ctrl+Tab` / `Ctrl+Shift+Tab` to cycle between adjacent tabs.
  - Added a native **Tabs** menu and guarded tab switching/closing while export or extraction tasks are running.

### 中文
- **标签页快捷键切换**：
  - 支持 `⌘1` ～ `⌘9`（Windows：`Ctrl+1` ～ `Ctrl+9`）快速切换到对应序号的标签页（`⌘9` 可直达第 9 个或最后一个标签页）。
  - 支持 `⌘⇧[` / `⌘⇧]` 与 `Ctrl+Tab` / `Ctrl+Shift+Tab` 在相邻标签页之间循环切换。
  - 在原生菜单栏新增「标签页」子菜单，导出/提取任务运行期间自动屏蔽切换与关闭操作，防止中断导出。

---

## [1.2.0] - 2026-11-25

### English
- **Multi-Tab Workspace**: Open multiple independent video tabs simultaneously, each isolating its own video, cut ranges, audio/mix tracks, subtitles & offsets, output directory/format, playback position, speed, and volume (`⌘T` new tab, `⌘W` or `×` close tab).
- **External Subtitle Time Offset**: Adjust advance/delay offset in seconds (`-0.5s` / `-0.1s` / manual input / `+0.1s` / `+0.5s` / reset) for imported external subtitles, synced live in `libmpv` preview and applied on FFmpeg export via `-itsoffset`.
- **Timeline Edge Margins**: Added clean horizontal padding and inner canvas margins so start/end ticks, keyframes, and playhead never clip against window edges.

### 中文
- **多标签页工作区**：支持同时打开多个独立视频标签页，各自隔离保存视频、剪辑区间、音轨/混音、字幕及偏移、导出目录/格式、播放进度与倍速/音量；支持 `⌘T` 新建标签页、`⌘W` 或点击 `×` 关闭标签页。
- **外挂字幕时间偏移**：导入的外部字幕支持按秒调整提前/延迟偏移（`-0.5s` / `-0.1s` / 手动输入 / `+0.1s` / `+0.5s` / 归零），`libmpv` 预览与 FFmpeg 导出（`-itsoffset`）实时同步。
- **时间轴边距优化**：为时间轴左右两端增加外层留白与画布内边距，避免首尾刻度、关键帧与播放头贴合窗口边缘。

---

## [1.1.0] - 2026-11-25

### English
- **Media Details Inspector**: PotPlayer-style detailed properties modal displaying container, overall/video bitrate, FPS, bit depth, HDR/color space metadata, and all video/audio/subtitle streams, plus bitrate & HDR/SDR status badges in the top bar.
- **Subtitle Workstation**: Read and live-preview all embedded subtitles, single/batch subtitle export, and external subtitle import.
- **Audio Track Import & Export**: Single/batch lossless audio track extraction and external audio track import.

### 中文
- **媒体详细信息面板**：参考 PotPlayer 文件属性风格，展示封装、码率、帧率、位深、色域/HDR 元数据、全部视频/音频/字幕轨详情；顶栏新增码率与 HDR/SDR 状态徽章。
- **字幕读取、预览与导入导出**：支持读取视频内封全部字幕并手动切换预览，支持单条/批量导出字幕以及导入外挂字幕。
- **音轨导入导出**：支持单条/批量无损导出音轨与导入单条外挂音轨。

---

## [1.0.0] - 2026-11-25

### English
- **Embedded True HDR Hardware Preview**: Built on Tauri v2 + native embedded `libmpv` (macOS 64-bit float `CAOpenGLLayer` EDR + Windows `HWND` / D3D11) for ultra-smooth playback of 100GB+ MKV/MP4/MOV HDR videos.
- **Smart Cut & Keyframe-Only Lossless Export**: Frame-accurate cuts re-encoding only tiny boundary GOPs while 99%+ remains `-c:v copy` in a single pass; supports Remove/Keep modes, batch range parsing, MKV/MP4 output, and default `<source>-edit.<ext>` naming.
- **Segmented Timecode Jump**: Click the current timecode to enter `HH:MM:SS:FF` segment by segment and press Enter to seek.
- **Audio Analysis & Lossless Mixing**: UTF-8 track naming, live auditioning, and multi-track lossless FLAC/PCM/ALAC/AAC mixing.
- **Self-Contained Cross-Platform Packaging**: Automated macOS Apple Silicon (`.app`/`.dmg`) and Windows x64 (`.exe`/`.zip`) build pipelines.

### 中文
- **嵌入式真 HDR 硬解预览**：基于 Tauri v2 + 原生内嵌 `libmpv`（macOS `CAOpenGLLayer` 64-bit float EDR + Windows `HWND`/D3D11），流畅预览 100GB+ MKV/MP4/MOV HDR 视频。
- **智能帧精确剪辑（Smart Cut）与关键帧零重编码**：仅对非关键帧切点边界极短 GOP 重编码，其余 99%+ 画面保持 `-c:v copy` 单遍直出；支持删除/保留模式与批量时间段解析，支持导出为 MKV 或 MP4，保存对话框默认填充 `<源文件名>-edit.<格式>`。
- **精确时间码跳转**：点击当前播放时间可按 `时:分:秒:帧` 分段输入跳转。
- **音轨分析与无损混音**：支持 UTF-8 中文命名、实时试听、多轨无损 FLAC/PCM/ALAC/AAC 混合。
- **跨平台独立打包**：提供 macOS Apple Silicon (`.app`/`.dmg`) 与 Windows x64 (`.exe`/`.zip`) 独立构建脚本与流水线。
