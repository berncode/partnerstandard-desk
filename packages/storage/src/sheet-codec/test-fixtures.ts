// Test support for the codec tests. Not production code.
import type { PartnerBook } from '@partner-desk/core';
import { anAccount, aPartner, call, marketLink, person, proposalItem, qualification, sampleBook } from '@partner-desk/core/test-builders';
import type { Workbook } from './grid';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from './layouts';
import { MAP_LAYOUT } from './map-layout';

export const PARTNERS_META = { appUrl: 'https://desk.test/partners' };
export const MARKET_META = { appUrl: 'https://desk.test/markets/m_abcdefghij' };

const TOPICS_EMPTY = { revenueModel: '', costDrivers: '', differentiators: '', strategicBets: '', customerPains: '', partnershipExperience: '' };
const NOTES_EMPTY = { customerBase: '', credibility: '', capability: '', commitment: '' };
const LETTER_EMPTY = { answer: null, note: '' };

/**
 * Three companies and four partners (one open, one signed, one closed, one exited): Acme is both a reseller (p_1) and a
 * managed service provider (p_3, closed). The signed one (p_2) is in a program at Preferred, and its MAP is at risk. One
 * row of each other kind.
 */
export function richBook(): PartnerBook {
  return sampleBook({
    accounts: [
      anAccount({ id: 'a_1', comments: 'Met at a fair' }),
      anAccount({
        id: 'a_2', company: 'Beta AG', website: 'beta.at', country: 'Germany', vertical: 'Managed IT', targetCustomerType: 'enterprise',
        updatedAt: '2026-10-19T16:00:00.000Z',
      }),
      anAccount({ id: 'a_4', company: 'Delta Ltd', website: '', country: '', vertical: '', updatedBy: 'Claude for Ruth' }),
    ],
    partners: [
      aPartner({ id: 'p_1', accountId: 'a_1', desk: { customerBase: 3, credibility: 1, capability: 3, commitment: null } }),
      aPartner({
        id: 'p_2', accountId: 'a_2', partnerType: 'var', stage: 'growth', step: null, signedDate: '2026-10-19', programId: 'pg_dach0001', level: 'pref',
        mapHealth: 'at_risk', mapNextMilestone: '2026-11-20',
        desk: { customerBase: 2, credibility: 2, capability: 3, commitment: 2 }, confirmed: { customerBase: 2, credibility: 3, capability: 3, commitment: 2 },
        mapFilled: true, mapLink: 'https://map.partnerstandard.com/p/abc', updatedAt: '2026-10-19T16:00:00.000Z',
      }),
      aPartner({
        id: 'p_3', accountId: 'a_1', partnerType: 'managed', step: 'discovery_call', closed: 'no', closedReason: 'Too small',
        desk: { customerBase: null, credibility: null, capability: null, commitment: null },
      }),
      aPartner({
        id: 'p_4', accountId: 'a_4', stage: 'exit', step: null, signedDate: '2026-01-10', exitedDate: '2026-09-30',
        exitReason: 'Stopped selling', source: 'existing_partner', sourceDetail: 'Omega', updatedBy: 'Claude for Ruth',
      }),
    ],
    people: [person({ id: 'e_1', accountId: 'a_1', email: 'eva@acme.example' }), person({ id: 'e_2', accountId: 'a_2', name: 'Max Berg', role: 'sponsor', activeSeller: false })],
    calls: [call({ id: 'k_1', partnerId: 'p_1', topics: { ...TOPICS_EMPTY, revenueModel: 'Licenses', customerPains: 'Slow invoices' }, notes: 'Good call' })],
    qualifications: [qualification({
      id: 'q_1', partnerId: 'p_1', deskNotes: { ...NOTES_EMPTY, credibility: 'Known locally' }, q1Overlap: 'About a third',
      caso: { culture: { answer: 'yes', note: 'Same pace' }, additionalValue: LETTER_EMPTY, sponsorship: { answer: 'partly', note: '' }, alignedObjectives: LETTER_EMPTY },
    })],
    marketLinks: [marketLink({ id: 'l_1', partnerId: 'p_1', hypothesisId: 'h_1' }), marketLink({ id: 'l_2', partnerId: 'p_2' })],
  });
}

/**
 * `richBook()` with three Proposals rows: a waiting desk score for Acme, a new partner for the market (with its import
 * columns, one per line) that was rejected, and a market status that expired.
 */
