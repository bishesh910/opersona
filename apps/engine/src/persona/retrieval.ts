/**
 * Keyword retrieval over the persona layers + documents (Postgres FTS).
 * HIVE.md decision #4: markdown/FTS first; add vectors only when recall fails.
 */
import { sql } from 'drizzle-orm';
import { db } from '@opersona/db';

export type Layer = 'facts' | 'playbooks' | 'episodes' | 'corrections' | 'condensed';
export interface Hit { layer: Layer; id: string; text: string; confidence: number | null; status: string | null; source: string | null; rank: number }

const q = (query: string) => sql`websearch_to_tsquery('english', ${query})`;

export async function recallMemory(cloneId: string, query: string, layers: Layer[] = ['facts', 'playbooks', 'episodes', 'corrections', 'condensed'], k = 8, visitor = false): Promise<Hit[]> {
  if (visitor) layers = layers.filter((l) => l === 'facts' || l === 'playbooks');
  const parts: ReturnType<typeof sql>[] = [];
  if (layers.includes('facts')) parts.push(sql`
    select 'facts' as layer, id::text, statement as text, confidence, status, source_kind as source, ts_rank(tsv, ${q(query)}) as rank
    from facts where clone_id = ${cloneId} and status in ('confirmed','candidate') ${visitor ? sql`and shareable = true and status = 'confirmed'` : sql``} and tsv @@ ${q(query)}`);
  if (layers.includes('playbooks')) parts.push(sql`
    select 'playbooks' as layer, id::text, name || ' — trigger: ' || trigger as text, confidence, status, source_kind as source, ts_rank(tsv, ${q(query)}) as rank
    from playbooks where clone_id = ${cloneId} and status in ('confirmed','candidate') ${visitor ? sql`and shareable = true and status = 'confirmed'` : sql``} and tsv @@ ${q(query)}`);
  if (layers.includes('episodes')) parts.push(sql`
    select 'episodes' as layer, id::text, title || ': ' || problem || ' → ' || approach_summary || ' (' || outcome || ')' as text, confidence, status, source_kind as source, ts_rank(tsv, ${q(query)}) as rank
    from episodes where clone_id = ${cloneId} and tsv @@ ${q(query)}`);
  if (layers.includes('corrections')) parts.push(sql`
    select 'corrections' as layer, id::text, lesson as text, confidence, status, source_kind as source,
      ts_rank(to_tsvector('english', lesson), ${q(query)}) as rank
    from corrections where clone_id = ${cloneId} and to_tsvector('english', lesson) @@ ${q(query)}`);
  if (layers.includes('condensed')) parts.push(sql`
    select 'condensed' as layer, id::text, domain || ': ' || left(summary_md, 1200) as text, null::real as confidence, null::text as status, 'reflection' as source,
      ts_rank(to_tsvector('english', summary_md), ${q(query)}) as rank
    from condensed_history where clone_id = ${cloneId} and to_tsvector('english', summary_md) @@ ${q(query)}`);
  if (!parts.length) return [];
  const union = sql.join(parts, sql` union all `);
  const res = await db.execute(sql`select * from (${union}) h order by rank desc limit ${k}`);
  return res.rows as unknown as Hit[];
}

export interface DocHit { documentId: string; filename: string; ord: number; content: string; rank: number }

export async function searchDocuments(orgId: string, cloneId: string, query: string, k = 6, visitor = false): Promise<DocHit[]> {
  const res = await db.execute(sql`
    select c.document_id::text as "documentId", d.filename, c.ord, c.content, ts_rank(c.tsv, ${q(query)}) as rank
    from document_chunks c join documents d on d.id = c.document_id
    where c.org_id = ${orgId} and (${visitor ? sql`c.clone_id is null` : sql`c.clone_id = ${cloneId} or c.clone_id is null`}) and c.tsv @@ ${q(query)}
    order by rank desc limit ${k}`);
  return res.rows as unknown as DocHit[];
}
