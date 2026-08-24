import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', maximumScale: 5 };

export const metadata: Metadata = {
  title: 'opersona',
  description: 'How to think, not what to think — AI personas that reason the way their humans do',
  icons: { icon: [{ url: '/api/favicon', type: 'image/png', sizes: '72x72' }] },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full bg-white font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})()" }} />
        {children}
      </body>
    </html>
  );
}
