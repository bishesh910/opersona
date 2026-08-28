import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/community';

/** Public surfaces only — the app itself stays out of search engines. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/$', '/p/', '/privacy', '/about'], disallow: ['/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
