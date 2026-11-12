#!/usr/bin/env bash
set -euo pipefail
trap 'code=$?; printf "macOS build failed (exit %s), line %s: %s\n" "$code" "$LINENO" "$BASH_COMMAND" >&2; exit "$code"' ERR
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"
APP_NAME="THK-Chat"
VERSION="$(awk -F '"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)"
[[ "$VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] || { echo 'Invalid package version' >&2; exit 1; }
MODE=--universal
BACKEND="${THK_MAC_BACKEND:-swift}"
case "$BACKEND" in
  swift)
    [[ "$(uname -s)" == Darwin ]] || { echo 'Swift/AppKit builds require macOS and Xcode Command Line Tools. For the legacy Rust cross-build set THK_MAC_BACKEND=rust.' >&2; exit 1; }
    command -v xcrun >/dev/null
    SDK="$(xcrun --sdk macosx --show-sdk-path)";;
  rust) command -v cargo >/dev/null;;
  *) echo 'THK_MAC_BACKEND must be swift or rust' >&2; exit 1;;
esac
if [[ $# -gt 0 ]]; then MODE="$1"; fi
case "$MODE" in
  --universal) TARGETS=(aarch64-apple-darwin x86_64-apple-darwin); LABEL=Universal;;
  --native)
    [[ "$(uname -s)" == Darwin ]] || { echo 'Native macOS builds require a Mac' >&2; exit 1; }
    if [[ "$(uname -m)" == arm64 ]]; then TARGETS=(aarch64-apple-darwin); LABEL=Apple-Silicon; else TARGETS=(x86_64-apple-darwin); LABEL=Intel; fi;;
  *) echo 'Usage: build-mac.sh [--universal|--native]' >&2; exit 1;;
esac
BINARY_PATHS=()
if [[ "$BACKEND" == rust ]]; then
  export LD_LIBRARY_PATH="/osxcross/lib:${LD_LIBRARY_PATH:-}"
  rustc --version
  cargo --version
else
  xcrun swiftc --version
  bash mac/test-native.sh
fi
for target in "${TARGETS[@]}"; do
  if [[ "$BACKEND" == swift ]]; then
    if [[ "$target" == aarch64-apple-darwin ]]; then arch=arm64; else arch=x86_64; fi
    binary="target/swift/$target/chatwork"
    mkdir -p "$(dirname "$binary")"
    printf 'Building %s in Swift for %s (minimum macOS 12.0)\n' "$APP_NAME" "$arch"
    xcrun swiftc -swift-version 5 -O -whole-module-optimization -sdk "$SDK" \
      -target "$arch-apple-macosx12.0" -framework AppKit -framework WebKit -framework UserNotifications \
      -Xlinker -rpath -Xlinker '@executable_path/../Frameworks' \
      mac/Native/Policy.swift mac/Native/Updater.swift mac/Native/main.swift -o "$binary"
  else
    rustup target list --installed | grep -Fxq "$target" || rustup target add "$target"
    if [[ "$target" == aarch64-apple-darwin ]]; then minimum=11.0; else minimum=10.15; fi
    printf 'Building %s for %s (minimum macOS %s)\n' "$APP_NAME" "$target" "$minimum"
    MACOSX_DEPLOYMENT_TARGET="$minimum" cargo build --release --locked --color never --target "$target"
    binary="target/$target/release/chatwork"
  fi
  BINARY_PATHS+=("$binary")
done
DIST_DIR="$SCRIPT_DIR/dist"
OUTPUT_DIR="$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL"
APP_BUNDLE="$OUTPUT_DIR/$APP_NAME.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
if [[ "$MODE" == --universal ]]; then
  LIPO=""
  for candidate in lipo aarch64-apple-darwin25.1-lipo x86_64-apple-darwin25.1-lipo llvm-lipo; do
    if command -v "$candidate" >/dev/null 2>&1; then LIPO="$candidate"; break; fi
  done
  [[ -n "$LIPO" ]] || { echo 'Universal macOS builds require lipo' >&2; exit 1; }
  "$LIPO" -create "${BINARY_PATHS[@]}" -output "$APP_BUNDLE/Contents/MacOS/chatwork"
  archs="$("$LIPO" -archs "$APP_BUNDLE/Contents/MacOS/chatwork")"
  [[ "$archs" == *arm64* && "$archs" == *x86_64* ]] || { echo "Unexpected architectures: $archs" >&2; exit 1; }
