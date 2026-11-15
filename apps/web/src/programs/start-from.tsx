// The words come from COPY. `children` holds Start from a market (`StartFromMarkets`).
import { PLURAL, TYPE, type ProgramType } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { ReactNode } from 'react';
import { Button } from '@/ui/button';
import type { StartMarket } from './links';
import type { ProgramOption } from './title';
import { choiceClass, choiceGrid, choiceNote } from './type-picker';

/** "How do you want to start?" (PD spec §4.2): fresh, or from a copy of one of the company's programs. */
export function StartFrom({ type, programs, busy, onStart, onBack, children }: {
  type: ProgramType;
  /** The company's programs, by their title: the label ("Reseller · DACH"), plus the name when another has that label. */
  programs: Pick<ProgramOption, 'programId' | 'label' | 'title'>[];
  busy?: boolean;
  onStart: (copyOf: string | null) => void;
  onBack: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div>
        <p className="text-sm text-ink-3">{COPY.PROG_NEW_OF_TYPE(TYPE[type])}</p>
        <h1 className="text-xl font-semibold tracking-tight">{COPY.PROG_START_TITLE}</h1>
        <p className="mt-1 text-sm text-ink-3">{COPY.PROG_START_HINT}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className={choiceGrid}>
          <button type="button" disabled={busy} className={choiceClass} onClick={() => onStart(null)}>
            {COPY.PROG_START_FRESH}
            <span className={choiceNote}>{COPY.PROG_START_FRESH_NOTE(PLURAL[type])}</span>
          </button>
          {programs.map((p) => (
            <button key={p.programId} type="button" disabled={busy} className={choiceClass} onClick={() => onStart(p.programId)}>
              {p.title === p.label ? COPY.PROG_COPY_OF(p.label) : COPY.PROG_COPY_OF_NAMED(p.title)}
              <span className={choiceNote}>{COPY.PROG_COPY_NOTE}</span>
            </button>
          ))}
          {children}
        </div>
        <div className="mt-3.5"><Button size="sm" disabled={busy} onClick={onBack}>{COPY.BACK}</Button></div>
      </div>
    </div>
  );
}

/**
 * Start from a market (spec 4.3): one choice per market of the type with a hypothesis that holds, under the copies.
 * `markets` is null while they are read.
 */
export function StartFromMarkets({ markets, busy, onStart }: { markets: StartMarket[] | null; busy?: boolean; onStart: (marketId: string) => void }) {
  if (markets === null) return <p role="status" className={choiceNote}>{COPY.PROG_FROM_MARKET_LOADING}</p>;
  return markets.map((m) => (
    <button key={m.marketId} type="button" disabled={busy} className={choiceClass} onClick={() => onStart(m.marketId)}>
      {COPY.PROG_FROM_MARKET(m.displayName)}
      <span className={choiceNote}>{COPY.PROG_FROM_MARKET_NOTE}</span>
    </button>
  ));
}
