/**
 * RFC 8414 authorization-server metadata. The issuer is https://<host>/api/auth,
 * so clients doing path-aware discovery hit /.well-known/oauth-authorization-server/api/auth
 * (or probe the plain root) — both map to the endpoint better-auth mounts under its base path.
 */
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function handle(req: Request) {
  const url = new URL(req.url);
  url.pathname = '/api/auth/.well-known/oauth-authorization-server';
  return auth.handler(new Request(url, req));
}
export { handle as GET, handle as HEAD };
