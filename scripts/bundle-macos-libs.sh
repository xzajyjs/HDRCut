#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-src-tauri/target/aarch64-apple-darwin/release/bundle/macos/HDRCut.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: App bundle not found at $APP_PATH"
  exit 1
fi

FRAMEWORKS_DIR="$APP_PATH/Contents/Frameworks"
BIN_DIR="$APP_PATH/Contents/Resources/bin"
VULKAN_ICD_DIR="$APP_PATH/Contents/Resources/vulkan/icd.d"

mkdir -p "$FRAMEWORKS_DIR" "$BIN_DIR" "$VULKAN_ICD_DIR"

echo "==> Bundling arm64 ffmpeg, ffprobe, libmpv & MoltenVK into $APP_PATH ..."

# Resolve source binaries (prefer native arm64 Homebrew)
FFMPEG_SRC="/opt/homebrew/bin/ffmpeg"
FFPROBE_SRC="/opt/homebrew/bin/ffprobe"
LIBMPV_SRC="/opt/homebrew/lib/libmpv.2.dylib"
MOLTENVK_SRC="/opt/homebrew/opt/molten-vk/lib/libMoltenVK.dylib"

[ -f "$FFMPEG_SRC" ] || FFMPEG_SRC="$(which ffmpeg)"
[ -f "$FFPROBE_SRC" ] || FFPROBE_SRC="$(which ffprobe)"

cp -L "$FFMPEG_SRC" "$BIN_DIR/ffmpeg"
cp -L "$FFPROBE_SRC" "$BIN_DIR/ffprobe"
chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"

if [ -f "$LIBMPV_SRC" ]; then
  cp -L "$LIBMPV_SRC" "$FRAMEWORKS_DIR/libmpv.2.dylib"
  chmod 755 "$FRAMEWORKS_DIR/libmpv.2.dylib"
fi

if [ -f "$MOLTENVK_SRC" ]; then
  cp -L "$MOLTENVK_SRC" "$FRAMEWORKS_DIR/libMoltenVK.dylib"
  chmod 755 "$FRAMEWORKS_DIR/libMoltenVK.dylib"
  cat <<'EOF' > "$VULKAN_ICD_DIR/MoltenVK_icd.json"
{
    "file_format_version" : "1.0.0",
    "ICD": {
        "library_path": "../../../Frameworks/libMoltenVK.dylib",
        "api_version" : "1.2.0",
        "is_portability_driver" : true
    }
}
EOF
fi

# Recursively collect & rewrite all non-system dylib dependencies into Contents/Frameworks
python3 - "$APP_PATH" "$FRAMEWORKS_DIR" "$BIN_DIR" <<'PY'
import os, shutil, subprocess, sys

app_path, fw_dir, bin_dir = sys.argv[1], sys.argv[2], sys.argv[3]

def otool_deps(path):
    out = subprocess.check_output(["otool", "-L", path], text=True)
    deps = []
    for line in out.splitlines()[1:]:
        dep = line.strip().split(" (", 1)[0]
        if not dep:
            continue
        if dep.startswith("/System/") or dep.startswith("/usr/lib/"):
            continue
        deps.append(dep)
    return deps

def resolve_dep(dep, current_file):
    if dep.startswith("@"):
        name = os.path.basename(dep)
        for root in [fw_dir, "/opt/homebrew/lib", "/opt/homebrew/opt/ffmpeg/lib", "/opt/homebrew/opt/mpv/lib"]:
            cand = os.path.join(root, name)
            if os.path.exists(cand):
                return os.path.realpath(cand)
        return None
    if os.path.exists(dep):
        return os.path.realpath(dep)
    return None

queue = [
    os.path.join(bin_dir, "ffmpeg"),
    os.path.join(bin_dir, "ffprobe"),
    os.path.join(fw_dir, "libmpv.2.dylib"),
]
if os.path.exists(os.path.join(fw_dir, "libMoltenVK.dylib")):
    queue.append(os.path.join(fw_dir, "libMoltenVK.dylib"))

processed = set()
copied_count = 0

while queue:
    target = queue.pop(0)
    if not os.path.exists(target) or target in processed:
        continue
    processed.add(target)

    is_in_bin = os.path.dirname(target) == bin_dir
    rel_prefix = "@executable_path/../../Frameworks" if is_in_bin else "@loader_path"

    # Set dylib install ID if inside Frameworks
    if not is_in_bin:
        subprocess.run(
            ["install_name_tool", "-id", f"@loader_path/{os.path.basename(target)}", target],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

    for dep in otool_deps(target):
        if dep.startswith("@loader_path/") or dep.startswith("@executable_path/"):
            continue
        dep_name = os.path.basename(dep)
        if dep_name == os.path.basename(target):
            continue
        dest = os.path.join(fw_dir, dep_name)
        if not os.path.exists(dest):
            resolved = resolve_dep(dep, target)
            if resolved and os.path.exists(resolved):
                shutil.copy2(resolved, dest)
                os.chmod(dest, 0o755)
                copied_count += 1
                queue.append(dest)
            else:
                continue
        subprocess.run(
            ["install_name_tool", "-change", dep, f"{rel_prefix}/{dep_name}", target],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

print(f"==> Relocated {copied_count} transitive dylibs into Frameworks/ (total processed: {len(processed)})")
PY

echo "==> Ad-hoc code-signing all bundled frameworks, binaries & .app for Apple Silicon..."
find "$FRAMEWORKS_DIR" -name "*.dylib" -exec codesign --force --sign - {} \;
codesign --force --sign - "$BIN_DIR/ffmpeg"
codesign --force --sign - "$BIN_DIR/ffprobe"
codesign --force --deep --sign - "$APP_PATH"

echo "==> Done! Self-contained macOS app ready at:"
echo "    $APP_PATH"
du -sh "$APP_PATH"
