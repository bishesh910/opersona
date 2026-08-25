#!/bin/bash
# Nightly Postgres dump; keeps 14 days. The persona data lives entirely in this DB.
# The password is NEVER stored in this script: put it (single line) in a 600-perms
# file and point BACKUP_PGPASS_FILE at it, or rely on ~/.pgpass.
set -e
PGPASS_FILE="${BACKUP_PGPASS_FILE:-$HOME/.opersona-backup-pgpass}"
[ -r "$PGPASS_FILE" ] && export PGPASSWORD="$(cat "$PGPASS_FILE")"
pg_dump -h localhost -U clone -d opersona -Fc -f /var/backups/opersona/opersona-$(date +%F).dump
find /var/backups/opersona -name '*.dump' -mtime +14 -delete
psql -h localhost -U clone -d opersona -c "delete from auth_failures where created_at < now() - interval '1 day'; delete from rate_limit where last_request < (extract(epoch from now())*1000 - 86400000);" >/dev/null 2>&1 || true
