import type { MetadataRoute } from 'next';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { SITE_URL } from '@/lib/community';

export const dynamic = 'force-dynamic';

/** Landing, privacy + every PUBLIC active persona (restricted ones never appear;
 *  /explore is members-only and stays out of search). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pubs = await db.select({ slug: schema.publishedPersonas.slug, updatedAt: schema.publishedPersonas.updatedAt })
    .from(schema.publishedPersonas)
    .where(and(eq(schema.publishedPersonas.visibility, 'public'), eq(schema.publishedPersonas.status, 'active')))
    .limit(5000)
    .catch(() => [] as { slug: string; updatedAt: Date }[]); // fresh self-host: tables may not exist yet
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly' },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'monthly' },
    ...pubs.map((p) => ({ url: `${SITE_URL}/p/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
