# Changelog

This project follows Semantic Versioning:
- **Major (`+1.0.0`)**: Architectural overhaul or core logic changes / 重大架构重构或核心逻辑变更
- **Minor (`+0.1.0`)**: New feature sets / 较大新功能或成组功能迭代
- **Patch (`+0.0.1`)**: Bug fixes, single small features, or minor refinements / Bug 修复、单个小功能或微小特性变更

---

## [1.7.0] - 2026-11-25

### English
- **Advanced Video Export Mode (Default Lossless Export Preserved 100% Unchanged)**:
  - Kept the default **Lossless Export (MKV / MP4)** button completely untouched while adding a dedicated **Advanced** export modal right alongside it for full custom video transcoding.
  - **8 Mainstream Output Formats & Smart Codec Selection**: Supports `MP4`, `MKV`, `MOV`, `WebM`, `AVI`, `TS`, `FLV`, and `M4V`, with automatic container-compatible video codecs (`H.264`, `H.265/HEVC`, `AV1/SVT-AV1`, `VP9`, `Apple ProRes 422 HQ`, `MPEG-4`), encoding speed presets, and optional macOS Apple Silicon VideoToolbox GPU acceleration.
  - **Aspect-Ratio-Locked Resolution Scaling**: One-click standard presets (`2160p` down to `360p`) and linked custom Width/Height inputs that strictly lock the source video's aspect ratio (automatically rounding to even dimensions and using Lanczos scaling).
  - **Down-Only Frame Rate Control**: Choose from presets or custom FPS strictly capped at or below the source frame rate.
  - **HDR to SDR Tone Mapping (BT.2020 PQ/HLG → BT.709 SDR)**: Built-in tone mapping supporting `Hable` (Filmic), `Mobius`, `Reinhard`, and `BT.2390` curves — powered by `zscale` when present and an automatic pure-Rust 33×33×33 tetrahedral `.cube` 3D LUT generator on macOS so HDR-to-SDR conversion works out of the box everywhere without washed-out colors.
  - **3 Rate Control Modes Including Exact Target File Size Compression (`≤ MB`)**: Supports Constant Quality (`CRF`), Custom Target Bitrate (`Mbps`), and **Compress to Target File Size (`≤ X MB`)** using automatic audio budget allocation, a 4.5% container safety margin, and true 2-Pass ABR encoding so the exported file strictly stays under your chosen MB limit.
  - **Essential Pro Export Controls**: Color depth (`Auto` / `8-bit` / `10-bit`), Rotation & Flip (`90° CW/CCW`, `180°`, Horizontal/Vertical flip), Audio encoding (`Lossless Copy`, `AAC 320/192/128k`, `Opus 160k`, `MP3 192k`, `FLAC`, or `Mute`), Subtitle handling (preserving all edits, names, languages, and time offsets), and MP4/MOV web `faststart`.

### 中文
- **新增「进阶导出」视频转码与编辑功能（默认无损导出逻辑 100% 保持不变）**：
  - 顶部栏原有「无损导出 MKV / MP4」主按钮与直出逻辑完全不变，并在其旁新增「进阶导出」设置面板，满足自定义转码与压缩需求。
  - **8 种主流封装格式与智能编码匹配**：支持 `MP4`、`MKV`、`MOV`、`WebM`、`AVI`、`TS`、`FLV`、`M4V`，覆盖 `H.264`、`H.265 (HEVC)`、`AV1 (SVT-AV1)`、`VP9`、`Apple ProRes 422 HQ`、`MPEG-4` 编码器、多档编码速度预设，以及 macOS Apple Silicon VideoToolbox 硬件加速开关。
  - **锁定源长宽比的分辨率调整**：提供常见清晰度快捷档位（`2160p` ~ `360p`）及宽/高联动输入，强制锁定源视频原始长宽比（自动取偶数像素 + Lanczos 高质量缩放），绝不变形拉伸。
  - **帧率控制（仅支持降低或保持不变）**：自动过滤高于源视频帧率的档位，自定义输入框严格限制上限为源帧率。
  - **HDR 转 SDR 色调映射（BT.2020 PQ/HLG → BT.709 SDR）**：支持 `Hable`（电影感）、`Mobius`、`Reinhard`、`BT.2390` 四种曲线；内置纯 Rust 33×33×33 四面体插值 3D LUT 生成器并在支持环境下自动优先调用 `zscale`，macOS / Windows 开箱即用，色彩自然不泛灰。
  - **码率控制与「按目标文件大小压缩（≤ MB）」**：支持恒定画质（CRF）、指定视频码率（Mbps）和**按目标体积压缩（≤ 设定 MB）**；体积压缩模式自动分配音视频码率、预留 4.5% 封装冗余并执行双遍编码（2-Pass），精准保证输出文件不超过设定大小。
  - **必备专业导出配置**：支持色深选择（自动 / 8-bit / 10-bit）、画面旋转与镜像翻转（顺/逆时针 90°、180°、水平/垂直翻转）、音频编码（无损直出 / AAC / Opus / MP3 / FLAC / 静音移除）、字幕保留/关闭（完整兼容自定义名称、语言与时间偏移）以及 MP4/MOV 网页快速起播（`faststart`）。

