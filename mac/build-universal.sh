#!/usr/bin/env bash
set -euo pipefail
trap 'code=$?; printf "macOS build failed (exit %s), line %s: %s\n" "$code" "$LINENO" "$BASH_COMMAND" >&2; exit "$code"' ERR
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"
APP_NAME="THK-Chat"
VERSION="$(awk -F '"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)"
[[ "$VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] || { echo 'Invalid package version' >&2; exit 1; }
MODE=--universal
if [[ $# -gt 0 ]]; then MODE="$1"; fi
case "$MODE" in
  --universal) TARGETS=(aarch64-apple-darwin x86_64-apple-darwin); LABEL=Universal;;
  --native)
    [[ "$(uname -s)" == Darwin ]] || { echo 'Native macOS builds require a Mac' >&2; exit 1; }
    if [[ "$(uname -m)" == arm64 ]]; then TARGETS=(aarch64-apple-darwin); LABEL=Apple-Silicon; else TARGETS=(x86_64-apple-darwin); LABEL=Intel; fi;;
  *) echo 'Usage: build-mac.sh [--universal|--native]' >&2; exit 1;;
esac
command -v cargo >/dev/null
export LD_LIBRARY_PATH="/osxcross/lib:${LD_LIBRARY_PATH:-}"
rustc --version
cargo --version
for target in "${TARGETS[@]}"; do
  rustup target list --installed | grep -Fxq "$target" || rustup target add "$target"
  if [[ "$target" == aarch64-apple-darwin ]]; then minimum=11.0; else minimum=10.15; fi
  printf 'Building %s for %s (minimum macOS %s)\n' "$APP_NAME" "$target" "$minimum"
  MACOSX_DEPLOYMENT_TARGET="$minimum" cargo build --release --locked --color never --target "$target"
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
  "$LIPO" -create target/aarch64-apple-darwin/release/chatwork target/x86_64-apple-darwin/release/chatwork -output "$APP_BUNDLE/Contents/MacOS/chatwork"
  archs="$("$LIPO" -archs "$APP_BUNDLE/Contents/MacOS/chatwork")"
  [[ "$archs" == *arm64* && "$archs" == *x86_64* ]] || { echo "Unexpected architectures: $archs" >&2; exit 1; }
else
  cp "target/$target/release/chatwork" "$APP_BUNDLE/Contents/MacOS/chatwork"
fi
chmod 755 "$APP_BUNDLE/Contents/MacOS/chatwork"
cp assets/AppIcon.icns "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
sed -E '/<key>CFBundle(ShortVersionString|Version)<\/key>/{n;s#<string>[^<]*</string>#<string>'"$VERSION"'</string>#;}' mac/Info.plist > "$APP_BUNDLE/Contents/Info.plist"
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

printf 'Built THK-Chat %s (%s)\nApp: %s\nArchive: %s\n' "$VERSION" "$LABEL" "$APP_BUNDLE" "$ARCHIVE"
(
  cd "$DIST_DIR"
  for artifact in "$APP_NAME-v$VERSION-macOS-$LABEL.tar.gz" "$APP_NAME-v$VERSION-macOS-$LABEL.zip" "$APP_NAME-v$VERSION-macOS-$LABEL.dmg"; do
    if [[ -f "$artifact" ]]; then
      if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$artifact"; else sha256sum "$artifact"; fi
    fi
  done
) > "$DIST_DIR/$APP_NAME-v$VERSION-macOS-SHA256.txt"
