// New for PartnerStandard Desk (spec 5.1, 6): what the Business case area and the Business cases page show of a case.
// Pure: no React, no I/O.
import { simulateCase, simulateOurCase, type BusinessCase, type Currency, type IsoDateTime, type PartnerBook } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type PartnerType, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { formatMoney } from '@/programs/format';
import { partnerHref } from '@/partner/partner-model';

/** The two numbers of a case over its five years, and the stage its partner type had when it was made. */
export interface CaseNumbers {
  stageWhenMade: Stage;
  /** What the partner earns from us. */
  earnings: number;
  /** Our net value after our costs, with this partner. */
  net: number;
  currency: Currency;
}

/** One row of a partner type's Business case area. `numbers` is null when the case's file couldn't be read. */
export interface CaseAreaRow {
  caseId: string;
  title: string;
  createdAt: IsoDateTime;
  numbers: CaseNumbers | null;
}

/** A finite number, with no negative zero (Review Focus 5): anything else reads as 0. */
const plain = (n: number): number => (Number.isFinite(n) ? n + 0 || 0 : 0);

/**
 * A case's two numbers, as its tabs work them out (`simulateCase`, `simulateOurCase`). Null when its partner type isn't
 * in its own offer: such a case can't be worked out, and its row shows no numbers.
 */
export function caseNumbers(c: BusinessCase): CaseNumbers | null {
  if (!c.offer.types.some((t) => t.id === c.typeId)) return null;
  const partner = simulateCase(c);
  const ours = simulateOurCase(c, partner);
  return { stageWhenMade: c.stageWhenMade, earnings: plain(partner.earnings), net: plain(ours.withPartner.total), currency: c.offer.currency };
}

/** An amount as a whole number with its sign, never "-€0". */
export const caseMoney = (n: number, currency: Currency): string => formatMoney(Math.round(plain(n)) || 0, currency);

/** A case's card on the Business cases page, built from the directory and one read of Partners (no case file). */
export interface CaseCardRow {
  caseId: string;
  title: string;
  createdAt: IsoDateTime;
  partnerType: PartnerType;
  /** "Acme as reseller"; the partner type's label when its row is gone from Partners. */
  heading: string;
  /** The partner, when its partner type is still in Partners. */
  partner: { company: string; href: string } | null;
  /** Partners was read and the partner type isn't in it (or is another type there now). Not when Partners couldn't be read. */
  typeGone: boolean;
}

export interface ListedCase {
  caseId: string;
  title: string;
  partnerId: string;
  partnerType: PartnerType;
  createdAt: IsoDateTime;
}

/**
 * The cards, in the directory's order (newest first). A partner type that is gone from Partners, or is another type
 * now (a hand edit), or a Partners file that couldn't be read (`book` null), shows by the directory's partner type and
 * title (Review Focus 2). Only the first two are `typeGone`: an unreadable file says nothing about the type.
 */
export function caseCards(listed: readonly ListedCase[], book: PartnerBook | null): CaseCardRow[] {
  return listed.map((c) => {
    const row = book?.partners.find((p) => p.id === c.partnerId && p.partnerType === c.partnerType);
    const account = row ? book?.accounts.find((a) => a.id === row.accountId) : undefined;
    const label = PARTNER_TYPE_LABELS[c.partnerType];
    const company = account?.company.trim() ?? '';
    return {
      caseId: c.caseId, title: c.title, createdAt: c.createdAt, partnerType: c.partnerType,
      heading: account && company ? COPY.PARTNER_AS_TYPE(company, label) : label,
      partner: account && company ? { company, href: partnerHref(account.id, c.partnerType) } : null,
      typeGone: book !== null && !row,
    };
  });
}

/** Where a case opens: its offer tab. */
export const casePath = (caseId: string): string => `/business-cases/${encodeURIComponent(caseId)}/offer`;