---

## [1.6.7] - 2026-11-25

### English
- **Subtitle Batch Offset UI Polish**:
  - The numeric input in the **Batch Offset** bar now stays live-synced with the checked subtitles' shared offset whenever using `-0.5` / `-0.1` / `+0.1` / `+0.5`, Reset All, or Undo/Redo.
  - Fixed a 5px vertical height jump in the Batch Offset box when the **Reset All** button appears or disappears by locking the header row height.
- **Prevent Spacebar Hold Auto-Repeat Loop**:
  - Holding down the `Space` key now toggles Play/Pause once on initial key press and ignores repeat events until released (same for `I` / `O` / `S`).
- **High-Contrast Blue Volume Slider**:
  - Upgraded the playback volume slider with a clear blue progress fill to the left of the thumb, higher-contrast track background on the right, and a crisp glowing thumb indicator.

### 中文
- **字幕批量偏移细节优化**：
  - 使用 `-0.5` / `-0.1` / `+0.1` / `+0.5`、全部归零或撤销/重做修改批量偏移量时，右侧数值输入框现已实时同步展示当前统一偏移值。
  - 固定「批量偏移」标题行高度，修复「全部归零」按钮出现/隐藏时外框高度轻微跳动的问题。
- **修复长按空格键无限循环切换播放/暂停**：
  - 空格键（以及 `I` / `O` / `S` 单次触发键）按下后仅触发一次，松开前忽略系统连发事件，不再循环抖动。
- **音量滑块高对比度蓝色进度条**：
  - 优化音量条视觉样式，滑块左侧显示醒目蓝色填充条、右侧提高轨道对比度，不再与暗色背景融为一体。

---

## [1.6.6] - 2026-11-25

### English
- **Fix MP4 Subtitle & Audio Track Names Disappearing on Re-Import**:
  - Updated `ffprobe` metadata parsing (`extract_track_title`) to read MP4/MOV `name` (`udta/name`) and custom `handler_name` tags in addition to MKV `title` tags (while filtering out generic muxer placeholders such as `SoundHandler` / `SubtitleHandler`), so exported MP4 files retain all subtitle and audio track names identically when reopened.

### 中文
- **修复导出 MP4 后重新打开时字幕与音轨名称丢失的问题**：
  - 完善 `ffprobe` 元数据解析逻辑（`extract_track_title`）：在兼容 MKV 的 `title` 标签基础上，补充读取 MP4/MOV 容器写入的 `name`（`udta/name`）及自定义 `handler_name` 标签（自动过滤 `SoundHandler`、`SubtitleHandler` 等系统占位名），重新打开已导出的 MP4 时将完整还原全部字幕与音轨名称。

---

## [1.6.5] - 2026-11-25

### English
- **Real-Time Export ETA & Write Speed Display**:
  - Added live estimated remaining time (`ETA`), real-time disk write throughput (`MB/s` / `GB/s`), FFmpeg speed multiplier, and written size during video export, plus total elapsed time and average throughput upon completion.
- **Full Multi-Line Layout for Export Completion Toast**:
  - Redesigned the top-left floating toast card into a spacious multi-line horizontal split layout (`status` + `duration · file size · elapsed · write speed` + `output filename` on the left, action buttons on the right), eliminating truncated `13.15 GB…` text while staying cleanly above the native `libmpv` video viewport.

### 中文
- **导出实时显示预估剩余时间（ETA）与写入速度**：
  - 导出进行中实时计算并展示预估剩余时间（`剩余 XXs`）、实时磁盘写入速度（`MB/s` / `GB/s`）、封装倍速与已写入大小，导出完成时同步显示总耗时与平均吞吐速度。
