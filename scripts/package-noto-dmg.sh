#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DIST_DIR="${DIST_DIR:-$PROJECT_ROOT/dist}"
VERSION="${VERSION:-0.1.0}"
BUNDLE_VERSION="${BUNDLE_VERSION:-1}"
FEED_URL="${FEED_URL:-https://raw.githubusercontent.com/doomwoodzz/Noto/main/appcast.xml}"
PUBLIC_ED_KEY="${SPARKLE_PUBLIC_ED_KEY:-REPLACE_WITH_SPARKLE_PUBLIC_ED_KEY}"
PRODUCT="$PROJECT_ROOT/.build/arm64-apple-macosx/release/Noto"
SPARKLE_FRAMEWORK="$PROJECT_ROOT/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"

if [[ ! -x "$PRODUCT" ]]; then
  PRODUCT="$PROJECT_ROOT/.build/release/Noto"
fi

if [[ ! -x "$PRODUCT" ]]; then
  echo "Missing release executable. Run: swift build -c release --product Noto" >&2
  exit 1
fi

if [[ ! -d "$SPARKLE_FRAMEWORK" ]]; then
  echo "Missing Sparkle framework at $SPARKLE_FRAMEWORK. Run: swift build -c release --product Noto" >&2
  exit 1
fi

STAGE="$(mktemp -d /private/tmp/noto-dmg.XXXXXX)"
APP="$STAGE/Noto.app"
DMG_ROOT="$STAGE/dmgroot"
PLIST="$APP/Contents/Info.plist"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks" "$DMG_ROOT" "$DIST_DIR"
cp "$PRODUCT" "$APP/Contents/MacOS/Noto"
chmod 755 "$APP/Contents/MacOS/Noto"
ditto "$SPARKLE_FRAMEWORK" "$APP/Contents/Frameworks/Sparkle.framework"

plutil -create xml1 "$PLIST"
plutil -insert CFBundleDevelopmentRegion -string en "$PLIST"
plutil -insert CFBundleExecutable -string Noto "$PLIST"
plutil -insert CFBundleIdentifier -string app.noto.prototype "$PLIST"
plutil -insert CFBundleInfoDictionaryVersion -string 6.0 "$PLIST"
plutil -insert CFBundleName -string Noto "$PLIST"
plutil -insert CFBundleDisplayName -string Noto "$PLIST"
plutil -insert CFBundlePackageType -string APPL "$PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -insert CFBundleVersion -string "$BUNDLE_VERSION" "$PLIST"
plutil -insert LSMinimumSystemVersion -string 14.0 "$PLIST"
plutil -insert NSHighResolutionCapable -bool true "$PLIST"
plutil -insert NSSupportsAutomaticGraphicsSwitching -bool true "$PLIST"
plutil -insert SUEnableAutomaticChecks -bool true "$PLIST"
plutil -insert SUFeedURL -string "$FEED_URL" "$PLIST"
plutil -insert SUPublicEDKey -string "$PUBLIC_ED_KEY" "$PLIST"

printf "APPL????" > "$APP/Contents/PkgInfo"

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

ditto "$APP" "$DMG_ROOT/Noto.app"
ln -s /Applications "$DMG_ROOT/Applications"

OUTPUT="$DIST_DIR/Noto-$VERSION.dmg"
if [[ -e "$OUTPUT" ]]; then
  OUTPUT="$DIST_DIR/Noto-$VERSION-$(date +%Y%m%d-%H%M%S).dmg"
fi

hdiutil create -volname "Noto $VERSION" -srcfolder "$DMG_ROOT" -format UDZO "$OUTPUT"
hdiutil verify "$OUTPUT"

echo "$OUTPUT"
