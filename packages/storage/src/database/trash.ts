// What a trashed file on a company server is (plan 16, task 1): read from its body with the same specs the stores use,
// so the trash screen can name it and a restore can make its directory row again. Pure: no store, no database.
import { programLabel, type ProgramType, type Side } from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';
import { CASE_SPEC, PROGRAM_SPEC } from '../workbook/file-specs';
import { MAP_SPEC } from '../workbook/writer';
import { readTabsOf } from './file-store';
import { parseBody } from './workbook-store';

/** The kinds a person deletes, and so the trash lists: never a Partners or Company facts file, never a market. */
export const TRASH_KINDS = ['businessCase', 'map', 'program'] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

/** A trashed file, as its body says. */
export type TrashedContent =
  | { kind: 'businessCase'; caseId: string; partnerId: string; partnerType: PartnerType; title: string; createdAt: string }
  | { kind: 'map'; partnerId: string; partnerType: PartnerType; people: Array<{ personId: string; side: Side; email: string | null }> }
  | { kind: 'program'; programId: string; programType: ProgramType; label: string };

/** The body of a trashed file of `kind`, read; null when it can't be read (then it can't be restored either). */
export function readTrashed(kind: TrashKind, body: string): TrashedContent | null {
  const wb = parseBody(body);
  if (!wb) return null;
  // A tab of the wrong shape makes a reader throw: the trash still lists the file, as one that can't be read.
  try {
    if (kind === 'businessCase') {
      const read = CASE_SPEC.read(readTabsOf(wb, CASE_SPEC.readTabs));
      if (!read.ok) return null;
      const c = read.value;
      return { kind, caseId: c.id, partnerId: c.partnerId, partnerType: c.partnerType, title: c.title, createdAt: c.createdAt };
    }
    if (kind === 'program') {
      const read = PROGRAM_SPEC.read(readTabsOf(wb, PROGRAM_SPEC.readTabs));
      if (!read.ok) return null;
      return { kind, programId: read.value.id, programType: read.value.type, label: programLabel(read.value) };
    }
    const decoded = MAP_SPEC.decode(wb);
    if (!decoded.ok) return null;
    const { info, people } = decoded.value.value;
    return { kind, partnerId: info.partnerId, partnerType: info.partnerType, people: people.map((p) => ({ personId: p.id, side: p.side, email: p.email })) };
  } catch {
    return null;
  }
}
