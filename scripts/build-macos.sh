#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [1/3] Building React + TypeScript frontend..."
pnpm build

echo "==> [2/3] Building Tauri v2 macOS Apple Silicon (arm64) .app..."
cargo-tauri build --target aarch64-apple-darwin --bundles app

APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/HDRCut.app"

echo "==> [3/3] Bundling self-contained libmpv (HDR/MoltenVK) + ffmpeg + ffprobe..."
bash scripts/bundle-macos-libs.sh "$APP_PATH"

echo ""
echo "✅ macOS arm64 应用已构建完成："
echo "   $(pwd)/$APP_PATH"
