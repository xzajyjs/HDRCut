#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# One-click macOS -> Windows x64 (.exe & NSIS Installer) Cross-Compilation Script
# Uses cargo-xwin (Microsoft CRT/SDK) + LLVM lld-link — ZERO Windows VM needed!
# ==============================================================================

cd "$(dirname "$0")/.."

echo "==> [1/5] Checking Rust Windows target & cross-compile toolchain..."

if ! rustup target list --installed | grep -q "^x86_64-pc-windows-msvc$"; then
  echo "    Installing Rust target x86_64-pc-windows-msvc..."
  rustup target add x86_64-pc-windows-msvc
fi

if ! command -v cargo-xwin >/dev/null 2>&1; then
  echo "    Installing cargo-xwin..."
  cargo install cargo-xwin --locked
fi

# Ensure LLVM (lld-link & llvm-rc) is in PATH if installed via Homebrew
if [ -d "/opt/homebrew/opt/llvm/bin" ]; then
  export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
fi

if ! command -v lld-link >/dev/null 2>&1; then
  echo "❌ Missing LLVM lld-link. Install it on macOS with:"
  echo "   brew install llvm nsis"
  exit 1
fi

echo "==> [2/5] Building frontend dist/..."
pnpm build

echo "==> [3/5] Cross-compiling HDRCut.exe (x86_64-pc-windows-msvc) on macOS..."
if command -v makensis >/dev/null 2>&1; then
  echo "    NSIS detected — building both HDRCut.exe and Windows NSIS Setup Installer!"
  cargo-tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
else
  echo "    NSIS not installed (optional: brew install nsis). Building portable HDRCut.exe..."
  cargo-tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
fi

echo "==> [4/5] Fetching Windows x64 runtime libraries (libmpv-2.dll, ffmpeg.exe, ffprobe.exe)..."
if [ ! -f "dist-windows-deps/libmpv-2.dll" ] || [ ! -f "dist-windows-deps/ffmpeg.exe" ]; then
  bash scripts/fetch-windows-deps.sh
fi

echo "==> [5/5] Assembling ready-to-run portable Windows x64 folder..."
OUT_DIR="dist-windows-x64"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

EXE_PATH="src-tauri/target/x86_64-pc-windows-msvc/release/hdrcut.exe"
[ -f "$EXE_PATH" ] || EXE_PATH="src-tauri/target/x86_64-pc-windows-msvc/release/HDRCut.exe"

cp "$EXE_PATH" "$OUT_DIR/HDRCut.exe"
[ -f "dist-windows-deps/libmpv-2.dll" ] && cp "dist-windows-deps/libmpv-2.dll" "$OUT_DIR/"
[ -f "dist-windows-deps/ffmpeg.exe" ] && cp "dist-windows-deps/ffmpeg.exe" "$OUT_DIR/"
[ -f "dist-windows-deps/ffprobe.exe" ] && cp "dist-windows-deps/ffprobe.exe" "$OUT_DIR/"

echo ""
echo "✅ Windows x64 便携版构建完成（直接拷贝整个文件夹到 Windows 双击 HDRCut.exe 即可运行）："
echo "   $(pwd)/$OUT_DIR/"
ls -lh "$OUT_DIR"
