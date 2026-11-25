# HDRCut

> 跨平台桌面端无损 HDR 视频剪辑、多音轨混音与字幕工作站（macOS & Windows）

HDRCut 基于 **Tauri v2 (Rust + React 19 + TypeScript)**、原生内嵌 **`libmpv`** 硬解渲染引擎与 **`FFmpeg`** 构建，专为 **100GB+ 4K HDR（HDR10 / HLG / Dolby Vision）大文件**打造：秒开流畅预览、智能帧精确剪辑（Smart Cut）、零重编码直出、多音轨中文重命名与无损混音、多字幕预览/偏移/封装以及多标签页独立工作区。

---

## 核心特性

### 1. 真 HDR 原生硬解预览
- **macOS (Apple Silicon)**：内嵌 `libmpv` + 64-bit float `CAOpenGLLayer` EDR 渲染，支持 HDR 直通与系统色彩管理。
- **Windows (x64)**：原生子窗口 `HWND` + `gpu-next` / D3D11 硬件解码直出。
- **极速索引**：纯 Rust 64 位 MKV EBML Cues / MP4 `stss` 解析器，百 GB 视频秒级加载全部关键帧。

### 2. 智能剪辑（Smart Cut）与无损导出
- **Smart Cut（帧精确剪辑）**：允许在任意帧设置切点，仅对切点处 1 个边界 GOP（数秒）匹配源编码参数局部重编码，其余 99%+ 画面保持 `-c:v copy` 单遍直出，不生成百 GB 临时文件。
- **仅关键帧模式**：一键切换为 100% 零重编码关键帧吸附模式。
- **批量时间段剪辑**：支持「剔除选中区间（默认）」与「仅保留选中区间」，支持自然文本批量导入（例如 `00:01:25-00:02:10 和 00:28:12-00:50:00 和 00:59:32-末尾`）。
- **灵活导出**：支持导出为 **MKV** 或 **MP4**，导出时自动填充 `<源文件名>-edit.<格式>` 防止误覆盖。

### 3. Final Cut Pro 风格时间轴与精确控制
- **浏览预览（Skimming）**：时间轴工具栏可一键开启（快捷键 `S`），鼠标划过时间轴即以橙色浏览线实时预览对应画面，移开后自动恢复主播放头位置与状态。
- **分段精确时间码跳转**：点击当前播放时间即可按 `时:分:秒:帧` 逐段输入并回车跳转。
- **PotPlayer 风格媒体详情**：顶栏实时展示文件体积、分辨率、编码/位深/帧率、码率与 HDR/SDR 状态，点击「详情」查看完整流与色彩元数据。

### 4. 多音轨管理、无损混音与字幕工作站
- **音轨**：自动分析全部内封音轨，支持实时切换试听、UTF-8 中文重命名、设默认轨、单条/批量无损导出、导入单条外部音轨，以及多条音轨无损 **FLAC** / PCM / ALAC / AAC 混音。
- **字幕**：支持读取视频内封全部字幕并手动切换预览、单条/批量导出、导入外挂字幕，且外挂字幕支持按秒调整前后偏移量（预览与导出同步生效）。

### 5. 多标签页独立工作区
- 支持同时打开多个标签页，各自独立保存视频、剪辑区间、音轨/混音、字幕及偏移、导出格式与播放进度。

---

## 快捷键一览

| 快捷键 | 功能 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 5 秒 |
| `Shift + ←` / `Shift + →` | 上一个 / 下一个关键帧 |
| `,` / `.` | 上一帧 / 下一帧 |
| `I` / `O` | 设置入点 / 出点（浏览预览期间直接标记当前浏览帧） |
| `S` | 开启 / 关闭时间轴「浏览预览（Skimming）」 |
| `⌘T` / `Ctrl+T` | 新建标签页 |
| `⌘W` / `Ctrl+W` | 关闭当前标签页 |
| `⌘1` ～ `⌘9` / `Ctrl+1` ～ `Ctrl+9` | 快速切换至第 1～9 个（或最后一个）标签页 |
| `⌘⇧[` / `⌘⇧]` 或 `Ctrl+Tab` | 切换上一个 / 下一个标签页 |
| `⌘O` / `Ctrl+O` | 导入视频文件 |

---

## 下载与使用

前往本仓库的 **[Releases](../../releases)** 页面下载对应平台的自包含成品包（均已内置 `libmpv`、`ffmpeg` 与 `ffprobe`，解压即可使用）：

- **macOS (Apple Silicon arm64)**：`HDRCut-<version>-macos-arm64.dmg`
  - 首次打开若提示「无法验证开发者」，可在终端执行 `xattr -cr /Applications/HDRCut.app` 或在「系统设置 → 隐私与安全性」中点击「仍要打开」。
- **Windows (x64 绿色便携版)**：`HDRCut-<version>-windows-x64-portable.zip`
  - 解压至任意目录，直接双击运行 `HDRCut.exe`（需确保系统已安装 Edge WebView2 运行时，Windows 10/11 默认自带）。

---

## 本地开发与构建

### 环境要求
- Node.js >= 20 & `pnpm` >= 9
- Rust stable toolchain
- macOS：`brew install mpv ffmpeg`
- Windows：MSVC Build Tools + `libmpv-2.dll` / `ffmpeg.exe` / `ffprobe.exe`

### 启动开发模式
```bash
pnpm install
npx @tauri-apps/cli@2 dev
```

### 本地打包
```bash
# macOS Apple Silicon 自包含 .app
pnpm build:mac

# 从 macOS 交叉编译 Windows x64 便携包（需 cargo-xwin）
pnpm build:win
```

### 运行测试
```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

---

## 变更日志

版本历史详见 [CHANGELOG.md](./CHANGELOG.md)。

## 开源协议与第三方声明

- HDRCut 源代码采用 [MIT License](./LICENSE) 许可协议。
- 发行包内附带的运行时二进制依赖分别遵循其各自开源协议：**FFmpeg**（LGPL / GPL）与 **libmpv**（LGPL / GPL）。
