/**
 * RFC 9728 protected-resource metadata for the MCP connector. The mcp plugin
 * answers this exact root path (and its /mcp-suffixed form) from its onRequest
 * hook, so the original request is forwarded into the auth handler untouched.
 */
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const handle = (req: Request) => auth.handler(req);
export { handle as GET, handle as HEAD };