- **导出完成提醒卡片升级为完整多行展示**：
  - 优化左上角圆角矩形提醒卡片排版，左侧支持多行完整展示标题、时长/文件大小/耗时/写入速度以及输出文件名，右侧放置「打开所在文件夹 / 关闭」按钮，彻底解决 `13.15 GB…` 信息被截断的问题，同时保持严格位于原生视频层上方不被遮挡。

---

## [1.6.4] - 2026-11-25

### English
- **Unified Dark Styling for Speed, Subtitle, Audio & Mix Dropdowns**:
  - Removed default macOS grey native `<select>` styling across the playback bar (speed, subtitle, audio track selectors) and audio mixer codec selector using `appearance-none` + custom Lucide chevron icons so every dropdown matches the dark studio UI seamlessly.
- **Fix Project Menu Dropdown Occluded by Video Viewport**:
  - Switched the top-bar **Project** button dropdown to a native OS popup menu (`window.popup_menu_at`) anchored directly beneath the button, ensuring it always renders cleanly above the native hardware-accelerated `libmpv` video view with zero clipping or flicker on both macOS and Windows.

### 中文
- **统一倍速、字幕、音轨与混音编码选择框风格**：
  - 为播放栏的倍速、字幕切换、音轨切换及混音编码 `<select>` 全面启用 `appearance-none` 自定义暗色扁平样式与统一下拉箭头图标，彻底消除 macOS 系统默认的灰底双箭头违和外观，与整体暗色工作台按钮风格保持一致。
- **修复导入视频后「项目」下拉菜单被视频画面遮挡的 Bug**：
  - 将顶部栏「项目」按钮的下拉菜单改为原生系统弹出菜单（`window.popup_menu_at`），精准锚定在按钮正下方，彻底解决被原生 `libmpv` 视频渲染层遮挡的问题，且无任何画面闪烁。

---

## [1.6.3] - 2026-11-25

### English
- **Distinct Paused vs Playing Button Color**:
  - The Play/Pause transport button now displays in red when playback is paused and switches to cyan-blue while actively playing, making current playback state immediately distinguishable at a glance.

### 中文
- **播放/暂停按键状态色区分**：
  - 播放控制栏的播放/暂停按键在暂停状态下改为醒目红色，播放中保持原有蓝色，一眼即可区分当前播放状态。

---

## [1.6.2] - 2026-11-25

### English
- **Top-Left Floating Toast Notifications**:
  - Moved the floating rounded-rectangle notification cards (export, extraction, project save/load, errors, and background auto-update) to the **top-left corner** with a crisp, compact emerald-green design kept cleanly inside the top chrome bar so it is immediately noticeable and never occluded by the native `libmpv` video surface.
- **One-Click Batch Subtitle Time Offset (Embedded & External)**:
  - Added a **Batch Offset** control bar to the Subtitle panel header allowing one-click relative nudges (`-0.5s` / `-0.1s` / `+0.1s` / `+0.5s`), setting all checked subtitles to a specific offset value in one click, and **Reset All** to `0s` — with instant live preview sync and full Global Undo/Redo support.
  - Added a quick **Apply to All Checked** icon button on individual subtitle rows so you can fine-tune one subtitle against the video and copy that exact offset to all checked subtitles in one click.
  - Extended lossless `-itsoffset` subtitle offset export support to embedded (internal) subtitles in addition to external subtitle files.

### 中文
- **浮窗提醒移至左上角更醒目**：
  - 将导出、提取、项目保存/加载、错误提示与后台自动更新的圆角矩形弹窗提醒移至窗口**左上角**，保持翠绿视觉配色与紧凑双行高度（严格位于顶部栏区域内，既一眼可见又永不被原生 `libmpv` 视频画面遮挡）。
- **字幕时间偏移支持一键批量操作（内封与外挂均支持）**：
  - 字幕管理顶部新增「批量偏移」工具栏，支持对全部已勾选字幕一键相对微调（`-0.5` / `-0.1` / `+0.1` / `+0.5` 秒）、一键统一设为指定偏移秒数、以及「全部归零」，并实时联动当前预览画面且支持全局撤销/重做。
  - 单条字幕偏移栏新增「应用到全部已选字幕」快捷图标，调好一条字幕后再点一下即可同步给所有已选字幕；同时为内封字幕也补齐了无损 `-itsoffset` 偏移导出支持。

---

## [1.6.1] - 2026-11-25

### English
- **Top-Right Floating Toast Notifications**:
  - Replaced all bottom full-width status/progress bars (video export, audio/subtitle extraction, project save/load, errors, and background auto-update progress) with sleek floating rounded-rectangle notification cards anchored in the top-right corner, preserving the emerald-green theme for completion states without shifting the timeline layout or overlapping the video viewport.
  - Automatically hides empty `00:00:00 / 00:00:00 · 0 B` metrics on non-media notifications such as project save/load.

