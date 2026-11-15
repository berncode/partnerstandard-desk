import type { PartnerBook, PartnerChange, Program } from '@partner-desk/core';
import { type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { can } from './access';
import type { Actor } from './actor';
import type { Deps } from './deps';
import { FORBIDDEN, fromStore, isOwner, type Failure } from './result';

/** A link to a program that is refused: the field it was set on says why. Nothing is written. */
const refused = (field: string, message: string): Failure => ({ ok: false, error: 'invalid', message, fieldErrors: { [field]: message } });

/**
 * Checks a program a partner type or a market is about to point at: it is one of this company's programs that
 * the person owns (else it is "not found", as for a program that isn't there), it is for `partnerType`, its file is
 * there (one read of the program's file), and, when the level is Preferred, the program has Preferred on. `programs`
 * keeps the files read, so a batch reads each one once.
 */
async function checkProgram(
  deps: Deps, actor: Actor, companyId: string, programId: string, partnerType: PartnerType, field: string,
  level: unknown, programs: Map<string, Program>,
): Promise<Failure | null> {
  const entry = await deps.directory.program(programId);
  if (!entry || entry.companyId !== companyId || !isOwner(actor, entry)) return refused(field, COPY.PROGRAM_NOT_FOUND);
  if (!can(actor, 'programs.read', entry)) return FORBIDDEN;
  if (entry.partnerType !== partnerType) return refused(field, COPY.PROGRAM_OTHER_TYPE);
  // The file is read for every link, not only for Preferred: a file trashed by hand while the directory still lists it
  // is refused here, so nothing points at it (one read, usually cached).
  let program = programs.get(programId);
  if (!program) {
    const read = await deps.programs.read({ fileId: entry.fileId });
    // A file trashed by hand while the directory still lists it: the same answer as a program that isn't there.
    if (!read.ok) return read.error === 'file_not_found' ? refused(field, COPY.PROGRAM_NOT_FOUND) : fromStore(read);
    program = read.snapshot.value;
    programs.set(programId, program);
  }
  return level !== 'pref' || program.prefOn ? null : refused('level', COPY.PREFERRED_OFF(program.prefName));
}

/** The fields an add or update of a partner type sets, or null for any other change. */
function partnerFields(change: PartnerChange): Record<string, unknown> | null {
  if ((change.kind !== 'add' && change.kind !== 'update') || change.entity !== 'partner') return null;
  return change.kind === 'add' ? change.values : change.patch;
}

/**
 * Checks every program and level the changes set on a partner type (Review Focus 3). Only a change that names a
 * program, or moves a partner type to Preferred, is checked; clearing the program, or a level of Registered or
 * none, needs no program. An update is checked against the partner type as the file holds it now (one read of the
 * Partners file, only when such an update comes); an update of a partner type that isn't there is left for the store
 * to refuse. Null when every change may go ahead.
 */
export async function checkPartnerPrograms(
  deps: Deps, actor: Actor, companyId: string, book: { fileId: string }, changes: readonly PartnerChange[],
): Promise<Failure | null> {
  const programs = new Map<string, Program>();
  let current: PartnerBook | undefined;
  for (const change of changes) {
    const fields = partnerFields(change);
    if (!fields) continue;
    const setsProgram = 'programId' in fields && fields.programId !== null;
    if (!setsProgram && fields.level !== 'pref') continue;
    let partnerType: unknown = fields.partnerType;
    let programId: unknown = fields.programId;
    let level: unknown = fields.level;
    if (change.kind === 'update') {
      if (!current) {
        const read = await deps.partnerBooks.read(book);
        if (!read.ok) return fromStore(read);
        current = read.snapshot.value;
      }
      const partner = current.partners.find((p) => p.id === change.id);
      if (!partner) continue;
      partnerType = partner.partnerType;
      if (!('programId' in fields)) programId = partner.programId;
      if (!('level' in fields)) level = partner.level;
    }
    // A level without a program, or a value of the wrong kind, is core's to refuse.
    if (typeof programId !== 'string' || typeof partnerType !== 'string') continue;
    const failure = await checkProgram(deps, actor, companyId, programId, partnerType as PartnerType, 'programId', level, programs);
    if (failure) return failure;
  }
  return null;
}

/**
 * Checks the program a market is to feed (Review Focus 3): one of this company's programs, for the market's
 * partner type. Null (the default for "feeds none") needs no check. `partnerType` is asked only when needed: for an
 * existing market it costs a read of the market's file.
 */
export async function checkFeeds(
  deps: Deps, actor: Actor, companyId: string, feedsProgramId: unknown, partnerType: () => Promise<PartnerType | Failure>,
): Promise<Failure | null> {
  if (typeof feedsProgramId !== 'string') return null;
  const type = await partnerType();
  if (typeof type !== 'string') return type;
  return checkProgram(deps, actor, companyId, feedsProgramId, type, 'feedsProgramId', null, new Map());
}
