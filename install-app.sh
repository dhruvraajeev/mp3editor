#!/bin/bash
# Build the UI and install mp3editor.app into /Applications. Rerun after pulling changes.
# The app carries its own copy of the UI and runs from ~/.mp3editor/venv, never from this checkout: macOS guards
# ~/Downloads, and a Python living there would hang at launch waiting on a permission prompt it can't show yet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/mp3editor.app"
VENV="$HOME/.mp3editor/venv"

(cd "$ROOT/frontend" && npm install --no-audit --no-fund && npm run build)
uv venv --allow-existing --python 3.12 "$VENV"
uv pip install --python "$VENV/bin/python" --reinstall-package mp3editor "$ROOT/backend"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/assets/mp3editor.icns" "$APP/Contents/Resources/"
cp -R "$ROOT/frontend/dist" "$APP/Contents/Resources/ui"
cat > "$APP/Contents/MacOS/mp3editor" <<SH
#!/bin/bash
export MP3EDITOR_UI="\$(dirname "\$0")/../Resources/ui"
exec "$VENV/bin/python" -m mp3editor app
SH
chmod +x "$APP/Contents/MacOS/mp3editor"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>mp3editor</string>
  <key>CFBundleDisplayName</key><string>mp3editor</string>
  <key>CFBundleIdentifier</key><string>com.dhruvraajeev.mp3editor</string>
  <key>CFBundleExecutable</key><string>mp3editor</string>
  <key>CFBundleIconFile</key><string>mp3editor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
touch "$APP" # nudge Finder to pick up the icon
echo "Installed $APP"
