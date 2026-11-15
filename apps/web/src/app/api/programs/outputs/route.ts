import { refreshProgramOutputs } from '@partner-desk/commands';
import { MAX_OUTPUT_IDS, PROGRAM_ID, rewriteOutputs, type Rewritten } from '@/programs/outputs';
import { actorFor, currentOwner, depsFor } from '@/server/runtime';

// Each rewrite goes through the `refreshProgramOutputs` command, which checks the program is the person's.

/** Up to 50 rewrites, one after another: Google's pace alone can take most of a minute. */
export const maxDuration = 60;

/** 50 ids of 13 characters, quoted, plus the wrapper: anything much longer isn't ours. */
const MAX_BODY = 4096;

const status = (code: number) => new Response(null, { status: code });

/** `{ programIds: string[] }`, 1 to 50 program ids, or null. */
function programIdsOf(text: string): string[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const ids = typeof body === 'object' && body !== null ? (body as { programIds?: unknown }).programIds : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_OUTPUT_IDS) return null;
  return ids.every((id) => typeof id === 'string' && PROGRAM_ID.test(id)) ? ids : null;
}

/** A browser sends Origin on a POST; one from another site is refused. None at all leaves it to the session cookie. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Rewrites the Program Sheet and Public page tabs of the person's programs: the screens' rewrites 30 seconds after a
 * change and when a program or one of its outputs opens (a fetch, so they never wait in line with the saves, which are
 * server actions and run one at a time), and what is still pending when the person leaves the tab.
 * `navigator.sendBeacon` posts the JSON as text/plain, so the body is read as JSON whatever the content type says.
 * Answers which rewrites failed and which were refused (`Rewritten`) once they are done; a beacon's answer reaches
 * nobody, so every miss is also logged with ids only, and tried again on the person's next visit.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return status(403);
  const session = await currentOwner();
  if (!session) return status(401);
  const text = await request.text();
  if (text.length > MAX_BODY) return status(413);
  const programIds = programIdsOf(text);
  if (!programIds) return status(400);
  const deps = depsFor(session);
  const actor = actorFor(session);
  const answer = await rewriteOutputs(
    programIds,
    async (programId) => {
      const result = await refreshProgramOutputs(deps, actor, { programId });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    (programId, reason) => {
      try { deps.log('program_outputs_failed', { programId, reason }); } catch { /* a log line never fails the answer */ }
    },
  );
  return Response.json(answer satisfies Rewritten);
}
