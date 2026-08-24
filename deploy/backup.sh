#!/bin/bash
# Nightly Postgres dump; keeps 14 days. The persona data lives entirely in this DB.
set -e
export PGPASSWORD='251d8fde74832764a6c4a20d34a6ea41646dee4fcc1ace03'
pg_dump -h localhost -U clone -d opersona -Fc -f /var/backups/opersona/opersona-$(date +%F).dump
find /var/backups/opersona -name '*.dump' -mtime +14 -delete
psql -h localhost -U clone -d opersona -c "delete from auth_failures where created_at < now() - interval '1 day'; delete from rate_limit where last_request < (extract(epoch from now())*1000 - 86400000);" >/dev/null 2>&1 || true
