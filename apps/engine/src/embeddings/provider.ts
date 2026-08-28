/**
 * Embedding provider abstraction — deliberately vendor-free. Retrieval is
 * Postgres FTS first ("add vectors only when recall fails"); this seam exists
 * so a provider can be plugged in later without schema or caller changes.
 *
 * Wire a provider by setting EMBEDDINGS_PROVIDER (and its key) and adding a
 * case below; until then getEmbedder() returns null and callers skip embedding
 * writes entirely. Vectors land in knowledge_embeddings (jsonb float arrays —
 * a later pgvector swap is a column change, not a redesign).
 */
export interface Embedder {
  id: string;
  model: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function getEmbedder(): Embedder | null {
  const provider = process.env.EMBEDDINGS_PROVIDER;
  if (!provider) return null;
  // No vendor shipped yet — an unknown provider is a loud config error, not a silent no-op.
  throw new Error(`EMBEDDINGS_PROVIDER="${provider}" is set but no such provider is implemented`);
}