### 中文
- **所有底部行提示全面升级为右上角圆角矩形浮窗提醒**：
  - 将原先底部通栏提示条（视频导出、音轨/字幕提取、项目保存/加载、错误提示以及后台自动更新进度条）统一改为右上角悬浮圆角矩形弹窗卡片，保留原有翠绿完成配色，且弹出时不再挤压底部时间轴或遮挡视频画面。
  - 项目保存/加载等非媒体转码类提示自动隐藏无效的 `00:00:00 / 00:00:00 · 0 B` 占位信息，界面更清爽。

---

## [1.6.0] - 2026-11-25

### English
- **Global Undo / Redo Across the Entire Workspace**:
  - Added multi-step (up to 80 steps) global undo & redo covering cut ranges, In/Out markers, cut mode, Smart Cut toggle, audio track edits/reordering/deletion/import/mixing, subtitle edits/delay offsets/deletion/import, tab creation/closing, video loading/closing, output directory, and project loads.
  - Rapid consecutive edits on the same control (such as typing a track title, dragging a timeline cut handle, or nudging subtitle delay) intelligently coalesce into a single clean undo step, while keeping your current playback frame anchored on the same video.
  - Supports native keyboard shortcuts (`⌘Z` / `⌘⇧Z` on macOS, `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` on Windows) as well as Undo/Redo toolbar buttons in the top bar.
- **Project Save, Export & Import (`.hdrcut`) with Missing Source File Relinking**:
  - Save, Export (Save As), and Open/Import `.hdrcut` project files via the new **Project** menu in the top bar, native File menu shortcuts (`⌘S` / `⌘⇧S` / `⌘⇧O`), or by dragging & dropping a `.hdrcut` file directly onto the window.
  - Preserves all open tabs and every source asset reference (source videos, external audio tracks, external subtitle files), along with cut ranges, track edits/ordering/default flags, subtitle delay offsets, audio mixes, playback positions, and export settings.
  - **Missing Media Detection & Smart Relinking**: When reopening a project whose source videos, external audio tracks, or external subtitle files have been moved, renamed, or deleted, HDRCut pops up a dedicated **Missing Media Relink** modal prompting you to locate new paths for each missing file (locating any one file automatically scans the same folder to auto-relink other missing files) or skip individual items to continue loading.

### 中文
- **全局撤销 / 重做（Global Undo / Redo）**：
  - 支持全局多步（最多 80 步）撤销与重做，完整覆盖剪辑区间增删改、入点/出点标记、剪掉/保留模式与智能剪辑切换、音轨编辑/排序/删除/导入/混音、字幕编辑/时间偏移/删除/导入、标签页新建与关闭、视频加载与关闭、输出目录及项目加载等全部编辑操作。
  - 同一控件的连续高频修改（如输入轨道名称、拖动时间轴裁切手柄、连续微调字幕偏移）会自动智能合并为单步撤销记录，且同视频下撤销/重做不会打断当前预览帧位置。
  - 支持全局原生快捷键（macOS：`⌘Z` 撤销 / `⌘⇧Z` 重做；Windows：`Ctrl+Z` 撤销 / `Ctrl+Shift+Z` 或 `Ctrl+Y` 重做）及顶部栏撤销/重做快捷按钮。
- **项目管理（`.hdrcut` 保存 / 导出 / 导入）与缺失源文件重定位**：
  - 顶部栏新增「项目」下拉菜单，支持保存项目（`⌘S`）、导出/另存为项目（`⌘⇧S`）、打开/导入项目（`⌘⇧O`），亦支持直接将 `.hdrcut` 项目文件拖入窗口打开。
  - 完整保存当前所有打开的标签页及全部源文件引用（源视频、外挂音轨、外挂字幕）与剪辑区间、轨道属性/排序/默认标记、字幕偏移、混音配置、播放进度及导出格式设置。
  - **缺失源文件自动检测与弹窗重定位**：重新打开项目时若检测到任何源视频、外挂音轨或外挂字幕已移动、重命名或删除，将自动弹出「源文件重新定位」提醒弹窗，引导逐一选择新路径（定位同一文件夹内的任一文件会自动扫描该目录并批量匹配其余缺失源文件），也支持跳过个别缺失项继续加载项目。

---

## [1.5.2] - 2026-11-25

