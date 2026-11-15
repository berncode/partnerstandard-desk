// A copy never carries partners or market links.
import { PARTNER_TYPES, PARTNER_TYPE_LABELS, type PartnerType, type RecruitmentPartnerType } from '@partner-desk/method';
import { sameCompany } from '../website';
import type { MarketChange } from './changes';
import { MARKET_FIELD_NAMES } from './schemas';
import type { Exclusion, Market, MarketEntity, MarketInfo } from './types';

/** "Austria · Reseller": the name a market is listed under, and the `copiedFrom` of its copies. */
export function marketDisplayName(info: { marketName: string; partnerType: PartnerType }): string {
  return `${info.marketName} · ${PARTNER_TYPE_LABELS[info.partnerType]}`;
}

/** The partner type a market is listed for, read from the end of its `marketDisplayName`; null when it names none. */
export function marketTypeOfDisplayName(displayName: string): PartnerType | null {
  const split = displayName.lastIndexOf(' · ');
  if (split === -1) return null;
  const label = displayName.slice(split + 3);
  return PARTNER_TYPES.find((type) => PARTNER_TYPE_LABELS[type] === label) ?? null;
}

/** An empty, open market with the id it is given; the fields `info` gives (undefined ones aside) override the defaults. */
export function newMarket(info: Partial<MarketInfo> & { companyId: string; updatedBy: string }, marketId: string): Market {
  const given = Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined));
  return {
    info: {
      companyId: info.companyId, updatedBy: info.updatedBy,
      marketName: '', partnerType: 'reseller', ourProduct: '', ourTargetCustomers: '', whyPartnerRoute: '', mustHaves: [],
      howMarketBuys: 'unknown', howMarketBuysNote: '', statement: '', expectedCandidates: null, status: 'open',
      statusNote: '', copiedFrom: null, feedsProgramId: null, checkAgain: [], updatedAt: null,
      ...given,
      marketId,
    },
    valuePoints: [], hypotheses: [], exclusions: [], changes: [],
  };
}

/**
 * A new market from `source` (spec 3.2): its Market fields, value points, partner hypotheses and Exclusions, with new
 * ids, every item flagged to check again. Status goes back to open with its note cleared, hypotheses to draft and
 * confirmed value points to assumption. Changes (the history) stay behind, and so do partners and market links: they
 * live in the Partner book and are never copied. Every copied row is stamped with `updatedBy`, the person who copies.
 */
export function copyMarket(
  source: Market,
  info: { marketName: string; partnerType: RecruitmentPartnerType; updatedBy: string },
  ids: (kind: MarketEntity) => string,
  marketId: string,
): Market {
  const { updatedBy, ...named } = info;
  const valuePointIds = new Map<string, string>();
  const valuePoints = source.valuePoints.map((v) => {
    const id = ids('valuePoint');
    valuePointIds.set(v.id, id);
    return { ...v, id, state: v.state === 'confirmed' ? ('assumption' as const) : v.state, checkAgain: true, updatedAt: null, updatedBy };
  });
  const hypotheses = source.hypotheses.map((h) => ({
    ...h,
    id: ids('hypothesis'),
    // A reference that was already dangling in the source stays as it was, and shows as needing attention.
    valuePointIds: h.valuePointIds.map((id) => valuePointIds.get(id) ?? id),
    status: 'draft' as const,
    checkAgain: true,
    updatedAt: null,
    updatedBy,
  }));
  const exclusions = source.exclusions.map((x) => ({ ...x, id: ids('exclusion'), updatedAt: null, updatedBy }));
  return {
    ...newMarket({
      ...source.info,
      ...named,
      mustHaves: [...source.info.mustHaves],
      status: 'open',
      statusNote: '',
      copiedFrom: marketDisplayName(source.info),
      // A copy may be of another partner type, and a market feeds only a program of its own type.
      feedsProgramId: null,
      checkAgain: [...MARKET_FIELD_NAMES],
      updatedAt: null,
      updatedBy,
    }, marketId),
    valuePoints, hypotheses, exclusions,
  };
}

/**
 * The changes that add `source`'s Exclusions to `target`, reasons included, skipping companies `target` already
 * excludes (sameCompany) and repeats within `source`. The new rows get their ids from the stamp when the changes are
 * applied (and a change may not carry an id), so `ids` goes unused.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the brief's signature; see above
export function mergeExclusions(target: Market, source: Market, ids: (kind: MarketEntity) => string): MarketChange[] {
  const seen: Pick<Exclusion, 'company' | 'website'>[] = [...target.exclusions];
  const changes: MarketChange[] = [];
  for (const { company, website, reason } of source.exclusions) {
    if (seen.some((x) => sameCompany(x, { company, website }))) continue;
    seen.push({ company, website });
    changes.push({ kind: 'add', entity: 'exclusion', values: { company, website, reason } });
  }
  return changes;
}
