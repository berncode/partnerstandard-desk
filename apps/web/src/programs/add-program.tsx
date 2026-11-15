'use client';

// The words come from COPY. The company's programs come from the page (the directory's list, with titles that tell
// twins apart), and making one goes through the `programCreate` server action. Start from a market (spec 4.3): for the
// open markets of the type with a hypothesis that holds.
import type { ProgramType } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { RemoteOutcome } from '@/editor/remote';
import type { StartMarket } from './links';
import { StartFrom, StartFromMarkets } from './start-from';
import { programPath } from './steps';
import type { ListedProgram, ProgramOption } from './title';
import { TypePicker } from './type-picker';

export type { ListedProgram };

/** Where a new program starts: the type's starting answers, a copy, or a market. */
export type StartPoint = 'fresh' | { copyOf: string } | { marketId: string };

export type CreateProgram = (input: { partnerType: ProgramType; from: StartPoint }) =>
  Promise<RemoteOutcome<{ programId: string; marketLinkMessage?: string }>>;

/** The markets a program of the type can start from (`programStartMarkets`). */
export type MarketsFor = (partnerType: ProgramType) => Promise<RemoteOutcome<{ markets: StartMarket[] }>>;

const NO_MARKETS: MarketsFor = async () => ({ ok: true, markets: [] });

/**
 * Add a program (PD spec §4.2): pick the partner type. With no program yet and no market to start from, it is made
 * at once; otherwise the person chooses fresh, a copy or a market (spec 4.3). The markets are read when the type is
 * picked (one read of each open market of the type); a list that can't be read offers none. Then the pages already
 * visited are read again (so Back to Programs lists the new one) and step 1 opens.
 */
export function AddProgram({ companyName, programs, create, marketsFor = NO_MARKETS }: {
  companyName: string; programs: ProgramOption[]; create: CreateProgram; marketsFor?: MarketsFor;
}) {
  const router = useRouter();
  const [type, setType] = useState<ProgramType | null>(null);
  /** The markets of the picked type to start from; null while they are read. */
  const [markets, setMarkets] = useState<StartMarket[] | null>(null);
  /** Which pick the markets answer: a later pick (or Back) makes an earlier answer stale. */
  const pick = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  // Once a program is made, nothing here may make another while the route loads (push doesn't wait).
  const done = useRef(false);
  const [finished, setFinished] = useState(false);
  // Next keeps this page, hidden, while the person is away (Cache Components). Coming back starts at the picker again.
  useLayoutEffect(() => () => {
    done.current = false;
    pick.current += 1;
    setFinished(false);
    setType(null);
    setMarkets(null);
    setError(null);
  }, []);

  /** The programs a new one of `picked` can copy: a copy keeps its partner type (owner, 2026-10-30). */
  const copiesOf = (picked: ProgramType) => programs.filter((p) => p.partnerType === picked);

  const make = (picked: ProgramType, from: StartPoint) => startPending(async () => {
    if (done.current) return;
    setError(null);
    let result: Awaited<ReturnType<CreateProgram>>;
    try {
      result = await create({ partnerType: picked, from });
    } catch {
      result = { ok: false, error: 'unavailable', message: COPY.SOMETHING_WRONG };
    }
    if (!result.ok) {
      setError(result.message);
      return;
    }
    done.current = true;
    setFinished(true);
    // The program is made either way; the market's link is the one part that can be missing.
    if (result.marketLinkMessage) toast.error(result.marketLinkMessage);
    router.refresh();
    router.push(programPath(result.programId, 'why'));
  });

  /**
   * Asks how to start, or with nothing to copy and no market to start from, makes the program fresh at once. Not in
   * the transition: the copies show while the markets are read.
   */
  const choose = (picked: ProgramType) => {
    const mine = ++pick.current;
    setError(null);
    setMarkets(null);
    setType(picked);
    const offered = marketsFor(picked)
      .then((answer) => (answer.ok ? answer.markets : []))
      // A list that can't be read offers no market; fresh and the copies still work.
      .catch(() => []);
    void offered.then((list) => {
      if (mine !== pick.current) return;
      setMarkets(list);
      if (!copiesOf(picked).length && list.length === 0) make(picked, 'fresh');
    });
  };

  const back = () => {
    pick.current += 1;
    setType(null);
    setMarkets(null);
    setError(null);
  };

  const alert = error && <p role="alert" className="text-sm text-danger">{error}</p>;

  if (type && (copiesOf(type).length || (markets && markets.length))) {
    return (
      <div className="grid gap-3">
        <StartFrom type={type} programs={copiesOf(type)} busy={pending || finished}
          onStart={(copyOf) => make(type, copyOf ? { copyOf } : 'fresh')} onBack={back}>
          <StartFromMarkets markets={markets} busy={pending || finished} onStart={(marketId) => make(type, { marketId })} />
        </StartFrom>
        {alert && <div className="mx-auto w-full max-w-3xl">{alert}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div>
        <p className="text-sm text-ink-3">{companyName.trim() || COPY.COMPANY_UNNAMED}</p>
        <h1 className="text-xl font-semibold tracking-tight">{COPY.NAV_ADD_PROGRAM}</h1>
        <p className="mt-1 text-sm text-ink-3">{COPY.PROG_ADD_HINT}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <TypePicker have={programs.map((p) => p.partnerType)} busy={pending || finished || (type !== null && markets === null)} onPick={choose} />
      </div>
      {alert}
    </div>
  );
}
