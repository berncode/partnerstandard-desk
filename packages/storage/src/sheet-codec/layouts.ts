// The two workbooks' layouts. The Recruitment app's tabs and columns, split over the Partners workbook and the market workbook.
import type { MarketEntity, PartnerEntity } from '@partner-desk/core';
import { CASO_HELP, CASO_LETTERS, TOPICS, TOPIC_TITLES } from '@partner-desk/method';
import { SHEET_COPY } from '@partner-desk/copy';
import {
  checkAgainColumn, fourCColumns, idColumn, stampColumns, type ColumnDef, type InfoFieldDef,
} from './columns';

const H = SHEET_COPY.HEADERS;
const PH = SHEET_COPY.PROPOSALS.HEADERS;
const TABS = SHEET_COPY.TABS;
const META_TAB = '_meta';

export interface WorkbookLayout<E extends string> {
  /** Tab names: one per entity, plus the Start here and `_meta` tabs. */
  tabs: Record<E | 'start' | 'meta', string>;
  /** Every tab, in file order. */
  tabOrder: string[];
  /** The entity tabs, in file order. */
  entityOrder: E[];
  /** Per entity tab, its columns in the order a new file has them. The ID column is first. */
  columns: Record<E, ColumnDef[]>;
  /** The `_meta` key that holds the file's own id. */
  idKey: 'companyId' | 'marketId';
}

export interface MarketWorkbookLayout extends WorkbookLayout<MarketEntity> {
  tabs: Record<MarketEntity | 'start' | 'meta' | 'info', string>;
  /** The Market tab's header row, and its columns (0-based): field label, value, "Check again" (yes or blank). */
  infoHeader: readonly string[];
  infoColumns: { label: 0; value: 1; checkAgain: 2 };
  /** One row per field, found by its label. */
  infoFields: InfoFieldDef[];
}

const partnerRef: ColumnDef = { key: 'partnerId', header: H.partner, kind: 'ref' };
/** The company a Partners or People row belongs to: an ID on the Accounts tab. */
export const accountRef: ColumnDef = { key: 'accountId', header: H.partnerAccount, kind: 'ref' };

