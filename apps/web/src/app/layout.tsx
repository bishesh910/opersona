import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'opersona',
  description: 'How to think, not what to think — AI personas that reason the way their humans do',
  icons: { icon: [{ url: '/api/favicon', type: 'image/png', sizes: '72x72' }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
