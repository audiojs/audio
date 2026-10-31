#!/bin/sh
# Audio.app, linked to this repo: it runs desktop/server.js and serves the editor from here, so a change in the repo is in
# the app at its next reload (⌥⌘R; the server's own code at the app's next start).
#   desktop/build.sh            → desktop/build/Audio.app
#   desktop/build.sh install    → and into /Applications
# Only what changed is made again: the same sources sign the same, so the microphone permission, given to that
# signature, holds from one build to the next (the app is signed ad hoc: no developer identity here).
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
app="$here/build/Audio.app"
version=$(node -p "require('$root/package.json').version")
newer() { [ ! -e "$1" ] || [ -n "$(find "$2" -newer "$1")" ]; }

mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
if newer "$app/Contents/MacOS/Audio" "$here/shell/main.swift"; then
  swiftc -O -swift-version 5 -target arm64-apple-macos13.3 -o "$app/Contents/MacOS/Audio" "$here/shell/main.swift" \
    -framework Cocoa -framework WebKit
fi
sed -e "s#{{ROOT}}#$root#" -e "s#{{VERSION}}#$version#" "$here/shell/Info.plist" > "$app/Contents/Info.plist.new"
cmp -s "$app/Contents/Info.plist.new" "$app/Contents/Info.plist" && rm "$app/Contents/Info.plist.new" || mv "$app/Contents/Info.plist.new" "$app/Contents/Info.plist"

# the icon: the audiojs logo drawn (shell/icon.js) into an Icon Composer icon (shell/Audio.icon: black, no glass), compiled
# as the system takes it: Assets.car for macOS 26, Audio.icns for the ones before
if newer "$app/Contents/Resources/Assets.car" "$here/shell/icon.js" || newer "$app/Contents/Resources/Assets.car" "$here/shell/Audio.icon"; then
  icon="$here/build/Audio.icon"
  rm -rf "$icon" && mkdir -p "$icon/Assets"
  cp "$here/shell/Audio.icon/icon.json" "$icon/"
  node "$here/shell/icon.js" "$icon/Assets/logo.png" 1024 none
  xcrun actool "$icon" --compile "$app/Contents/Resources" --platform macosx --minimum-deployment-target 13.3 \
    --app-icon Audio --output-partial-info-plist "$here/build/icon.plist" >/dev/null
  rm -rf "$icon" "$here/build/icon.plist"
fi

codesign --force --sign - "$app"
echo "$app"

if [ "$1" = install ]; then
  osascript -e 'tell application id "dev.audiojs.audio" to quit' 2>/dev/null || true
  rm -rf /Applications/Audio.app
  cp -R "$app" /Applications/
  # Launch Services told of its document types: Finder › Open With lists it
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Audio.app
  echo /Applications/Audio.app
fi