const PARTNER_COLUMNS: Record<PartnerEntity, ColumnDef[]> = {
  account: [
    idColumn,
    { key: 'company', header: H.company, kind: 'text' },
    { key: 'website', header: H.website, kind: 'text' },
    { key: 'country', header: H.country, kind: 'text' },
    { key: 'vertical', header: H.vertical, kind: 'text' },
    { key: 'subVertical', header: H.subVertical, kind: 'text' },
    { key: 'targetCustomerType', header: H.targetCustomerType, kind: 'enum', enumName: 'targetCustomerType' },
    { key: 'comments', header: H.comments, kind: 'text' },
    ...stampColumns,
  ],
  // One row per partner type of a company: its company is `accountRef`.
  partner: [
    idColumn,
    accountRef,
    { key: 'partnerType', header: H.partnerType, kind: 'enum', enumName: 'partnerType' },
    { key: 'stage', header: H.stage, kind: 'enum', enumName: 'stage' },
    { key: 'step', header: H.step, kind: 'enum', enumName: 'step' },
    { key: 'closed', header: H.closed, kind: 'enum', enumName: 'closed', leavesRowOut: true },
    { key: 'closedReason', header: H.closedReason, kind: 'text' },
    { key: 'source', header: H.source, kind: 'enum', enumName: 'source' },
    { key: 'sourceDetail', header: H.sourceDetail, kind: 'text' },
    { key: 'whyItFits', header: H.whyItFits, kind: 'text' },
    ...fourCColumns(H.desk, 'desk', 'score'),
    ...fourCColumns(H.confirmed, 'confirmed', 'score'),
    { key: 'mapFilled', header: H.mapFilled, kind: 'bool' },
    { key: 'mapLink', header: H.mapLink, kind: 'text' },
    { key: 'signedDate', header: H.signedDate, kind: 'date' },
    // An unreadable Exited date is not "still active": the row is left out, as for Closed.
    { key: 'exitedDate', header: H.exitedDate, kind: 'date', leavesRowOut: true },
    { key: 'exitReason', header: H.exitReason, kind: 'text' },
    // Version 3. An upgraded file has them after its last column (version.ts), a new file here.
    { key: 'programId', header: H.program, kind: 'ref' },
    // An unreadable Level is not "no level": the row is left out, as for Closed.
    { key: 'level', header: H.level, kind: 'enum', enumName: 'level', leavesRowOut: true },
    // Version 4: a copy of what the partner type's MAP computes (spec 5.7). An unreadable value is held empty, the row
    // kept: the next MAP refresh writes over it.
    { key: 'mapHealth', header: H.mapHealth, kind: 'enum', enumName: 'mapHealth' },
    { key: 'mapNextMilestone', header: H.mapNextMilestone, kind: 'date' },
    ...stampColumns,
  ],
  marketLink: [
    idColumn,
    partnerRef,
    { key: 'marketId', header: H.market, kind: 'ref' },
    { key: 'hypothesisId', header: H.hypothesis, kind: 'ref' },
    ...stampColumns,
  ],
  person: [
    idColumn,
    accountRef,
    { key: 'name', header: H.name, kind: 'text' },
    { key: 'title', header: H.title, kind: 'text' },
    { key: 'email', header: H.email, kind: 'email' },
    { key: 'role', header: H.role, kind: 'enum', enumName: 'personRole' },
    { key: 'activeSeller', header: H.activeSeller, kind: 'bool' },
    ...stampColumns,
  ],
  call: [
    idColumn,
    partnerRef,
    { key: 'date', header: H.date, kind: 'date' },
    { key: 'kind', header: H.kind, kind: 'enum', enumName: 'callKind' },
    ...TOPICS.map((t): ColumnDef => ({ key: `topics.${t}`, header: TOPIC_TITLES[t], kind: 'text' })),
    { key: 'notes', header: H.notes, kind: 'text' },
    ...stampColumns,
  ],
  qualification: [
    idColumn,
    partnerRef,
    ...fourCColumns(H.deskNote, 'deskNotes', 'text'),
    ...fourCColumns(H.confirmedNote, 'confirmedNotes', 'text'),
    { key: 'q1Overlap', header: H.q1Overlap, kind: 'text' },
    { key: 'q2DealFit', header: H.q2DealFit, kind: 'text' },
    { key: 'q4MapAgreed', header: H.q4MapAgreed, kind: 'text' },
    ...CASO_LETTERS.flatMap((l): ColumnDef[] => [
      { key: `caso.${l}.answer`, header: H.caso(CASO_HELP[l].label), kind: 'enum', enumName: 'casoAnswer' },
      { key: `caso.${l}.note`, header: H.casoNote(CASO_HELP[l].label), kind: 'text' },
    ]),
    ...stampColumns,
  ],
  // Version 5: one row per item of an agent's proposal (spec 7.1). The target by its ids, in the Market links tab's words.
  proposalItem: [
    idColumn,
    { key: 'proposalId', header: PH.proposalId, kind: 'ref' },
    { key: 'kind', header: H.kind, kind: 'enum', enumName: 'proposalKind' },
    accountRef,
    partnerRef,
    { key: 'marketId', header: H.market, kind: 'ref' },
    { key: 'hypothesisId', header: H.hypothesis, kind: 'ref' },
    { key: 'about', header: H.about, kind: 'text' },
    { key: 'what', header: PH.what, kind: 'enum', enumName: 'proposalField' },
    { key: 'proposed', header: PH.proposed, kind: 'text' },
    { key: 'details', header: PH.details, kind: 'text' },
    { key: 'evidence', header: PH.evidence, kind: 'text' },
    { key: 'proposedBy', header: PH.proposedBy, kind: 'text' },
    { key: 'status', header: H.status, kind: 'enum', enumName: 'proposalStatus' },
    { key: 'answerNote', header: PH.answerNote, kind: 'text' },
    { key: 'proposedOn', header: PH.proposedOn, kind: 'datetime' },
    { key: 'answeredOn', header: PH.answeredOn, kind: 'datetime' },
    { key: 'expiresOn', header: PH.expiresOn, kind: 'datetime' },
    { key: 'targetUpdated', header: PH.targetUpdated, kind: 'datetime' },
    ...stampColumns,
  ],
};

/**
 * The Partners workbook (format version 5), one per company using the app. `Accounts` holds one row per partner company,
 * `Partners` one row per partner type of a company, `People` the companies' contacts. A partner's company id (the
 * user's own company) is not a column: it is the book's, from `_meta`. `Market links` holds which markets each partner
 * is in. Accounts come first, so a Partners row's company is known when the row is read. `Proposals` (version 5) holds
 * what agents proposed and the answers; only the proposals commands write it.
 */
export const PARTNERS_LAYOUT: WorkbookLayout<PartnerEntity> = {
  tabs: {
    start: TABS.start, account: TABS.accounts, partner: TABS.partners, marketLink: TABS.marketLinks, person: TABS.people,
    call: TABS.calls, qualification: TABS.qualification, proposalItem: TABS.proposals, meta: META_TAB,
  },
  tabOrder: [TABS.start, TABS.accounts, TABS.partners, TABS.marketLinks, TABS.people, TABS.calls, TABS.qualification, TABS.proposals, META_TAB],
  entityOrder: ['account', 'partner', 'marketLink', 'person', 'call', 'qualification', 'proposalItem'],
  columns: PARTNER_COLUMNS,
  idKey: 'companyId',
};

