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

# auto-update feed: signed .app.tar.gz + manifest (tray >= 0.3.0 polls this)
TAR=$(find "$TMP" -name '*.app.tar.gz' | head -1)
SIG=$(find "$TMP" -name '*.app.tar.gz.sig' | head -1)
VER=$(cat "$(find "$TMP" -name VERSION | head -1)" 2>/dev/null | tr -d '[:space:]')
if [ -n "$TAR" ] && [ -n "$SIG" ] && [ -n "$VER" ]; then
  cp "$TAR" apps/web/public/download/opersona-tray-aarch64.app.tar.gz
  python3 - "$VER" "$SIG" <<'PY'
import json, sys
ver, sigfile = sys.argv[1], sys.argv[2]
from datetime import datetime, timezone
manifest = {
  "version": ver,
  "pub_date": datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
  "platforms": {
    "darwin-aarch64": {
      "signature": open(sigfile).read().strip(),
      "url": "https://opersona.me/download/opersona-tray-aarch64.app.tar.gz",
    }
  },
}
json.dump(manifest, open('apps/web/public/download/tray-latest.json', 'w'), indent=2)
PY
  echo "auto-update feed: v$VER at /download/tray-latest.json"
else
  echo "note: no updater artifacts in this run (pre-0.3.0 build) — dmg only"
fi
rm -rf "$TMP"
echo "serving $(du -h apps/web/public/download/opersona.dmg | cut -f1) from run $RUN — live immediately (public/ is read at runtime)"