### English
- **Fix External Subtitle & Audio Preview Track Mismatch**:
  - Disabled `libmpv` automatic folder scanning (`sub-auto=no`, `audio-file-auto=no`) so stray subtitle/audio files in the video directory never shift track IDs behind the scenes.
  - Switched external `sub-add` / `audio-add` to synchronous `libmpv` commands that return the exact assigned track ID (`sid` / `aid`), sync track removal via `sub-remove` / `audio-remove` when deleting tracks, and re-bind exact IDs after `file-loaded` on tab switch.

### 中文
- **修复导入外部字幕/音轨后预览语言错位问题**：
  - 禁用 `libmpv` 默认自动扫描同目录字幕/音频文件（`sub-auto=no`、`audio-file-auto=no`），彻底避免同目录残留字幕文件偷偷占位导致轨道序号偏移。
  - 将外挂字幕/音轨挂载改为同步顺序执行并直接读取 `libmpv` 实际分配的轨道 ID（`sid` / `aid`），删除外挂轨时同步调用 `sub-remove` / `audio-remove` 清理，切换标签页时等待文件加载完成后重新精确绑定轨道 ID。

---

## [1.5.1] - 2026-11-25

### English
- **Single & Batch Delete for Audio and Subtitle Tracks**:
  - Added a dedicated delete icon button directly alongside the export and default-star buttons on every audio track and subtitle track (both embedded and external).
  - Added a header select-all / deselect-all checkbox and a **Delete (N)** batch-delete button to both Audio and Subtitle panels for instant bulk removal.

### 中文
- **音轨与字幕支持单个/批量删除**：
  - 所有内封与外挂音轨/字幕卡片的导出与设默认图标旁均新增单个删除图标，一键移除不需要的轨道。
  - 音轨管理与字幕管理顶部栏新增全选/取消全选复选框与「批量删除 (N)」按钮，支持按勾选快速批量删除。

---

## [1.5.0] - 2026-11-25

### English
- **In-App Automatic Updates (macOS & Windows)**:
  - Automatically checks GitHub Releases (`xzajyjs/HDRCut`) in the background on startup (configurable toggle in the Software Update modal, persisted locally) and supports manual **Check Now** anytime from the top bar.
  - Detects the latest GitHub release version via SemVer comparison, displays full release notes, and performs hands-free self-updating with live download progress, automatic macOS system proxy detection (`scutil --proxy`), atomic bundle/portable replacement, quarantine cleanup, and automatic app relaunch.
  - Safely skips automatic installation while an export task is in progress and allows cancelling downloads anytime.

### 中文
- **应用内全自动更新（macOS & Windows）**：
  - 支持在「软件更新」面板中开关**启动时后台自动检查并全自动更新**（本地持久化），并可随时从顶部栏一键手动触发检查更新。
  - 自动连接 GitHub Releases 识别最新版本号并展示完整更新日志；下载带实时进度条（macOS 自动读取系统代理 `scutil --proxy`），支持 macOS `.dmg` 原子替换 `.app` 自动清隔离属性重启、以及 Windows 便携版 `.zip` 自动覆盖并重启。
  - 导出任务运行期间自动避让不中断作业，下载过程中随时可取消。

---

## [1.4.2] - 2026-11-25

### English
- **Preserve Subtitle Title & Language on Export and Re-Import**:
  - Single and batch subtitle exports now encode track order, title, and ISO language code cleanly in the filename (e.g. `<video> - 11_Portuguese (Brazil) [por].srt`, `<video> - 13_Chinese (Simplified) [chi].srt`).
  - Re-importing exported subtitles (single or batch) automatically restores the exact original track title, language code, and natural track ordering, and also detects standard `[lang]` / `.lang` tags on third-party subtitle files.

### 中文
- **字幕导出与导入保留完整名称与语言代码**：
  - 单条导出与批量导出字幕时，文件名统一保留序号、字幕名称与 ISO 语言代码（例如 `<视频名> - 11_Portuguese (Brazil) [por].srt`、`<视频名> - 13_Chinese (Simplified) [chi].srt`）。
  - 重新导入（单选或多选批量导入）时自动精确还原原字幕名称、语言代码与原始轨道顺序，同时兼容常见第三方外挂字幕的 `[lang]` / `.lang` 语言后缀识别。

---

## [1.4.1] - 2026-11-25

### English
- **Disable Auto-Play on Video Import**: Imported videos now open paused on the first frame by default instead of starting playback automatically.

### 中文
- **导入视频默认不自动播放**：导入视频后默认停留在首帧暂停状态，不再自动开始播放。

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
