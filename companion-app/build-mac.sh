#!/bin/bash
# =====================================================================
# build-mac.sh — one-command build of MZ Admin on a Mac.
#
#   ./build-mac.sh            # build for iOS Simulator (no signing needed)
#   ./build-mac.sh mac        # build the native macOS app
#   ./build-mac.sh device     # build for a real iPhone (needs a Team ID)
#
# The .xcodeproj is committed (no XcodeGen needed). Building for the
# Simulator or macOS requires no Apple Developer account. To run on a
# physical iPhone, open MZAdmin.xcodeproj in Xcode once and pick your
# Team under Signing & Capabilities, then re-run "./build-mac.sh device".
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodebuild >/dev/null; then
    echo "xcodebuild not found — install Xcode from the App Store, then:"
    echo "  sudo xcode-select -s /Applications/Xcode.app"
    exit 1
fi

MODE="${1:-sim}"
case "$MODE" in
    mac)
        echo "▶ Building MZ Admin for macOS…"
        xcodebuild -project MZAdmin.xcodeproj -scheme MZAdmin \
            -destination 'platform=macOS' \
            CODE_SIGN_IDENTITY=- build
        ;;
    device)
        echo "▶ Building MZ Admin for iOS device…"
        xcodebuild -project MZAdmin.xcodeproj -scheme MZAdmin \
            -destination 'generic/platform=iOS' \
            -allowProvisioningUpdates build
        ;;
    sim|*)
        echo "▶ Building MZ Admin for iOS Simulator…"
        xcodebuild -project MZAdmin.xcodeproj -scheme MZAdmin \
            -destination 'generic/platform=iOS Simulator' \
            CODE_SIGNING_ALLOWED=NO build
        ;;
esac
echo "✅ Build succeeded."