const MARKET_COLUMNS: Record<MarketEntity, ColumnDef[]> = {
  valuePoint: [
    idColumn,
    { key: 'kind', header: H.kind, kind: 'enum', enumName: 'valueKind' },
    { key: 'text', header: H.valuePoint, kind: 'text' },
    { key: 'state', header: H.state, kind: 'enum', enumName: 'valueState' },
    { key: 'evidence', header: H.evidence, kind: 'text' },
    checkAgainColumn,
    ...stampColumns,
  ],
  hypothesis: [
    idColumn,
    { key: 'name', header: H.name, kind: 'text' },
    { key: 'theirSide', header: H.theirSide, kind: 'text' },
    { key: 'theirEvidence', header: H.theirEvidence, kind: 'text' },
    { key: 'ourSide', header: H.ourSide, kind: 'text' },
    { key: 'ourEvidence', header: H.ourEvidence, kind: 'text' },
    { key: 'valuePointIds', header: H.valuePoints, kind: 'refList' },
    { key: 'lookalike', header: H.lookalike, kind: 'text' },
    { key: 'status', header: H.status, kind: 'enum', enumName: 'hypothesisStatus' },
    checkAgainColumn,
    ...stampColumns,
  ],
  exclusion: [
    idColumn,
    { key: 'company', header: H.company, kind: 'text' },
    { key: 'website', header: H.website, kind: 'text' },
    { key: 'reason', header: H.reason, kind: 'text' },
    ...stampColumns,
  ],
  change: [
    idColumn,
    { key: 'date', header: H.date, kind: 'date' },
    { key: 'entity', header: H.about, kind: 'enum', enumName: 'changeEntity' },
    { key: 'entityId', header: H.aboutId, kind: 'text' },
    { key: 'what', header: H.what, kind: 'text' },
    { key: 'callId', header: H.call, kind: 'ref' },
    ...stampColumns,
  ],
};

const F = SHEET_COPY.INFO_FIELDS;

/** The market workbook (format version 2), one per market. The Market tab holds the market's details, one field per row. */
export const MARKET_LAYOUT: MarketWorkbookLayout = {
  tabs: {
    start: TABS.start, info: TABS.market, valuePoint: TABS.valuePoints, hypothesis: TABS.hypotheses, exclusion: TABS.exclusions,
    change: TABS.changes, meta: META_TAB,
  },
  tabOrder: [TABS.start, TABS.market, TABS.valuePoints, TABS.hypotheses, TABS.exclusions, TABS.changes, META_TAB],
  entityOrder: ['valuePoint', 'hypothesis', 'exclusion', 'change'],
  columns: MARKET_COLUMNS,
  idKey: 'marketId',
  infoHeader: SHEET_COPY.INFO_HEADER,
  infoColumns: { label: 0, value: 1, checkAgain: 2 },
  infoFields: [
    { key: 'marketName', label: F.marketName, kind: 'text' },
    { key: 'partnerType', label: F.partnerType, kind: 'enum', enumName: 'marketPartnerType' },
    // Version 2. An upgraded file has it below its last row (version.ts), a new file here.
    { key: 'feedsProgramId', label: F.feedsProgramId, kind: 'optionalText' },
    { key: 'ourProduct', label: F.ourProduct, kind: 'text' },
    { key: 'ourTargetCustomers', label: F.ourTargetCustomers, kind: 'text' },
    { key: 'whyPartnerRoute', label: F.whyPartnerRoute, kind: 'text' },
    { key: 'mustHaves', label: F.mustHaves, kind: 'lines' },
    { key: 'howMarketBuys', label: F.howMarketBuys, kind: 'enum', enumName: 'howMarketBuys' },
    { key: 'howMarketBuysNote', label: F.howMarketBuysNote, kind: 'text' },
    { key: 'statement', label: F.statement, kind: 'text' },
    { key: 'expectedCandidates', label: F.expectedCandidates, kind: 'number', formerLabels: SHEET_COPY.FORMER_INFO_FIELDS.expectedCandidates },
    { key: 'status', label: F.status, kind: 'enum', enumName: 'marketStatus' },
    { key: 'statusNote', label: F.statusNote, kind: 'text' },
    { key: 'copiedFrom', label: F.copiedFrom, kind: 'optionalText', optional: true },
    { key: 'updatedAt', label: F.updatedAt, kind: 'datetime', optional: true },
    { key: 'updatedBy', label: F.updatedBy, kind: 'actor', optional: true },
  ],
};
