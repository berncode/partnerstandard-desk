'use client';

// New for PartnerStandard Desk: one partner, several markets (spec §3.2). Each market link names the partner hypothesis it
// matches in that market; the hypotheses themselves live in the market.
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY, HYPOTHESIS_STATUS_LABELS } from '@partner-desk/copy';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Button } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { Section } from '@/ui/pieces';
import { useAct, usePartner } from './partner-context';
import { linkedHypothesis, marketName, marketsToAdd, type MarketState } from './partner-model';

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

/** The partner hypothesis a link names, in a line: its name and status, or why there is none to show. */
export function HypothesisLine({ state, hypothesisId }: { state: MarketState; hypothesisId: string | null }) {
  if (state.status === 'loading') return <p className="text-sm text-ink-3">{COPY.MARKET_LOADING}</p>;
  if (state.status === 'failed') return <p className="text-sm text-danger">{state.message}</p>;
  const hypothesis = linkedHypothesis(state, hypothesisId);
  if (hypothesis === 'none') return <p className="text-sm text-ink-3">{COPY.NO_HYPOTHESIS_YET}</p>;
  if (hypothesis === 'deleted' || hypothesis === null) return <p className="text-sm text-ink-3">{COPY.DELETED_HYPOTHESIS}</p>;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="break-words">{hypothesis.name}</span>
      <Chip>{HYPOTHESIS_STATUS_LABELS[hypothesis.status]}</Chip>
    </p>
  );
}

/** *Add to a market*: one of the company's open markets for this partner's type that it is not in yet. */
function AddToMarket() {
  const { partner, book, markets } = usePartner();
  const act = useAct();
  const [marketId, setMarketId] = useState('');
  const selectId = useId();
  const offered = marketsToAdd(book, markets, partner);

  if (offered.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-3">
        {COPY.NO_MARKET_FOR_TYPE(PARTNER_TYPE_LABELS[partner.partnerType])}{' '}
        <Link href="/markets" className={linkClass}>{COPY.GO_TO_MARKETS}</Link>
      </p>
    );
  }
  const add = () => {
    if (!marketId) return;
    act({ kind: 'add', entity: 'marketLink', values: { partnerId: partner.id, marketId, hypothesisId: null } }, { label: COPY.MARKET_ADDED });
    setMarketId('');
  };
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <div className="grid min-w-0 flex-1 basis-56 gap-1">
        <label htmlFor={selectId} className="text-xs font-medium text-ink-3">{COPY.ADD_TO_MARKET}</label>
        <select id={selectId} value={marketId} className={cn(controlClass, 'px-2')} onChange={(e) => setMarketId(e.target.value)}>
          <option value="">{COPY.PICK_MARKET}</option>
          {offered.map((m) => <option key={m.marketId} value={m.marketId}>{m.displayName}</option>)}
        </select>
      </div>
      <Button type="submit" size="sm" className="h-9" disabled={!marketId}>{COPY.ADD}</Button>
    </form>
  );
}

/** The Overview's Markets card: each market the partner is in, with the partner hypothesis it matches there. */
export function MarketLinks() {
  const { partner, book, markets, marketStates, readOnly } = usePartner();
  const links = book.marketLinks.filter((l) => l.partnerId === partner.id);
  return (
    <Section title={COPY.MARKETS_TITLE} description={COPY.MARKETS_TEXT}>
      {links.length === 0 ? <p className="text-sm text-ink-3">{COPY.MARKETS_EMPTY}</p> : (
        <ul className="grid gap-2">
          {links.map((link) => (
            <li key={link.id} data-testid="market-link" className="grid gap-1 rounded-lg border border-line p-3">
              <Link href={`/markets/${encodeURIComponent(link.marketId)}`} className={cn(linkClass, 'w-fit text-sm break-words')}>
                {marketName(markets, link.marketId)}
              </Link>
              <HypothesisLine state={marketStates[link.marketId] ?? { status: 'loading' }} hypothesisId={link.hypothesisId} />
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <AddToMarket />}
    </Section>
  );
}
