#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FACTORY RESET — wipes EVERY account, persona, conversation, and uploaded
# file from this opersona instance. The schema, code, and config survive;
# nothing else does. Intended for testing the product from a clean slate.
#
#   FORCE=yes bash deploy/reset-all-data.sh
#
# Takes a pg_dump to /var/backups/opersona/ first, truncates every table in
# the public schema (drizzle migration bookkeeping is untouched), clears the
# engine data dir (org uploads/workspaces, probe + e2e debris), restarts both
# services, and prints the post-reset counts.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${FORCE:-}" != "yes" ]]; then
  echo "Refusing to run without FORCE=yes — this deletes every account and all persona data." >&2
  exit 1
fi

set -a; source ./.env; set +a
: "${DATABASE_URL:?DATABASE_URL missing}"
: "${ENGINE_DATA_DIR:?ENGINE_DATA_DIR missing}"

STAMP=$(date +%Y-%m-%d-%H%M%S)
BACKUP="/var/backups/opersona/pre-reset-$STAMP.dump"
echo "→ backup: $BACKUP"
pg_dump -Fc "$DATABASE_URL" > "$BACKUP"
chmod 600 "$BACKUP"

TABLES=$(psql "$DATABASE_URL" -tAc \
  "select string_agg(format('%I', table_name), ', ') from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE'")
echo "→ truncating all public tables"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "TRUNCATE $TABLES RESTART IDENTITY CASCADE"

echo "→ clearing engine data dir ($ENGINE_DATA_DIR)"
rm -rf "$ENGINE_DATA_DIR/orgs" "$ENGINE_DATA_DIR/probe" "$ENGINE_DATA_DIR/e2e-results" \
       "$ENGINE_DATA_DIR/latest" "$ENGINE_DATA_DIR/probe-debug.log"

echo "→ restarting services"
sudo systemctl restart opersona-engine opersona-web

# Warm the auth layer with ONE serial request: better-auth lazily re-creates its
# OAuth resource row on first use, and concurrent first requests race the unique
# constraint (observed: a poisoned instance 500ing until restart). One warm-up
# request creates the row alone; then verify and restart once more if needed.
sleep 4
curl -s -o /dev/null --max-time 15 http://127.0.0.1:3000/ || true
sleep 1
if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3000/)" != "200" ]]; then
  echo "→ web unhealthy after warm-up; one more restart"
  sudo systemctl restart opersona-web
  sleep 4
  curl -s -o /dev/null --max-time 15 http://127.0.0.1:3000/ || true
fi

echo "→ post-reset state:"
psql "$DATABASE_URL" -tAc \
  "select 'users: '||count(*) from \"user\"
   union all select 'orgs: '||count(*) from organization
   union all select 'clones: '||count(*) from clones
   union all select 'conversations: '||count(*) from conversations
   union all select 'sessions: '||count(*) from session
   union all select 'published personas: '||count(*) from published_personas"
systemctl is-active opersona-web opersona-engine
echo "✓ clean slate — sign up fresh at /sign-up (backup kept at $BACKUP)"
