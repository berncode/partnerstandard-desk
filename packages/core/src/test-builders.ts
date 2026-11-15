import type { ChangeStamp } from './shared/stamp';
import type { Change, Exclusion, Hypothesis, Market, MarketInfo, ValuePoint } from './markets/types';
import type { AccountFields, Call, MarketLink, Partner, PartnerAccount, PartnerBook, Person, Qualification } from './partners/types';
import type { ProposalItem } from './proposals/types';

export const NOW = '2026-10-28T10:00:00.000Z';
export const EARLIER = '2026-10-01T09:00:00.000Z';
export const NONE = { customerBase: null, credibility: null, capability: null, commitment: null };

export function anAccount(over: Partial<PartnerAccount> = {}): PartnerAccount {
  return {
    id: 'a_abc123', company: 'Acme GmbH', website: 'https://acme.example', country: 'Austria', vertical: 'Managed IT',
    subVertical: '', targetCustomerType: 'smb', comments: '', updatedAt: EARLIER, updatedBy: 'Someone', ...over,
  };
}

/**
 * A section of the account `anAccount()` makes, unless `accountId` says otherwise.
 * Older tests passed company facts on the section. Those facts are accepted and dropped: they live on the account.
 */
const ACCOUNT_FACT_KEYS = new Set<string>(['company', 'website', 'country', 'vertical', 'subVertical', 'targetCustomerType', 'comments']);

export function partner(over: Partial<Partner> & Partial<AccountFields> = {}): Partner {
  const section: Partial<Partner> = {};
  for (const [key, value] of Object.entries(over)) {
    if (!ACCOUNT_FACT_KEYS.has(key)) Object.assign(section, { [key]: value });
  }
  return aPartner(section);
}

/** A section of the account `anAccount()` makes, unless `accountId` says otherwise. */
export function aPartner(over: Partial<Partner> = {}): Partner {
  return {
    id: 'p_abc123', companyId: 'co_abcdefghij', accountId: 'a_abc123', partnerType: 'reseller', stage: 'recruitment',
    step: 'researched', closed: null, closedReason: '', signedDate: null, exitedDate: null, exitReason: '',
    source: 'research', sourceDetail: '', whyItFits: '', desk: { ...NONE, credibility: 1, capability: 3 }, confirmed: NONE,
    mapFilled: false, mapLink: '', programId: null, level: null, mapHealth: null, mapNextMilestone: null, updatedAt: EARLIER, updatedBy: 'Someone', ...over,
  };
}

export function person(over: Partial<Person> = {}): Person {
  return {
    id: 'e_abc123', accountId: 'a_abc123', name: 'Eva Roth', title: 'Head of Alliances', email: null, role: 'seller',
    activeSeller: true, updatedAt: EARLIER, updatedBy: 'Someone', ...over,
  };
}

export function call(over: Partial<Call> = {}): Call {
  return {
    id: 'k_abc123', partnerId: 'p_abc123', date: '2026-10-10', kind: 'discovery',
    topics: { revenueModel: '', costDrivers: '', differentiators: '', strategicBets: '', customerPains: '', partnershipExperience: '' },
    notes: '', updatedAt: EARLIER, updatedBy: 'Someone', ...over,
  };
}

export function qualification(over: Partial<Qualification> = {}): Qualification {
  const notes = { customerBase: '', credibility: '', capability: '', commitment: '' };
  const letter = { answer: null, note: '' };
  return {
    id: 'q_abc123', partnerId: 'p_abc123', deskNotes: notes, confirmedNotes: notes, q1Overlap: '', q2DealFit: '', q4MapAgreed: '',
    caso: { culture: letter, additionalValue: letter, sponsorship: letter, alignedObjectives: letter },
    updatedAt: EARLIER, updatedBy: 'Someone', ...over,
  };
}

export function marketLink(over: Partial<MarketLink> = {}): MarketLink {
  return {
    id: 'l_abc123', partnerId: 'p_abc123', marketId: 'm_abcdefghij', hypothesisId: null, updatedAt: EARLIER, updatedBy: 'Someone', ...over,
  };
}

