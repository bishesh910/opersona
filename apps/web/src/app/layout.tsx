import type { Metadata, Viewport } from 'next';
import { headers, cookies } from 'next/headers';
import './globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', maximumScale: 5 };

export const metadata: Metadata = {
  title: 'opersona',
  description: 'How to think, not what to think — AI personas that reason the way their humans do',
  icons: { icon: [{ url: '/api/favicon', type: 'image/png', sizes: '72x72' }] },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const theme = (await cookies()).get('theme')?.value; // 'dark' | 'light' | undefined (= follow system)
  return (
    <html lang="en" className={theme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
      <body className="min-h-full bg-white font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {/* Only when no explicit choice: follow the system, live. Explicit themes are server-stamped above. */}
        {!theme && (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){localStorage.removeItem('theme');document.cookie='theme='+t+'; max-age=31536000; path=/; samesite=lax'+(location.protocol==='https:'?'; secure':'');document.documentElement.classList.toggle('dark',t==='dark');return;}var m=matchMedia('(prefers-color-scheme: dark)');var f=function(){document.documentElement.classList.toggle('dark',m.matches)};f();m.addEventListener('change',f);}catch(e){}})()" }} />
        )}
        {children}
      </body>
    </html>
  );
}
