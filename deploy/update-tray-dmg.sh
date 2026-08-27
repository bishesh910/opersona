#!/usr/bin/env bash
# Pull the newest successful tray build from CI and serve it at
# https://opersona.me/download/opersona.dmg  (run after a tray release).
set -euo pipefail
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH"
cd /home/bee/opersona
RUN=$(gh run list --workflow=tray.yml --status=success --limit 1 --json databaseId --jq '.[0].databaseId')
[ -n "$RUN" ] || { echo "no successful tray run"; exit 1; }
TMP=$(mktemp -d)
gh run download "$RUN" -n opersona-tray-macos -D "$TMP"
DMG=$(find "$TMP" -name '*.dmg' | head -1)
[ -n "$DMG" ] || { echo "no dmg in artifact"; exit 1; }
mkdir -p apps/web/public/download
cp "$DMG" apps/web/public/download/opersona.dmg
rm -rf "$TMP"
echo "serving $(du -h apps/web/public/download/opersona.dmg | cut -f1) from run $RUN — live immediately (public/ is read at runtime)"
