import type { MetadataRoute } from 'next';

import { NAV_LINKS, SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [...NAV_LINKS.map((link) => link.href), '/integrations/slack', '/integrations/teams', '/integrations/discord', '/support'];
  return [{ url: SITE_URL, priority: 1 }, ...pages.map((href) => ({ url: `${SITE_URL}${href}`, priority: 0.7 }))];
}
