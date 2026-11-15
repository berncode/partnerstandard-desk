'use client';

// The stage columns and the cards follow the Recruitment app's board.
import { confirmedRecommendation, deskRecommendation, type Partner, type PartnerBook, type Recommendation } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type View } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Chip, type ChipTone } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { SavingName } from '@/ui/pieces';
import { partnerHref } from '@/partner/partner-model';
import { columnsFor, companyName, marketNamesOf, type MarketOption } from './partners-model';

const RECOMMENDATION_TONE: Record<Recommendation['kind'], ChipTone> = { proceed: 'brand', call: 'info', not_now: 'warn', skip: 'danger', stop: 'danger' };

/** The board: one column per step (Potential) or per stage (Active). Columns sit side by side from a tablet up and stack on a phone. */
export function PartnersBoard({ view, partners, book, markets, savedIdFor }: {
  view: Exclude<View, 'closed'>; partners: readonly Partner[]; book: PartnerBook; markets: readonly MarketOption[];
  /** The id a link may use, or null while the add of the company or of its partner type is still being saved. */
  savedIdFor: (id: string) => string | null;
}) {
  const columns = columnsFor(partners, view);
  return (
    <div className="grid gap-3 md:grid-cols-[repeat(4,minmax(10.5rem,1fr))] md:overflow-x-auto md:pb-1">
      {columns.map(({ value, title, partners: inColumn }) => (
        <Column key={value} title={title} count={inColumn.length}>
          {inColumn.map((p) => {
            // The page opens on this type, so both the company and the type must be saved.
            const id = savedIdFor(p.accountId);
            const href = id === null || savedIdFor(p.id) === null ? null : partnerHref(id, p.partnerType);
            return <Card key={p.id} partner={p} name={companyName(book, p)} names={marketNamesOf(book, markets, p.id)} href={href} view={view} />;
          })}
        </Column>
      ))}
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('min-w-0 rounded-xl bg-surface-2/60 p-2', count === 0 && 'hidden md:block')}>
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2 id={id} className="text-xs font-semibold text-ink-2">{title}</h2>
        <span className="text-xs text-ink-3">{count}</span>
      </div>
      {count > 0 ? <ul className="grid gap-2">{children}</ul> : <p className="px-1 pb-1 text-xs text-ink-3">{COPY.BOARD_EMPTY_COLUMN}</p>}
    </section>
  );
}

/**
 * A partner on the board: company, type, markets and, in recruitment, the check's advice. The whole card opens the
 * partner, once its add is saved (`href` null until then).
 */
function Card({ partner: p, name, names, href, view }: { partner: Partner; name: string; names: string[]; href: string | null; view: View }) {
  const recommendation = view === 'potential' ? (confirmedRecommendation(p.confirmed) ?? deskRecommendation(p.desk)) : null;
  return (
    <li data-testid="partner-card" className="relative min-w-0 rounded-xl border border-line bg-surface p-3 focus-within:ring-2 focus-within:ring-brand hover:border-ink-3">
      {href
        ? <Link href={href} className="block text-sm font-semibold break-words outline-none after:absolute after:inset-0 after:rounded-xl">{name}</Link>
        : <SavingName className="text-sm font-semibold">{name}</SavingName>}
      <p className="mt-0.5 text-xs break-words text-ink-3">{PARTNER_TYPE_LABELS[p.partnerType]}</p>
      {recommendation && <div className="mt-2"><Chip tone={RECOMMENDATION_TONE[recommendation.kind]}>{recommendation.text}</Chip></div>}
      <p className="mt-2 text-xs break-words text-ink-3">{names.length > 0 ? names.join(' and ') : COPY.NO_MARKET}</p>
    </li>
  );
}
