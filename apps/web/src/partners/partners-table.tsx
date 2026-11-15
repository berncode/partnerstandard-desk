'use client';

import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { Partner, PartnerBook } from '@partner-desk/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HealthBadge, NotSignedBadge } from '@/maps/badges';
import { SavingName } from '@/ui/pieces';
import { partnerHref } from '@/partner/partner-model';
import type { ProgramOption } from '@/programs/title';
import { companyName, formatDate, mapHealthOf, marketNamesOf, programText, stageText, type MapsListed, type MarketOption } from './partners-model';

const cell = 'block min-w-0 break-words px-3 py-1 before:mr-1.5 before:text-xs before:text-ink-3 before:content-[attr(data-label)] md:table-cell md:px-3 md:py-2.5 md:align-top md:before:hidden';

/**
 * The list: a table from a tablet up, and on a phone each partner is a small card, so nothing scrolls sideways.
 * A row opens the partner (the company name is the link; a click anywhere on the row does the same), once its add is
 * saved, and its partner type too (`savedIdFor`).
 */
export function PartnersTable({ partners, book, markets, programs = [], programsListed = true, mapHealth = false, maps, savedIdFor }: {
  partners: readonly Partner[]; book: PartnerBook; markets: readonly MarketOption[]; programs?: readonly ProgramOption[];
  /** False when the list of programs couldn't be read: a partner's program is then its stored id. */
  programsListed?: boolean;
  /** Shows the MAP health column (spec 5.7): the health and the next milestone the partner record keeps. */
  mapHealth?: boolean;
  /** The partner types with a MAP in the directory: a MAP with no health is "Nothing planned yet", not "No MAP". */
  maps?: MapsListed;
  savedIdFor: (id: string) => string | null;
}) {
  const router = useRouter();
  // The Program column shows once the company has a program, or a partner is in one (a deleted one, say).
  const showProgram = programs.length > 0 || partners.some((p) => p.programId !== null);
  const columns = [COPY.COLUMN_COMPANY, COPY.COLUMN_PARTNER_TYPE, COPY.COLUMN_STAGE, COPY.COLUMN_MARKETS,
    ...(showProgram ? [COPY.COLUMN_PROGRAM] : []), ...(mapHealth ? [COPY.COLUMN_MAP_HEALTH] : []), COPY.COLUMN_UPDATED];
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <table className="block w-full text-sm md:table">
        <thead className="sr-only md:not-sr-only md:table-header-group">
          <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
            {columns.map((title) => (
              <th key={title} scope="col" className="px-3 py-2 font-medium">{title}</th>
            ))}
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {partners.map((p) => {
            const names = marketNamesOf(book, markets, p.id);
            const account = book.accounts.find((item) => item.id === p.accountId);
            // The page opens on this type, so both the company and the type must be saved.
            const id = savedIdFor(p.accountId);
            const href = id === null || savedIdFor(p.id) === null ? null : partnerHref(id, p.partnerType);
            const name = companyName(book, p);
            const program = programText(p, programs, programsListed);
            return (
              <tr key={p.id} data-testid="partner-row"
                className={`block border-b border-line py-2 last:border-b-0 md:table-row md:py-0 ${href ? 'cursor-pointer hover:bg-surface-2/60' : ''}`}
                onClick={(e) => { if (href && !(e.target as HTMLElement).closest('a')) router.push(href); }}>
                <td className={cell}>
                  {href
                    ? <Link href={href} className="font-semibold break-words outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">{name}</Link>
                    : <SavingName className="font-semibold">{name}</SavingName>}
                  {account?.website && <span className="block text-xs break-words text-ink-3">{account.website}</span>}
                </td>
                <td className={cell} data-label={COPY.COLUMN_PARTNER_TYPE}>{PARTNER_TYPE_LABELS[p.partnerType]}</td>
                <td className={cell} data-label={COPY.COLUMN_STAGE}>{stageText(p)}</td>
                <td className={cell} data-label={COPY.COLUMN_MARKETS}>
                  {names.length > 0 ? names.join(' and ') : <span className="text-ink-3">{COPY.NO_MARKET}</span>}
                </td>
                {showProgram && (
                  <td className={cell} data-label={COPY.COLUMN_PROGRAM}>
                    {program ? <span className={program === COPY.PROGRAM_GONE ? 'text-ink-3' : undefined}>{program}</span>
                      : <span className="text-ink-3">{COPY.NO_PROGRAM}</span>}
                  </td>
                )}
                {mapHealth && (
                  <td className={cell} data-label={COPY.COLUMN_MAP_HEALTH}>
                    <MapHealthCell partner={p} hasMap={maps?.has(p.id) ?? false} />
                  </td>
                )}
                <td className={`${cell} text-ink-3 md:whitespace-nowrap`} data-label={COPY.COLUMN_UPDATED}>{formatDate(p.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A partner type's MAP health, as its MAP says it everywhere (ruling R6), and the next milestone's date. */
function MapHealthCell({ partner, hasMap }: { partner: Partner; hasMap: boolean }) {
  const health = mapHealthOf(partner, hasMap);
  if (health === 'not_signed') return <NotSignedBadge className="py-0.5" />;
  if (health === 'none') return <span className="text-ink-3">{COPY.NO_MAP}</span>;
  return (
    <>
      <HealthBadge health={health} className="py-0.5" />
      {partner.mapNextMilestone && <span className="block text-xs text-ink-3 md:mt-1">{COPY.MAP_NEXT_ON(formatDate(partner.mapNextMilestone))}</span>}
    </>
  );
}
