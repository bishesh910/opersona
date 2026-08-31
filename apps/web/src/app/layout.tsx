import type { Metadata, Viewport } from 'next';
import { headers, cookies } from 'next/headers';
import './globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', maximumScale: 5 };

export const metadata: Metadata = {
  title: 'opersona.me',
  description: 'How to think, not what to think — AI personas that reason the way their humans do',
  icons: {
    icon: [{ url: '/api/favicon', type: 'image/png', sizes: '72x72' }],
    // Explicit apple link: iOS parses static HTML for this, and the layout's
    // explicit `icons` config suppresses the app/apple-icon.png auto-injection.
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // 'light' | 'mediumlight' | 'dark' | 'mediumdark' | undefined (= follow system).
  // The mediums re-map the neutral palette via html[data-tone="medium"] (globals.css).
  const theme = (await cookies()).get('theme')?.value;
  const isDark = theme === 'dark' || theme === 'mediumdark';
  const medium = theme === 'mediumlight' || theme === 'mediumdark';
  return (
    <html lang="en" className={isDark ? 'dark' : undefined} data-tone={medium ? 'medium' : undefined} suppressHydrationWarning>
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
