/** OIDC discovery twin of the oauth-authorization-server forwarder. */
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function handle(req: Request) {
  const url = new URL(req.url);
  url.pathname = '/api/auth/.well-known/openid-configuration';
  return auth.handler(new Request(url, req));
}
export { handle as GET, handle as HEAD };
