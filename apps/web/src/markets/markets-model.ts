// What the Markets screens work out, pure: the counts on a card, the step in the address, and the first partners as a
// batch of changes. The counts come from the Partner book, so no market file is read for a card.
import {
  importChanges, MAX_FIRST_CANDIDATES, newMarket, previewImport, sameCompany, viewOf,
  type IsoDate, type Market, type PartnerBook, type PartnerChange,
} from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type RecruitmentPartnerType, type RecruitmentStep } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { rowNote } from '@/market/import-model';

export { MAX_FIRST_CANDIDATES };

/** What a card shows: partners per Recruitment step, the signed ones, and those closed (turned down or exited). */
export interface MarketCounts {
  steps: Record<RecruitmentStep, number>;
  signed: number;
  closed: number;
}

/**
 * Counts the partners linked to one market, each once. A closed or exited partner is counted in `closed` and in no
 * stage column; a signed partner (any stage after Recruitment) is in `signed`.
 */
export function countsFor(book: PartnerBook, marketId: string): MarketCounts {
  const counts: MarketCounts = { steps: { researched: 0, discovery_call: 0, qualification: 0, map: 0 }, signed: 0, closed: 0 };
  const linked = new Set(book.marketLinks.filter((l) => l.marketId === marketId).map((l) => l.partnerId));
  for (const partner of book.partners) {
    if (!linked.has(partner.id)) continue;
    switch (viewOf(partner)) {
      case 'closed':
        counts.closed++;
        break;
      case 'active':
        counts.signed++;
        break;
      case 'potential':
        counts.steps[partner.step ?? 'researched']++;
        break;
    }
  }
  return counts;
}

/** The step in the address (`?step=1..4`) as an index from 0, or null when it is missing or not a step. */
export function stepFromAddress(value: string | null | undefined, steps: number): number | null {
  if (!value || !/^[1-9]\d?$/.test(value)) return null;
  const n = Number(value);
  return n <= steps ? n - 1 : null;
}

/** A first partner as typed in step 4. */
export interface FirstPartner { id: string; company: string; website: string }

/**
 * The note the import would show for this company, against the book and the partner type chosen for the new market.
 * The market does not exist yet, so nobody is "already in this market". Null for a new company.
 */
export function firstPartnerNote(
  book: PartnerBook, partnerType: RecruitmentPartnerType, entry: { company: string; website: string },
): string | null {
  const market = newMarket({ companyId: book.companyId, updatedBy: '', partnerType }, 'm_preview00');
  const { rows } = previewImport({
    book, market, table: { headers: ['Company', 'Website'], rows: [[entry.company, entry.website]] },
  });
  const row = rows[0];
  // The import leaves a signed partner of this type unticked, and so does this step: say that it won't be added.
  if (row && !row.problem && row.duplicate?.kind === 'existing' && row.duplicate.signed) {
    return COPY.FIRST_PARTNER_ALREADY_SIGNED(PARTNER_TYPE_LABELS[partnerType]);
  }
  const note = row ? rowNote(row, partnerType) : null;
  return note && !note.problem ? note.text : null;
}

/** Why a first partner can't be added to the list, in words; null when it can. The same check as a hand add: by company and website. */
export function listRefusal(list: readonly FirstPartner[], entry: { company: string; website: string }): 'full' | 'again' | null {
  if (list.length >= MAX_FIRST_CANDIDATES) return 'full';
  return list.some((p) => sameCompany(p, entry)) ? 'again' : null;
}

/**
 * The changes that put the first partners into the market just made, and how many could not go in. Core's import check
 * decides: a company already in this market (same type), or on the market's exclusions, is not added; a company the
 * book knows of the same type gets a link only. They are first-hand names, so the source is Research, not AI search.
 */
export function firstPartnerChanges(
  book: PartnerBook, market: Market, partners: ReadonlyArray<{ company: string; website: string }>, date: IsoDate,
): { changes: PartnerChange[]; notAdded: number } {
  const { rows } = previewImport({
    book, market, table: { headers: ['Company', 'Website'], rows: partners.map((p) => [p.company, p.website]) },
  });
  const source = { marketId: market.info.marketId, hypothesisId: null, hypothesisName: '', date };
  const changes = importChanges(rows, source, market).map((change): PartnerChange =>
    (change.kind === 'add' && change.entity === 'partner'
      ? { ...change, values: { ...change.values, source: 'research', sourceDetail: '' } }
      : change));
  const wanted = rows.filter((r) => r.selected && !r.problem && r.duplicate?.kind !== 'linked').length;
  return { changes, notAdded: partners.length - wanted };
}
