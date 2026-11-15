import { unstable_rethrow } from 'next/navigation';
import { log } from '@/server/log';
import { getAuth } from '@/server/runtime';

/**
 * Better Auth answers its own errors (redirects, 4xx, its 500s). Anything else it throws (`onAPIError.throw`), such as
 * a failed query whose error holds the query's parameters (a session token, a user id): that gets a bare 500 and one
 * log line with no detail, and never reaches Next.js, which would log it whole.
 */
async function handle(request: Request): Promise<Response> {
  try {
    return await getAuth().handler(request);
  } catch (error) {
    unstable_rethrow(error);
    log('auth_request_failed', {});
    return new Response(null, { status: 500 });
  }
}

// Built lazily so `next build` never needs the auth secrets.
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
