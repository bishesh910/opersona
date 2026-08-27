#!/usr/bin/env bash
# Pull the newest successful desktop-app build from CI and serve it at
# https://opersona.me/download/opersona-app.dmg  (run after a desktop release).
set -euo pipefail
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH"
cd /home/bee/opersona
RUN=$(gh run list --workflow=desktop.yml --status=success --limit 1 --json databaseId --jq '.[0].databaseId')
[ -n "$RUN" ] || { echo "no successful desktop run"; exit 1; }
TMP=$(mktemp -d)
gh run download "$RUN" -n opersona-desktop-macos -D "$TMP"
DMG=$(find "$TMP" -name '*.dmg' | head -1)
[ -n "$DMG" ] || { echo "no dmg in artifact"; exit 1; }
mkdir -p apps/web/public/download
cp "$DMG" apps/web/public/download/opersona-app.dmg
VER=$(cat "$(find "$TMP" -name VERSION | head -1)" 2>/dev/null | tr -d '[:space:]')
# version feed the app polls (notify-updater)
printf '{"version":"%s"}\n' "${VER:-0.0.0}" > apps/web/public/download/desktop-latest.json
rm -rf "$TMP"
echo "serving $(du -h apps/web/public/download/opersona-app.dmg | cut -f1) (v${VER:-?}) from run $RUN"
echo "update feed: /download/desktop-latest.json -> v${VER:-?}"
echo "NOTE: a NEW filename in public/download needs one web restart (Next snapshots public/ at boot)."
