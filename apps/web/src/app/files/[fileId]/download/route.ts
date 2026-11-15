// A database file as a spreadsheet (plan 13, task 12): what "Download as a spreadsheet" opens on a company server. A
// GET that only reads the file: it records nothing and acts on nothing, so a link scanner opening it
// does no harm (AGENTS.md, emails never act on a GET).
import { exportFile } from '@partner-desk/commands';
import { connection } from 'next/server';
import { disposition, xlsx } from '@/files/xlsx';
import { actorFor, currentOwner, depsFor } from '@/server/runtime';

const status = (code: number) => new Response(null, { status: code, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request: Request, ctx: RouteContext<'/files/[fileId]/download'>) {
  await connection();
  const session = await currentOwner();
  if (!session) return status(401);
  if (session.storage !== 'database') return status(404);
  const { fileId } = await ctx.params;
  const out = await exportFile(depsFor(session), actorFor(session), { fileId });
  if (!out.ok) return status(out.error === 'unavailable' ? 503 : 404);
  return new Response(new Uint8Array(xlsx(out.value)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': disposition(out.value.name),
      'Cache-Control': 'no-store',
    },
  });
}
