import { unstable_rethrow } from 'next/navigation';
import { connection } from 'next/server';
import { log } from '@/server/log';
import { getAuth } from '@/server/runtime';

/**
 * The OAuth discovery documents agent apps ask for at the root:
 * `/.well-known/oauth-protected-resource/mcp` (RFC 9728) and `/.well-known/oauth-authorization-server/api/auth`
 * (RFC 8414), and their forms without the path. Better Auth's OAuth provider answers them; anything else is its 404.
 * One catch-all, so the clients' first try (the path-inserted form) is answered.
 */
export async function GET(request: Request): Promise<Response> {
  await connection(); // request time only: never prerendered at build
  try {
    return await getAuth().handler(request);
  } catch (error) {
    unstable_rethrow(error);
    log('well_known_failed', {});
    return new Response(null, { status: 500 });
  }
}
