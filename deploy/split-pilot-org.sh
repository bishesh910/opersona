#!/usr/bin/env bash
# UPGRADE PATH for self-hosts moving to personal workspaces WITH data intact.
# (opersona.me's own pilot chose the simpler reset: delete the legacy org and
#  let everyone re-register — see deploy/README.md.)
#
# One-time platform-pivot migration (WS7): split a legacy multi-member org into
# one personal workspace per member. Every row follows its persona (clone_id),
# rows tied to a conversation follow that conversation, org-level leftovers
# (org KB documents, avatar cost rows) go to the operator. The legacy org is
# deleted at the end; per-clone data dirs are moved on disk.
#
# Usage:
#   LEGACY_ORG=<org id> OPERATOR_EMAIL=<email> [DRY_RUN=1] bash deploy/split-pilot-org.sh
#
# Safe to re-run: personal org/member ids are deterministic (md5 of user id),
# inserts are ON CONFLICT DO NOTHING, updates are scoped to the legacy org id.
set -euo pipefail
: "${LEGACY_ORG:?set LEGACY_ORG}"
: "${OPERATOR_EMAIL:?set OPERATOR_EMAIL}"
DATA_DIR="${DATA_DIR:-$(cd "$(dirname "$0")/.." && pwd)/data/orgs}"
export PGPASSWORD="$(cat ~/.opersona-backup-pgpass)"
PSQL=(psql -h localhost -U clone -d opersona -v ON_ERROR_STOP=1 -v legacy="$LEGACY_ORG" -v op_email="$OPERATOR_EMAIL")

echo "== backup =="
pg_dump -h localhost -U clone -d opersona -Fc -f "$HOME/opersona-presplit-$(date +%F-%H%M%S).dump"

if [ "${DRY_RUN:-0}" = "1" ]; then
  "${PSQL[@]}" <<< "SELECT u.id, u.email, 'p'||substr(md5('workspace:'||u.id),1,31) AS new_org FROM member m JOIN \"user\" u ON u.id=m.user_id WHERE m.organization_id=:'legacy';"
  echo "(dry run — nothing changed)"; exit 0
fi

"${PSQL[@]}" <<'SQL'
BEGIN;
-- psql var substitution does not reach inside DO $$ blocks — park it in a GUC.
SELECT set_config('opersona.legacy', :'legacy', true);

-- 1) one personal workspace per legacy member (deterministic ids → re-runnable)
CREATE TEMP TABLE m AS
SELECT u.id AS user_id, u.email,
       'p' || substr(md5('workspace:' || u.id), 1, 31) AS new_org,
       coalesce(nullif(split_part(btrim(u.name), ' ', 1), ''), 'My') AS first
FROM member mm JOIN "user" u ON u.id = mm.user_id
WHERE mm.organization_id = :'legacy';

