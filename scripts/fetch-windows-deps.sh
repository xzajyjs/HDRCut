#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

WIN_DEPS_DIR="dist-windows-deps"
mkdir -p "$WIN_DEPS_DIR"

echo "==> Preparing Windows x64 runtime dependencies in $WIN_DEPS_DIR/"
echo "    Required runtime files alongside HDRCut.exe:"
echo "      1. libmpv-2.dll  (from shinchiro/mpv-winbuild-cmake: mpv-dev-x86_64-*.7z)"
echo "      2. ffmpeg.exe    (from BtbN/FFmpeg-Builds or gyan.dev)"
echo "      3. ffprobe.exe   (from BtbN/FFmpeg-Builds or gyan.dev)"
echo ""

if ! command -v 7z >/dev/null 2>&1 && ! command -v bsdtar >/dev/null 2>&1; then
  echo "Tip: install p7zip (brew install p7zip) to auto-extract .7z archives."
fi

# Download official Windows x64 FFmpeg essentials zip if missing
if [ ! -f "$WIN_DEPS_DIR/ffmpeg.exe" ] || [ ! -f "$WIN_DEPS_DIR/ffprobe.exe" ]; then
  echo "==> Downloading Windows x64 ffmpeg.exe & ffprobe.exe..."
  FFMPEG_ZIP="$WIN_DEPS_DIR/ffmpeg-win64.zip"
  curl -fL "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -o "$FFMPEG_ZIP"
  TMP_FF="$WIN_DEPS_DIR/_fftmp"
  rm -rf "$TMP_FF" && mkdir -p "$TMP_FF"
  unzip -q "$FFMPEG_ZIP" -d "$TMP_FF"
  find "$TMP_FF" -name "ffmpeg.exe" -exec cp {} "$WIN_DEPS_DIR/ffmpeg.exe" \;
  find "$TMP_FF" -name "ffprobe.exe" -exec cp {} "$WIN_DEPS_DIR/ffprobe.exe" \;
  rm -rf "$TMP_FF" "$FFMPEG_ZIP"
  echo "    ✔ ffmpeg.exe & ffprobe.exe ready"
fi

# Download latest Windows x64 libmpv-2.dll if missing
if [ ! -f "$WIN_DEPS_DIR/libmpv-2.dll" ]; then
  echo "==> Fetching latest shinchiro/mpv-winbuild-cmake release URL for libmpv-2.dll..."
  MPV_URL="$(curl -fsSL https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest \
    | python3 -c "import sys, json; assets = json.load(sys.stdin).get('assets', []); print(next((a['browser_download_url'] for a in assets if 'mpv-dev-x86_64-' in a['name'] and 'v3' not in a['name'] and a['name'].endswith('.7z')), ''))")"

  if [ -n "$MPV_URL" ]; then
    MPV_7Z="$WIN_DEPS_DIR/mpv-dev-win64.7z"
    curl -fL "$MPV_URL" -o "$MPV_7Z"
    TMP_MPV="$WIN_DEPS_DIR/_mpvtmp"
    rm -rf "$TMP_MPV" && mkdir -p "$TMP_MPV"
    if command -v 7z >/dev/null 2>&1; then
      7z x -y "$MPV_7Z" -o"$TMP_MPV" >/dev/null
    else
      bsdtar -xf "$MPV_7Z" -C "$TMP_MPV"
    fi
    find "$TMP_MPV" -name "libmpv-2.dll" -exec cp {} "$WIN_DEPS_DIR/libmpv-2.dll" \;
    rm -rf "$TMP_MPV" "$MPV_7Z"
    echo "    ✔ libmpv-2.dll ready"
  else
    echo "⚠️  Could not auto-resolve libmpv-2.dll URL. Download manually from:"
    echo "    https://github.com/shinchiro/mpv-winbuild-cmake/releases"
    echo "    and place libmpv-2.dll into $(pwd)/$WIN_DEPS_DIR/"
  fi
fi

ls -lh "$WIN_DEPS_DIR"
