// A database file's spreadsheet download (plan 13, task 12): a read, the person's own company's file only.
import { COPY } from '@partner-desk/copy';
import { WORK_FILE_ID, type ExportedFile } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import type { Actor } from './actor';
import type { Deps } from './deps';
import { companyOf } from './own-company';
import { FORBIDDEN, invalid, NOT_FOUND_FILE, ok, record, type CommandResult } from './result';

/** A database file's id, as the storage makes and checks it: one pattern for both (final review). */
const exportInput = z.object({ fileId: z.string().regex(WORK_FILE_ID) }).strict();

/**
 * The file's tabs and name, for its download: only a file of the person's own company, and only on the database
 * edition (hosted, the file is in Drive). A file that is gone, trashed or another company's answers the same: not found.
 */
export async function exportFile(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<ExportedFile>> {
  const parsed = exportInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'files.export', { ownerUserId: actor.userId })) return FORBIDDEN;
  if (!deps.fileExports) return NOT_FOUND_FILE;
  const { fileId } = parsed.data;
  const [company, out] = await Promise.all([companyOf(deps, actor.userId), deps.fileExports.export(fileId)]);
  if (out === 'unavailable') return { ok: false, error: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE };
  if (out === null || out.companyId !== company) return NOT_FOUND_FILE;
  await record(deps, actor, 'files.export', fileId, []);
  return ok(out);
}
