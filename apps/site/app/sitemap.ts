import type { MetadataRoute } from 'next';

import { NAV_LINKS, SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, priority: 1 }, ...NAV_LINKS.map((link) => ({ url: `${SITE_URL}${link.href}`, priority: 0.7 }))];
}
