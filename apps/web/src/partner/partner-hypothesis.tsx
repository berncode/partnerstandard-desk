'use client';

// One row per market the partner is in, since each market link names the partner hypothesis it matches there. Editing happens in the market.
import type { MarketLink } from '@partner-desk/core';
import { COPY, HYPOTHESIS_STATUS_LABELS } from '@partner-desk/copy';
import Link from 'next/link';
import { useState } from 'react';
import { Button, buttonVariants } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { Section } from '@/ui/pieces';
import { sayIfRefused, usePartner } from './partner-context';
import { hypothesesPath, linkedHypothesis, marketName } from './partner-model';

function LinkRow({ link }: { link: MarketLink }) {
  const { account, partner, book, markets, marketStates, dispatch, readOnly, addHypothesis, idFor } = usePartner();
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = marketStates[link.marketId] ?? { status: 'loading' };
  const hypothesis = linkedHypothesis(state, link.hypothesisId);
  const hasCalls = book.calls.some((call) => call.partnerId === partner.id);
  const name = marketName(markets, link.marketId);

  const setLinked = (hypothesisId: string | null, label: string, linkId = link.id) =>
    dispatch({ kind: 'update', entity: 'marketLink', id: idFor(linkId), patch: { hypothesisId } }, { label });
  const write = async () => {
    setWriting(true);
    const linkId = link.id;
    const added = await addHypothesis(link.marketId, { name: account.company, status: 'draft' });
    setWriting(false);
    if (!added.ok) return setError(added.message);
    // The draft is in the market now, whatever happens to the link: say so if the link is refused.
    const linkedIt = setLinked(added.id, COPY.HYPOTHESIS_WRITTEN, linkId);
    setError(linkedIt.ok ? null : COPY.HYPOTHESIS_NOT_LINKED(linkedIt.message));
  };

  return (
    <li className="grid gap-3 rounded-lg border border-line p-3">
      <h3 className="text-sm font-semibold break-words">{name}</h3>
      {state.status === 'failed' ? <p className="text-sm text-danger">{state.message}</p> : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-1 basis-56 gap-1 text-xs font-medium text-ink-3">
            <span>{COPY.LINKED_HYPOTHESIS}<span className="sr-only">{` · ${name}`}</span></span>
            <select value={link.hypothesisId ?? ''} disabled={readOnly || state.status !== 'ready'}
              onChange={(e) => sayIfRefused(setLinked(e.target.value || null, e.target.value ? COPY.HYPOTHESIS_LINKED : COPY.HYPOTHESIS_UNLINKED))}
              className={cn(controlClass, 'truncate px-2 disabled:opacity-70')}>
              <option value="">{state.status === 'loading' ? COPY.MARKET_LOADING : COPY.NO_HYPOTHESIS}</option>
              {state.status === 'ready' && state.market.hypotheses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              {link.hypothesisId && hypothesis === 'deleted' && <option value={link.hypothesisId}>{COPY.DELETED_HYPOTHESIS}</option>}
            </select>
          </label>
          {!readOnly && hasCalls && state.status === 'ready' && (
            <Button size="sm" className="h-9" disabled={writing} onClick={() => void write()}>{COPY.WRITE_FROM_CALL}</Button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {hypothesis !== null && typeof hypothesis === 'object' && (
        <div className="grid gap-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium break-words">{hypothesis.name}</span>
            <Chip>{HYPOTHESIS_STATUS_LABELS[hypothesis.status]}</Chip>
          </p>
          {hypothesis.theirSide && <p className="break-words whitespace-pre-wrap text-ink-2">{hypothesis.theirSide}</p>}
          {hypothesis.ourSide && <p className="break-words whitespace-pre-wrap text-ink-2">{hypothesis.ourSide}</p>}
          {/* Read only (a company server's viewer), there is nothing to edit (owner, 2026-11-14). */}
          {!readOnly && (
            <div>
              <Link href={hypothesesPath(link.marketId)} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
                {COPY.EDIT_HYPOTHESIS}
              </Link>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The partner hypothesis: per market, link one of the market's partner hypotheses, or *Write one from this call*, which
 * adds a draft to that market and links it. The market's Partner hypotheses tab is where it is written out.
 */
export function PartnerHypothesis() {
  const { partner, book, readOnly, showMarkets } = usePartner();
  const links = book.marketLinks.filter((l) => l.partnerId === partner.id);
  const hasCalls = book.calls.some((call) => call.partnerId === partner.id);
  const unlinked = links.some((l) => l.hypothesisId === null);
  return (
    <Section title={COPY.HYPOTHESIS_TITLE} description={COPY.HYPOTHESIS_TEXT}>
      {links.length === 0 ? (
        <p className="text-sm text-ink-3">
          {COPY.HYPOTHESIS_NEEDS_MARKET}
          {/* Read only (a company server's viewer), there is no Add to a market to go to (owner, 2026-11-14). */}
          {!readOnly && (
            <>
              {' '}
              <button type="button" onClick={() => showMarkets()}
                className="rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                {COPY.ADD_IT_TO_A_MARKET}
              </button>
            </>
          )}
        </p>
      ) : (
        <ul className="grid gap-3">{links.map((link) => <LinkRow key={link.id} link={link} />)}</ul>
      )}
      {!readOnly && !hasCalls && unlinked && <p className="mt-3 text-sm text-ink-3">{COPY.LOG_CALL_FIRST}</p>}
    </Section>
  );
}
