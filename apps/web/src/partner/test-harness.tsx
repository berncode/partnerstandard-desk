// For the partner page's component tests: the page's context over a real Partner book, with core's rules applied to
// every change, so a test sees what the person would see.
import { applyPartnerChange, type PartnerBook, type PartnerChange } from '@partner-desk/core';
import { NOW } from '@partner-desk/core/test-builders';
import { render } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import type { DispatchOptions } from '@/editor/use-editor';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramLevels } from '@/programs/links';
import type { ProgramOption } from '@/programs/title';
import { PartnerContext, type AddHypothesis } from './partner-context';
import type { MarketState } from './partner-model';

export interface HarnessOptions {
  partnerId?: string;
  readOnly?: boolean;
  markets?: MarketOption[];
  marketStates?: Record<string, MarketState>;
  addHypothesis?: AddHypothesis;
  showMarkets?: () => void;
  /** Refuse every change with this message, as the editor does when a change can't apply. */
  refuse?: string;
  programs?: ProgramOption[];
  /** False when the list of programs couldn't be read (default true). */
  programsListed?: boolean;
  /** Each program's levels as the page has them; a program left out is still loading. */
  levels?: Record<string, ProgramLevels>;
  /** The owner's today, as the server reads it (default `OWNER_TODAY`). */
  today?: string;
}

/** The owner's today the harness gives the page unless a test says otherwise. */
export const OWNER_TODAY = '2026-10-28';

export interface Dispatched { change: PartnerChange; options?: DispatchOptions }

let ids = 0;

function Harness({ start, options, log, children }: { start: PartnerBook; options: HarnessOptions; log: Dispatched[]; children: ReactNode }) {
  const [book, setBook] = useState(start);
  const current = useRef(start);
  const dispatch = (change: PartnerChange, dispatchOptions?: DispatchOptions) => {
    log.push({ change, options: dispatchOptions });
    if (options.refuse) return { ok: false as const, error: 'invalid' as const, message: options.refuse };
    const outcome = applyPartnerChange(current.current, change, { now: NOW, actor: 'Anna', newId: (kind) => `${kind}_local${++ids}` });
    if (outcome.ok) {
      current.current = outcome.value;
      setBook(outcome.value);
    }
    return outcome;
  };
  const partner = book.partners.find((p) => p.id === (options.partnerId ?? 'p_abc123'));
  const account = book.accounts.find((item) => item.id === partner?.accountId);
  if (!partner || !account) return <p>gone</p>;
  const apply = async (change: PartnerChange, dispatchOptions?: DispatchOptions) => {
    const outcome = dispatch(change, dispatchOptions);
    return outcome.ok ? { ok: true as const, entityId: outcome.entityId } : { ok: false as const };
  };
  return (
    <PartnerContext.Provider value={{
      account, partner, book, dispatch, apply, readOnly: options.readOnly ?? false, markets: options.markets ?? [],
      marketStates: options.marketStates ?? {}, addHypothesis: options.addHypothesis ?? (async () => ({ ok: false, message: 'no' })),
      idFor: (id) => id, showMarkets: options.showMarkets ?? (() => {}),
      programs: options.programs ?? [], programsListed: options.programsListed ?? true, levelsOf: (id) => options.levels?.[id] ?? { status: 'loading' },
      today: options.today ?? OWNER_TODAY,
    }}>
      {children}
    </PartnerContext.Provider>
  );
}

/** Renders `ui` inside the partner page's context. `dispatched` lists every change made, in order. */
export function renderPartner(ui: ReactNode, book: PartnerBook, options: HarnessOptions = {}) {
  const dispatched: Dispatched[] = [];
  const result = render(<Harness start={book} options={options} log={dispatched}>{ui}</Harness>);
  return { ...result, dispatched };
}
