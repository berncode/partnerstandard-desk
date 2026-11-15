// New for PartnerStandard Desk (spec 5.2): what a case could not take from its program, said on its offer tab.
import type { CaseOffer, TermNote } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Info } from 'lucide-react';

/** The text of a term note, with the case's own name for its higher level. */
export function termNoteText(note: TermNote, levels: CaseOffer['levels']): string {
  switch (note) {
    case 'flat-fee':
      return COPY.CASE_NOTE_FLAT_FEE;
    case 'contract-years':
      return COPY.CASE_NOTE_CONTRACT_YEARS;
    case 'bars':
      return COPY.CASE_NOTE_BARS(levels.preferred);
    case 'pref-req':
      return COPY.CASE_NOTE_PREF_REQ(levels.preferred);
    case 'no-program':
      return COPY.CASE_NOTE_NO_PROGRAM;
    case 'no-program-type':
      return COPY.CASE_NOTE_NO_PROGRAM_TYPE;
  }
}

/** The case's term notes, one line each, in the look of the app's info call-outs; nothing when there are none. */
export function TermNotes({ notes, levels }: { notes: readonly TermNote[]; levels: CaseOffer['levels'] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {notes.map((note) => (
        <li key={note} className="flex gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span className="min-w-0 break-words">{termNoteText(note, levels)}</span>
        </li>
      ))}
    </ul>
  );
}
