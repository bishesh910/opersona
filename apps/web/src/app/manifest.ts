import type { MetadataRoute } from 'next';

/** Home-screen identity: the default pixie head on the Night Shift dark.
 *  (The browser-tab favicon stays dynamic — the signed-in user's own pixie.) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'opersona',
    short_name: 'opersona',
    description: 'An AI persona that learns how you think — evidence-backed, testable, yours.',
    start_url: '/',
    display: 'minimal-ui',
    background_color: '#07070c',
    theme_color: '#07070c',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
