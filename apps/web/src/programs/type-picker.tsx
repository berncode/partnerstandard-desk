'use client';

// The words come from COPY. PartnerStandard Desk's partner type Other has no program: it shows grayed out with its
// reason, in a group of its own after the four.
import { GROUPS, OUT, TYPE, TYPE_DESC, type OutKey, type ProgramType } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useId } from 'react';
import { cn } from '@/ui/cn';

/** The look of one choice: partner types here, "Start fresh" and the copies in StartFrom. */
export const choiceClass =
  'flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left text-sm font-medium outline-none ' +
  'hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-default disabled:bg-surface-2 disabled:text-ink-3 disabled:hover:bg-surface-2';
export const choiceNote = 'text-xs leading-snug font-normal text-ink-3';
export const choiceGrid = 'grid grid-cols-1 gap-2 sm:grid-cols-2';

/** Program Designer's four groups, then PartnerStandard Desk's Other. */
export const PICKER_GROUPS: { name: string; types: (ProgramType | OutKey)[] }[] = [...GROUPS, { name: TYPE.other, types: ['other'] }];

/**
 * The partner types in their groups (PD spec §4.2). Types without a program are disabled with the reason. A type the
 * company already has says so and stays clickable: several programs of one type are fine.
 */
export function TypePicker({ have, onPick, busy }: { have: ProgramType[]; onPick: (type: ProgramType) => void; busy?: boolean }) {
  const id = useId();
  return (
    <div className="grid gap-3.5">
      {PICKER_GROUPS.map((g, i) => (
        <div key={g.name} role="group" aria-labelledby={`${id}-${i}`}>
          <h2 id={`${id}-${i}`} className="mb-2 text-sm font-semibold">{g.name}</h2>
          <div className={choiceGrid}>
            {g.types.map((t) => {
              const out = Object.hasOwn(OUT, t) ? OUT[t as OutKey] : null;
              const n = out ? 0 : have.filter((x) => x === t).length;
              return (
                <button key={t} type="button" disabled={!!out || busy} className={choiceClass}
                  onClick={() => { if (!out) onPick(t as ProgramType); }}>
                  {TYPE[t]}
                  <span className={cn(choiceNote)}>{out ?? TYPE_DESC[t as ProgramType]}{n ? ` ${COPY.PROG_HAVE(n)}` : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
