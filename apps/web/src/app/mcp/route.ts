/**
 * The opersona MCP server — what claude.ai talks to once someone adds
 * https://opersona.me/mcp as a custom connector. Bearer JWTs are verified
 * against our own authorization server (requireMcpAuth → /api/auth/jwks);
 * each request gets a fresh stateless server scoped to the token's user.
 */
import { requireMcpAuth } from '@better-auth/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { auth } from '@/lib/auth';
import { registerOpersonaTools } from '@/lib/mcp-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RESOURCE = `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/mcp`;

const handler = requireMcpAuth(auth, async (req, claims) => {
  const userId = typeof claims.sub === 'string' ? claims.sub : '';
  if (!userId) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'token has no subject' }, id: null }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const server = new McpServer({ name: 'opersona', version: '1.0.0' });
  registerOpersonaTools(server, userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: every POST carries everything needed
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}, { resource: RESOURCE });

export { handler as POST, handler as GET, handler as DELETE };
