import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce. Next.js reads the `x-nonce`/CSP header set here and stamps the nonce
 * on every script it emits, so we can drop 'unsafe-inline' / 'unsafe-eval' for scripts in production.
 * (In dev, Next's hot-reload runtime still needs eval; we relax only there.)
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  // Skip static assets and the favicon; everything else gets a nonce.
  matcher: [{ source: '/((?!_next/static|_next/image|api/favicon).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