else
  cp "${BINARY_PATHS[0]}" "$APP_BUNDLE/Contents/MacOS/chatwork"
fi
chmod 755 "$APP_BUNDLE/Contents/MacOS/chatwork"
cp assets/AppIcon.icns "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
sed -E '/<key>CFBundle(ShortVersionString|Version)<\/key>/{n;s#<string>[^<]*</string>#<string>'"$VERSION"'</string>#;}' mac/Info.plist > "$APP_BUNDLE/Contents/Info.plist"
if [[ "$BACKEND" == swift ]]; then
  /usr/libexec/PlistBuddy -c 'Set :LSMinimumSystemVersion 12.0' "$APP_BUNDLE/Contents/Info.plist"
  cp src/ui.css src/injected.js src/toolkit.js src/downloads.js src/files.js src/file-preview.js src/update-ui.js \
    assets/branding/icon.svg ota/macos-update.sh "$APP_BUNDLE/Contents/Resources/"
  # Embed Swift compatibility libraries when the selected toolchain needs them.
  mkdir -p "$APP_BUNDLE/Contents/Frameworks"
  xcrun swift-stdlib-tool --copy --scan-executable "$APP_BUNDLE/Contents/MacOS/chatwork" \
    --destination "$APP_BUNDLE/Contents/Frameworks" --platform macosx
fi
if command -v rcodesign >/dev/null 2>&1; then
  printf 'Signing %s with rcodesign (ad-hoc)...\n' "$APP_NAME.app"
  rcodesign sign "$APP_BUNDLE"
elif [[ "$(uname -s)" == Darwin ]]; then
  plutil -lint "$APP_BUNDLE/Contents/Info.plist"
  codesign --force --deep --sign - "$APP_BUNDLE"
  codesign --verify --deep --strict "$APP_BUNDLE"
fi
ARCHIVE="$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL.tar.gz"
tar -czf "$ARCHIVE" -C "$OUTPUT_DIR" "$APP_NAME.app"
tar -tf "$ARCHIVE" "$APP_NAME.app/Contents/MacOS/chatwork" >/dev/null 2>&1
if command -v zip >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && zip -r -y -q "$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL.zip" "$APP_NAME.app")
elif command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL.zip"
fi
if command -v hdiutil >/dev/null 2>&1; then
  STAGE="$(mktemp -d "$DIST_DIR/.dmg-stage.XXXXXX")"
  cp -R "$APP_BUNDLE" "$STAGE/$APP_NAME.app"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL.dmg"
fi

# Ensure standard aliases for convenience
rm -rf "$DIST_DIR/THK.app"
cp -R "$APP_BUNDLE" "$DIST_DIR/THK.app"
cp -f "$ARCHIVE" "$DIST_DIR/THK-macOS.tar.gz"
if [[ -f "$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL.zip" ]]; then
  cp -f "$DIST_DIR/$APP_NAME-v$VERSION-macOS-$LABEL.zip" "$DIST_DIR/THK-macOS-Universal.zip"
fi

printf 'Built THK-Chat %s (%s, %s)\nApp: %s\nArchive: %s\n' "$VERSION" "$LABEL" "$BACKEND" "$APP_BUNDLE" "$ARCHIVE"
(
  cd "$DIST_DIR"
  for artifact in "$APP_NAME-v$VERSION-macOS-$LABEL.tar.gz" "$APP_NAME-v$VERSION-macOS-$LABEL.zip" "$APP_NAME-v$VERSION-macOS-$LABEL.dmg"; do
    if [[ -f "$artifact" ]]; then
      if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$artifact"; else sha256sum "$artifact"; fi
    fi
  done
) > "$DIST_DIR/$APP_NAME-v$VERSION-macOS-SHA256.txt"
