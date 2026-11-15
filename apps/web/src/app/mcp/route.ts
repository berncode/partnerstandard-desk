// The MCP server at /mcp (agents spec 4, 5): stateless streamable HTTP, one fresh server per request, no session id.
// `@modelcontextprotocol/server` 2.x: POST serves both protocol eras; GET and
// DELETE, which only sessions need, answer 405 from the package once the agent is checked.
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import type { AgentContext } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { connection } from 'next/server';
import { buildMcpServer } from '@/agents/mcp-server';
import { resolveAgent } from '@/server/agent-auth';
import { log } from '@/server/log';

/** Seconds a request may run: a tool that saves to Google can take as long as a page's save. */
export const maxDuration = 60;

/** Where the checked agent travels from the route to the server factory, inside the package's pass-through `authInfo`. */
const CONTEXT_KEY = 'partnerDeskAgent';

function contextOf(authInfo: AuthInfo | undefined): AgentContext {
  const ctx = authInfo?.extra?.[CONTEXT_KEY];
  // Never reached: the route passes a checked context with every request it hands on.
  if (!ctx) throw new Error('mcp_without_agent');
  return ctx as AgentContext;
}

const handler = createMcpHandler(({ authInfo }) => buildMcpServer(contextOf(authInfo)), {
  // Reporting only. The error's name, never its message: it can carry the request's content.
  onerror: (error) => log('mcp_request_failed', { error: error.name }),
});

/** A JSON-RPC error with no id: the request was never read. */
const unavailable = (): Response => Response.json(
  { jsonrpc: '2.0', id: null, error: { code: -32603, message: COPY.AGENT_TRY_AGAIN } },
  { status: 503 },
);

async function serve(request: Request): Promise<Response> {
  await connection(); // request-time only
  let auth: Awaited<ReturnType<typeof resolveAgent>>;
  try {
    auth = await resolveAgent(request);
  } catch {
    // A database failure while checking the credential. No error text: it can hold a query or a key's hash.
    log('agent_auth_failed', { route: 'mcp' });
    return unavailable();
  }
  if (!auth.ok) return new Response(null, { status: auth.status, headers: auth.headers });
  // `token` stays empty: nothing downstream needs the credential, so it never travels further than `resolveAgent`.
  const authInfo: AuthInfo = {
    token: '', clientId: auth.grantKey, scopes: [auth.ctx.actor.level], extra: { [CONTEXT_KEY]: auth.ctx },
  };
  return handler.fetch(request, { authInfo });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
