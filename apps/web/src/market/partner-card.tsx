'use client';

// A card opens the partner's own page, and a signed partner shows its stage.
import { STAGE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { accountOf } from '@partner-desk/core';
import { partnerHref, partnerRecommendation } from '@/partner/partner-model';
import { RecommendationChip } from '@/partner/recommendation-chip';
import { Chip } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { SavingName } from '@/ui/pieces';
import { useMarket } from './market-context';
import { closedChip, type MarketPartner } from './market-model';

/**
 * A partner on the Pipeline: company, how it closed, the advice, whether the MAP is agreed (at the MAP step) or its
 * stage (once signed), and the partner hypothesis its link to this market names. The whole card opens the partner.
 */
export function PartnerCard({ card: { partner, hypothesisId } }: { card: MarketPartner }) {
  const { market, book, partners } = useMarket();
  const closed = closedChip(partner);
  const recommendation = partner.signedDate === null ? partnerRecommendation(partner) : null;
  const hypothesis = hypothesisId === null ? null : market.hypotheses.find((h) => h.id === hypothesisId);
  const name = accountOf(book, partner)?.company ?? '';
  const accountId = partners.savedIdFor(partner.accountId);
  return (
    <li className={cn('relative min-w-0 rounded-xl border border-line bg-surface p-3 hover:border-ink-3 focus-within:ring-2 focus-within:ring-brand',
      closed && 'bg-surface-2/60')}>
      {accountId === null ? <SavingName className="text-sm font-semibold">{name}</SavingName> : (
        <Link href={partnerHref(accountId, partner.partnerType)}
          className="block w-full text-left text-sm font-semibold break-words outline-none after:absolute after:inset-0 after:rounded-xl">
          {name}
        </Link>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {closed && <Chip>{closed}</Chip>}
        {!closed && partner.signedDate !== null && <Chip tone="brand">{STAGE_LABELS[partner.stage]}</Chip>}
        {recommendation && <RecommendationChip recommendation={recommendation} />}
        {partner.step === 'map' && partner.signedDate === null
          && (partner.mapFilled ? <Chip tone="brand">{COPY.MAP_AGREED}</Chip> : <Chip tone="warn">{COPY.WAITING_ON_MAP}</Chip>)}
      </div>
      {hypothesis && <p className="mt-2 text-xs break-words text-ink-3">{hypothesis.name || COPY.UNTITLED_HYPOTHESIS}</p>}
    </li>
  );
}