/** A waiting desk Credibility proposal for `aPartner()`, made by Claude for Ruth. */
export function proposalItem(over: Partial<ProposalItem> = {}): ProposalItem {
  return {
    id: 'r_abc123', proposalId: 'prp_abc123', kind: 'fourC', accountId: 'a_abc123', partnerId: 'p_abc123', marketId: null, hypothesisId: null,
    about: 'Acme GmbH', what: 'desk.credibility', proposed: '3', details: '', evidence: 'Ten customers named on their site',
    proposedBy: 'Claude for Ruth', status: 'waiting', answerNote: '', proposedOn: EARLIER, answeredOn: null,
    expiresOn: '2026-10-31T09:00:00.000Z', targetUpdated: EARLIER, updatedAt: EARLIER, updatedBy: 'Claude for Ruth', ...over,
  };
}

export function sampleBook(over: Partial<PartnerBook> = {}): PartnerBook {
  return {
    companyId: 'co_abcdefghij', accounts: [anAccount()], partners: [aPartner()], people: [person()], calls: [call()],
    qualifications: [qualification()], marketLinks: [marketLink()], proposalItems: [], ...over,
  };
}

export function stamp(over: Partial<ChangeStamp> = {}): ChangeStamp {
  return { now: NOW, actor: 'Ruth', newId: (kind) => `${kind}_new`, ...over };
}

export function marketInfo(over: Partial<MarketInfo> = {}): MarketInfo {
  return {
    marketId: 'm_abcdefghij', companyId: 'co_abcdefghij', marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Halden Endpoint',
    ourTargetCustomers: 'Companies with 20-500 staff', whyPartnerRoute: 'Buyers trust local IT firms.',
    mustHaves: ['Sells into companies with 20-500 staff'], howMarketBuys: 'customer_first', howMarketBuysNote: '',
    statement: 'In Austria, IT service companies will resell it.', expectedCandidates: 12, status: 'partly_validated',
    statusNote: 'Two calls back it up', copiedFrom: 'Germany · Reseller', feedsProgramId: null, checkAgain: ['mustHaves', 'statement'],
    updatedAt: '2026-10-20T09:00:00.000Z', updatedBy: 'Someone', ...over,
  };
}

/** A small market with every row kind: two value points, one hypothesis using both, one exclusion, one change. */
export function sampleMarket(over: Partial<Market> = {}): Market {
  const valuePoints: ValuePoint[] = [
    { id: 'v_1', kind: 'margin_or_fees', text: '20% margin on licenses', state: 'confirmed', evidence: 'Call, 2026-10-15', checkAgain: false, updatedAt: '2026-10-15T12:00:00.000Z', updatedBy: 'Someone' },
    { id: 'v_2', kind: 'services_revenue', text: 'Setup days', state: 'assumption', evidence: '', checkAgain: true, updatedAt: null, updatedBy: 'Someone' },
  ];
  const hypotheses: Hypothesis[] = [{
    id: 'h_1', name: 'Mid-size IT firms', theirSide: 'They lose deals without it.', theirEvidence: 'Acme call', ourSide: 'They reach buyers we cannot.',
    ourEvidence: '', valuePointIds: ['v_1', 'v_2'], lookalike: 'IT firms with 10-50 staff', status: 'holds', checkAgain: true,
    updatedAt: '2026-10-16T08:30:00.000Z', updatedBy: 'Someone',
  }];
  const exclusions: Exclusion[] = [{ id: 'x_1', company: 'Omega GmbH', website: 'https://omega.example', reason: 'Existing partner', updatedAt: null, updatedBy: 'Someone' }];
  const changes: Change[] = [{ id: 'g_1', date: '2026-10-16', entity: 'hypothesis', entityId: 'h_1', what: 'Now holds', callId: 'k_abc123', updatedAt: '2026-10-16T09:00:00.000Z', updatedBy: 'Someone' }];
  return { info: marketInfo(), valuePoints, hypotheses, exclusions, changes, ...over };
}

/** Program Designer's example companies (facts, name and programs), for tests in other packages. */
export { brightpage, northwind, type ExampleCompany } from './programs/examples';

/** The MAP builders (packages/core/src/maps/test-builders.ts), with the MAP app's own today and now. */
export {
  makeActivity, makeExitTrigger, makeMapPlan, makeMilestone, makeObjective, makePerson, makePlan, makeRecord, makeReview, makeReviewItem,
  makeReviewNumber,
  NOW as MAP_NOW, TODAY as MAP_TODAY,
} from './maps/test-builders';