INSERT INTO organization (id, name, slug, metadata, created_at)
SELECT new_org, first || '''s workspace',
       lower(regexp_replace(first, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(new_org), 1, 6),
       '{"personal":true}', now()
FROM m
ON CONFLICT (id) DO NOTHING;

INSERT INTO member (id, organization_id, user_id, role, created_at)
SELECT 'pm' || substr(md5('member:' || user_id), 1, 30), new_org, user_id, 'owner', now()
FROM m
ON CONFLICT (id) DO NOTHING;

-- operator's personal org (org-level leftovers land here)
CREATE TEMP TABLE op AS SELECT new_org FROM m WHERE lower(email) = lower(:'op_email');
DO $$ BEGIN IF (SELECT count(*) FROM op) <> 1 THEN RAISE EXCEPTION 'operator email not found among legacy members'; END IF; END $$;

-- 2) personas anchor everything
CREATE TEMP TABLE cmap AS
SELECT c.id AS clone_id, m.new_org FROM clones c JOIN m ON m.user_id = c.owner_user_id
WHERE c.org_id = :'legacy';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM clones c WHERE c.org_id = current_setting('opersona.legacy') AND c.id NOT IN (SELECT clone_id FROM cmap))
  THEN RAISE EXCEPTION 'clone with owner outside the legacy membership — resolve by hand'; END IF; END $$;

UPDATE clones c SET org_id = k.new_org FROM cmap k WHERE c.id = k.clone_id;

-- 3) conversations follow their persona; conversation-scoped rows follow the conversation
UPDATE conversations x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE turns              x SET org_id = v.org_id FROM conversations v WHERE x.conversation_id = v.id AND x.org_id = :'legacy';
UPDATE approvals          x SET org_id = v.org_id FROM conversations v WHERE x.conversation_id = v.id AND x.org_id = :'legacy';
UPDATE corrections        x SET org_id = v.org_id FROM conversations v WHERE x.conversation_id = v.id AND x.org_id = :'legacy';
UPDATE episodes           x SET org_id = v.org_id FROM conversations v WHERE x.conversation_id = v.id AND x.org_id = :'legacy';
UPDATE reasoning_feedback x SET org_id = v.org_id FROM conversations v WHERE x.conversation_id = v.id AND x.org_id = :'legacy';
UPDATE clone_messages     x SET org_id = v.org_id FROM conversations v WHERE x.conversation = v.id AND x.org_id = :'legacy';
UPDATE session_costs      x SET org_id = v.org_id FROM conversations v WHERE x.conversation_id = v.id AND x.org_id = :'legacy';

-- 4) clone-scoped rows follow their persona
UPDATE autonomy_ledger        x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE claude_code_sessions   x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE condensed_history      x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE facts                  x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE learning_events        x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE persona_briefs         x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE persona_snapshots      x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE personality_tests      x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE playbooks              x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE reasoning_observations x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE reasoning_patterns     x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE reflection_runs        x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE self_tests             x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE style_observations     x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE style_profiles         x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE task_reviews           x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE tasks                  x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE import_jobs            x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE ingest_tokens          x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE documents              x SET org_id = k.new_org FROM cmap k WHERE x.clone_id = k.clone_id AND x.org_id = :'legacy';
UPDATE session_costs          x SET org_id = k.new_org FROM cmap k WHERE x.conversation_id IS NULL AND x.clone_id = k.clone_id AND x.org_id = :'legacy';

-- 5) org-level leftovers → operator (org KB docs, avatar-extraction cost rows)
UPDATE documents      SET org_id = (SELECT new_org FROM op) WHERE org_id = :'legacy';
UPDATE document_chunks x SET org_id = d.org_id FROM documents d WHERE x.document_id = d.id AND x.org_id = :'legacy';
UPDATE document_chunks SET org_id = (SELECT new_org FROM op) WHERE org_id = :'legacy';
UPDATE session_costs   SET org_id = (SELECT new_org FROM op) WHERE org_id = :'legacy';

-- 6) per-workspace settings: copy models, each user brings their own key, boss reset
INSERT INTO org_settings (org_id, chat_model, extract_model, condense_model, chat_effort, timezone, monthly_budget_usd)
SELECT m.new_org, s.chat_model, s.extract_model, s.condense_model, s.chat_effort, s.timezone, s.monthly_budget_usd
FROM m, (SELECT * FROM org_settings WHERE org_id = :'legacy') s
ON CONFLICT (org_id) DO NOTHING;
DELETE FROM org_settings WHERE org_id = :'legacy';

-- 7) auth tidy-up: stale active-org pointers; legacy users predate email verification
UPDATE session SET active_organization_id = NULL WHERE active_organization_id = :'legacy';
UPDATE "user" SET email_verified = true WHERE id IN (SELECT user_id FROM m) AND email_verified = false;

-- 8) nothing may still point at the legacy org
DO $$
DECLARE t text; n bigint;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_id = $1', t) INTO n USING current_setting('opersona.legacy');
    IF n > 0 THEN RAISE EXCEPTION 'table % still has % legacy rows', t, n; END IF;
  END LOOP;
END $$;

-- 9) retire the legacy org (cascades members + invitations)
DELETE FROM organization WHERE id = :'legacy';

SELECT email, new_org FROM m ORDER BY email;
COMMIT;
SQL

echo "== filesystem =="
MAP=$("${PSQL[@]}" -tA -c "SELECT c.id || '|' || c.org_id FROM clones c JOIN member mm ON mm.organization_id = c.org_id WHERE c.org_id LIKE 'p%' GROUP BY c.id, c.org_id;")
for row in $MAP; do
  clone="${row%%|*}"; org="${row##*|}"
  src="$DATA_DIR/$LEGACY_ORG/clones/$clone"
  if [ -d "$src" ]; then mkdir -p "$DATA_DIR/$org/clones"; mv "$src" "$DATA_DIR/$org/clones/$clone"; echo "moved clone dir $clone -> $org"; fi
done
UPMAP=$("${PSQL[@]}" -tA -c "SELECT j.id || '|' || j.org_id FROM import_jobs j WHERE j.org_id LIKE 'p%';")
for row in $UPMAP; do
  job="${row%%|*}"; org="${row##*|}"
  src="$DATA_DIR/$LEGACY_ORG/uploads/import-$job"
  if [ -e "$src" ]; then mkdir -p "$DATA_DIR/$org/uploads"; mv "$src" "$DATA_DIR/$org/uploads/import-$job"; echo "moved upload for job $job -> $org"; fi
done
if [ -d "$DATA_DIR/$LEGACY_ORG" ]; then mv "$DATA_DIR/$LEGACY_ORG" "$DATA_DIR/$LEGACY_ORG.pre-split-archive"; echo "archived legacy org dir"; fi
echo "== done =="
