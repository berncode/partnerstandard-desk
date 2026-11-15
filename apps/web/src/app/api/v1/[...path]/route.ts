// The REST API (agents spec 6): every route under /api/v1 but the OpenAPI document. The agent is checked as /mcp
// checks it; then `handleRest` finds the route's tool and runs it.
import { COPY } from '@partner-desk/copy';
import { connection } from 'next/server';
import { handleRest, problemOf } from '@/agents/rest';
import { resolveAgent } from '@/server/agent-auth';
import { log } from '@/server/log';

/** Seconds a request may run: a tool that saves to Google can take as long as a page's save. */
export const maxDuration = 60;

async function serve(request: Request, ctx: RouteContext<'/api/v1/[...path]'>): Promise<Response> {
  await connection(); // request-time only
  let auth: Awaited<ReturnType<typeof resolveAgent>>;
  try {
    auth = await resolveAgent(request);
  } catch {
    // A database failure while checking the credential. No error text: it can hold a query or a key's hash.
    log('agent_auth_failed', { route: 'api' });
    return problemOf(503, 'unavailable', COPY.AGENT_TRY_AGAIN);
  }
  if (!auth.ok) {
    return auth.status === 429
      ? problemOf(429, 'rate_limited', COPY.AGENT_RATE_LIMITED, { headers: auth.headers })
      : problemOf(401, 'unauthorized', COPY.AGENT_UNAUTHORIZED, { headers: auth.headers });
  }
  const { path } = await ctx.params;
  return handleRest(request, path, auth.ctx);
}

export const GET = serve;
export const POST = serve;
export const PATCH = serve;
