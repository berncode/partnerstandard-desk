// The test seed's hand edits and checks, for the storage the test user's files are in (plan 13, task 14): in memory as
// before, or in the database edition's `work_files`, through the same raw access the storage contract tests use there.
// Test sign-in only, never on Vercel.
import { SqliteWorkFiles, trashedWorkFileIds } from '@partner-desk/platform';
import { editMemoryFileByHand, markMemoryBookOld, memoryProgramOutputs, memoryTrashedPartnerFiles } from '@partner-desk/storage';
import { PARTNERS_LAYOUT, workbookRawAccess, workbookSettingsRawAccess, workFilesTarget } from '@partner-desk/storage/test-support';
import { getDb } from '@/server/runtime';

export type SeedStorage = 'memory' | 'database';

const target = () => workFilesTarget(new SqliteWorkFiles(getDb()));

/** Types "Typed in the sheet" into a program's lead, as a person editing its file does. */
export async function typeProgramLead(storage: SeedStorage, fileId: string): Promise<void> {
  if (storage === 'memory') editMemoryFileByHand(fileId, { lead: 'Typed in the sheet' });
  else await workbookSettingsRawAccess(target()).typeSetting(fileId, 'Program', 'Program lead', 'Typed in the sheet');
}

/** Types 21,000 into the Company facts' "Pays every year", the same way. */
export async function typeFactsYearly(storage: SeedStorage, fileId: string): Promise<void> {
  if (storage === 'memory') editMemoryFileByHand(fileId, { yearly: 21000 });
  else await workbookSettingsRawAccess(target()).typeSetting(fileId, 'Company facts', 'Pays every year', 21000);
}

/** Makes the Partners file read as version 1, as a file an earlier PartnerStandard Desk made. */
export async function markBookOld(storage: SeedStorage, fileId: string): Promise<void> {
  if (storage === 'memory') markMemoryBookOld(fileId);
  else await workbookRawAccess(target(), PARTNERS_LAYOUT).setSchemaVersion(fileId, 1);
}

/** The Public page last written to a program's file: its text, or null when none was written yet. */
export async function programPublicText(storage: SeedStorage, fileId: string): Promise<string | null> {
  if (storage === 'memory') return memoryProgramOutputs(fileId)?.publicText ?? null;
  const tab = (await target().getWorkbook(fileId))['Public page'];
  return tab ? tab.flat().filter((cell) => cell !== null && cell !== '').map(String).join('\n') : null;
}

/** The Partners files that went to the trash: the memory store's list, or the company's trashed rows. */
export async function trashedPartnerFiles(storage: SeedStorage, companyId: string): Promise<readonly string[]> {
  if (storage === 'memory') return memoryTrashedPartnerFiles();
  return trashedWorkFileIds(getDb(), 'partners', companyId);
}
