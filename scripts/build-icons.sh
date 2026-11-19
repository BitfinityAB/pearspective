#!/bin/sh
# Renders the favicon set from the SVG sources with headless Chrome and macOS sips.
# Usage: scripts/build-icons.sh  (run from the repo root, macOS only)
set -eu
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=web/public
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

render() { # svg, png, background (RRGGBBAA)
  sed 's/width="512" height="512"/width="1024" height="1024"/' "$1" > "$WORK/src.svg"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color="$3" \
    --window-size=1024,1024 --screenshot="$2" "file://$WORK/src.svg" >/dev/null 2>&1
}

render docs/assets/logo.svg "$WORK/full.png" 00000000
render web/public/favicon.svg "$WORK/small.png" 00000000
render docs/assets/favicon-16.svg "$WORK/tiny.png" 00000000
# iOS fills transparency with black, so the touch icon gets a white background.
render docs/assets/logo.svg "$WORK/opaque.png" ffffffff

sips -z 16 16 "$WORK/tiny.png" --out "$OUT/favicon-16x16.png" >/dev/null
sips -z 32 32 "$WORK/small.png" --out "$OUT/favicon-32x32.png" >/dev/null
sips -z 48 48 "$WORK/small.png" --out "$WORK/favicon-48.png" >/dev/null
sips -z 180 180 "$WORK/opaque.png" --out "$OUT/apple-touch-icon.png" >/dev/null
sips -z 192 192 "$WORK/full.png" --out "$OUT/icon-192.png" >/dev/null
sips -z 512 512 "$WORK/full.png" --out "$OUT/icon-512.png" >/dev/null
node scripts/png-to-ico.mjs "$OUT/favicon.ico" "$OUT/favicon-16x16.png" "$OUT/favicon-32x32.png" "$WORK/favicon-48.png"
echo "Icons written to $OUT"
