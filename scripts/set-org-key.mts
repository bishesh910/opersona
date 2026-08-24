/** Admin helper: store an org's BYO Anthropic API key (encrypted) from the CLI.
 *  Usage: pnpm set-org-key --org <organizationId> --key sk-ant-...  [--model claude-opus-5] [--effort high] */
import 'dotenv/config';
import { db, pool, orgSettings } from '@opersona/db';
import { encryptSecret } from '@opersona/shared';
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const orgId = arg('org'), key = arg('key');
if (!orgId || !key) { console.error('usage: --org <id> --key <sk-ant-...> [--model m] [--effort e]'); process.exit(1); }
const set: Record<string, unknown> = { anthropicKeyEnc: encryptSecret(key), updatedAt: new Date() };
if (arg('model')) set.chatModel = arg('model'); if (arg('effort')) set.chatEffort = arg('effort');
await db.insert(orgSettings).values({ orgId, ...set }).onConflictDoUpdate({ target: orgSettings.orgId, set });
console.log(`stored encrypted key for org ${orgId}`); await pool.end();