export function bookWithProposals(): PartnerBook {
  return {
    ...richBook(),
    proposalItems: [
      proposalItem({ id: 'r_1', accountId: 'a_1', partnerId: 'p_1', targetUpdated: '2026-10-01T09:00:00.000Z' }),
      proposalItem({
        id: 'r_2', proposalId: 'prp_2', kind: 'partners', accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: 'h_1',
        about: 'Zeta GmbH', what: 'company', proposed: 'Zeta GmbH', details: 'Website: zeta.example\nCountry: Austria', evidence: 'Sells to IT firms',
        status: 'rejected', answerNote: 'Too small', answeredOn: '2026-10-02T08:00:00.000Z', targetUpdated: null,
        updatedAt: '2026-10-02T08:00:00.000Z', updatedBy: 'Ruth',
      }),
      proposalItem({
        id: 'r_3', proposalId: 'prp_3', kind: 'marketStatus', accountId: null, partnerId: null, marketId: 'm_abcdefghij', about: 'Austria',
        what: 'marketStatus', proposed: 'Validated', evidence: 'Three calls back it up', status: 'expired',
        targetUpdated: '2026-09-20T09:00:00.000Z',
      }),
    ],
  };
}

const setVersion = (wb: Workbook, version: number) => {
  const row = wb['_meta']!.find((r) => r[0] === 'schemaVersion')!;
  row[1] = version;
};

/**
 * `wb` without the Partners tab columns under `headers` and without the Proposals tab (version 5), at format version
 * `version`.
 */
function withoutPartnerColumns(wb: Workbook, headers: string[], version: number): Workbook {
  const out = structuredClone(wb);
  const tab = PARTNERS_LAYOUT.tabs.partner;
  const header = out[tab]![0]!;
  const dropped = new Set(headers.map((h) => header.indexOf(h)));
  out[tab] = out[tab]!.map((row) => row.filter((_, i) => !dropped.has(i)));
  delete out[PARTNERS_LAYOUT.tabs.proposalItem];
  setVersion(out, version);
  return out;
}

/**
 * `wb` (a Partners file as this app writes it) as a format version 2 file held it: the Partners tab without the
 * Program and Level columns, nor the MAP ones, and no Proposals tab.
 */
export const asPartnersVersion2 = (wb: Workbook): Workbook => withoutPartnerColumns(wb, ['Program', 'Level', 'MAP health', 'Next milestone'], 2);

/** `wb` as a format version 3 file held it: the Partners tab without the MAP health and Next milestone columns, no Proposals tab. */
export const asPartnersVersion3 = (wb: Workbook): Workbook => withoutPartnerColumns(wb, ['MAP health', 'Next milestone'], 3);

/** `wb` as a format version 4 file held it: no Proposals tab. */
export const asPartnersVersion4 = (wb: Workbook): Workbook => withoutPartnerColumns(wb, [], 4);

/** `wb` (a market file as this app writes it) as a format version 1 file held it: no "Feeds program" row. */
export function asMarketVersion1(wb: Workbook): Workbook {
  const out = structuredClone(wb);
  const tab = MARKET_LAYOUT.tabs.info;
  out[tab] = out[tab]!.filter((row) => row[0] !== 'Feeds program');
  setVersion(out, 1);
  return out;
}

/**
 * `wb` (a MAP file as this app writes it) as format version 2, the staging build of plan 9, wrote it: the Reviews tab
 * without "Sent to", and the Review items tab with "About ID", "Owner ID" and "Milestone ID", the owner and milestone
 * written as the ids of their rows on the People and Milestones tabs.
 */
export function asMapVersion2(wb: Workbook): Workbook {
  const out = structuredClone(wb);
  const T = MAP_LAYOUT.tabs;
  const sentTo = out[T.review]![0]!.indexOf('Sent to');
  out[T.review] = out[T.review]!.map((row) => row.filter((_, i) => i !== sentTo));
  const idOf = (tab: string, nameHeader: string, name: unknown) => {
    const grid = out[tab]!;
    const col = grid[0]!.indexOf(nameHeader);
    return grid.find((row, i) => i > 0 && row[col] === name)?.[0] ?? name;
  };
  const items = out[T.reviewItem]!;
  const head = items[0]!;
  const [about, owner, milestone] = ['Activity or hypothesis ID', 'Owner', 'Milestone'].map((h) => head.indexOf(h)) as [number, number, number];
  head[about] = 'About ID';
  head[owner] = 'Owner ID';
  head[milestone] = 'Milestone ID';
  for (const row of items.slice(1)) {
    if (row[owner]) row[owner] = idOf(T.person, 'Name', row[owner]) as string;
    if (row[milestone]) row[milestone] = idOf(T.milestone, 'Milestone', row[milestone]) as string;
  }
  setVersion(out, 2);
  return out;
}
