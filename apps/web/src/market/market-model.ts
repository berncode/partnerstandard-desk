// What the market page shows, worked out from the market's file and the Partner book. Pure: no React, no I/O.
// The market's partners come from the Partner book through their market links, and so do the calls.
import {
  accountOf, marketDanglingRefs, MAX_FIRST_CANDIDATES, MAX_VALUE_POINTS_PER_HYPOTHESIS, viewOf,
  type Call, type Change, type Market, type MarketField, type Partner, type PartnerBook,
} from '@partner-desk/core';
import {
  RECRUITMENT_STEPS,
  STEP_LABELS,
  TOPICS,
  TOPIC_TITLES,
  type RecruitmentStep,
  type Topic,
} from '@partner-desk/method';
import {
  CALL_KIND_LABELS,
  CLOSED_LABELS,
  COPY,
  SHEET_COPY,
} from '@partner-desk/copy';
import type { RowIssue } from '@partner-desk/storage';
import type { SaveState } from '@/editor/engine';
import { notesTitle } from '@/partner/partner-model';
import { formatDate } from '@/partners/partners-model';

// ── Tabs and the address ─────────────────────────────────────────────────────

export const MARKET_TABS = ['pipeline', 'hypothesis', 'value', 'hypotheses', 'changes'] as const;
export type MarketTab = (typeof MARKET_TABS)[number];

export const TAB_LABELS: Record<MarketTab, string> = {
  pipeline: COPY.TAB_PIPELINE,
  hypothesis: COPY.TAB_MARKET_HYPOTHESIS,
  value: COPY.TAB_VALUE,
  hypotheses: COPY.TAB_HYPOTHESES,
  changes: COPY.TAB_CHANGES,
};

/** `?tab=` from the address; the Pipeline when it is missing or not a tab. */
export const parseTab = (value: string | null): MarketTab => MARKET_TABS.find((tab) => tab === value) ?? 'pipeline';

/** The address of a market, on one of its tabs. */
export const marketPath = (marketId: string, tab?: MarketTab): string =>
  `/markets/${encodeURIComponent(marketId)}${tab && tab !== 'pipeline' ? `?tab=${tab}` : ''}`;

/** `?firstPartners=N` from the new market flow: a count from 1 to the flow's limit, or null for anything else. */
export function parseFirstPartners(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  const count = Number(raw);
  return count >= 1 && count <= MAX_FIRST_CANDIDATES ? count : null;
}

/** Two files' saves as one, for the header: saving while either saves, then an error if either failed, then saved. */
export function combinedSaveState(a: SaveState, b: SaveState): SaveState {
  for (const state of ['saving', 'error', 'saved'] as const) if (a === state || b === state) return state;
  return 'idle';
}

// ── The Pipeline ─────────────────────────────────────────────────────────────

/** A Pipeline lane: one per Recruitment step, then every signed partner (any stage after Recruitment). */
export type Lane = RecruitmentStep | 'signed';
export const LANES: readonly Lane[] = [...RECRUITMENT_STEPS, 'signed'];
export const LANE_TITLES: Record<Lane, string> = { ...STEP_LABELS, signed: COPY.SIGNED_COLUMN };

/** A partner in this market, and the partner hypothesis its link to this market names. */
export interface MarketPartner { partner: Partner; hypothesisId: string | null }

/** The partners linked to this market, each once, in the book's order. */
export function marketPartners(book: PartnerBook, marketId: string): MarketPartner[] {
  const links = new Map<string, string | null>();
  for (const link of book.marketLinks) {
    if (link.marketId === marketId && !links.has(link.partnerId)) links.set(link.partnerId, link.hypothesisId);
  }
  return book.partners.filter((p) => links.has(p.id)).map((partner) => ({ partner, hypothesisId: links.get(partner.id) ?? null }));
}

/** Where a partner sits: its step while in recruitment, else the Signed lane. Closed partners keep their place. */
export const laneOf = (p: Partner): Lane => (p.stage === 'recruitment' && p.signedDate === null ? (p.step ?? 'researched') : 'signed');

/** Closed as not now or no, or exited: hidden unless *Show closed* is on, and then shown with this chip. */
export function closedChip(p: Partner): string | null {
  if (p.exitedDate !== null) return COPY.STAGE_EXITED;
  return p.closed === null ? null : CLOSED_LABELS[p.closed];
}

/** All partners, those whose link names no partner hypothesis, or those of one hypothesis (by id). */
export type HypothesisFilter = 'all' | 'none' | (string & {});

export interface PipelineFilters { showClosed: boolean; hypothesis: HypothesisFilter }

export interface Pipeline {
  lanes: Array<{ lane: Lane; title: string; cards: MarketPartner[] }>;
  /** Closed partners the hypothesis filter lets through but *Show closed* hides. */
  hiddenClosed: number;
}

/** This market's partners by lane, after the filters. The hypothesis filter goes by the link to this market. */
export function pipelineOf(book: PartnerBook, marketId: string, { showClosed, hypothesis }: PipelineFilters): Pipeline {
  const matching = marketPartners(book, marketId).filter(({ hypothesisId }) =>
    hypothesis === 'all' || (hypothesis === 'none' ? hypothesisId === null : hypothesisId === hypothesis));
  const shown = showClosed ? matching : matching.filter(({ partner }) => viewOf(partner) !== 'closed');
  return {
    lanes: LANES.map((lane) => ({ lane, title: LANE_TITLES[lane], cards: shown.filter(({ partner }) => laneOf(partner) === lane) })),
    hiddenClosed: matching.length - shown.length,
  };
}

// ── Calls and the change log ─────────────────────────────────────────────────

// The rule itself is core's, so This week follows it too.
export { CHANGE_LOG_OFFER_DAYS, changeLogCall, marketCalls } from '@partner-desk/core';

/** A call as the change log names it: "15 Oct 2026 · Acme GmbH · Discovery". */
export function callLabel(book: PartnerBook, call: Call): string {
  const section = book.partners.find((p) => p.id === call.partnerId);
  const company = section ? accountOf(book, section)?.company ?? COPY.DELETED_PARTNER : COPY.DELETED_PARTNER;
  return `${formatDate(call.date)} · ${company} · ${CALL_KIND_LABELS[call.kind]}`;
}

/** Newest first: by date, then by when the row was saved, then the later row in the sheet first. */
export function changesNewestFirst(changes: readonly Change[]): Change[] {
  return changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => b.change.date.localeCompare(a.change.date)
      || (b.change.updatedAt ?? '').localeCompare(a.change.updatedAt ?? '')
      || b.index - a.index)
    .map(({ change }) => change);
}

/**
 * What a change is about: the Market field (a market change's `entityId` is the field's key), the value point or the
 * partner hypothesis. Null when a market change names no field.
 */
export function changeSubject(market: Market, change: Pick<Change, 'entity' | 'entityId'>): string | null {
  switch (change.entity) {
    case 'market':
      return (COPY.MARKET_FIELD_LABELS as Record<string, string>)[change.entityId] ?? null;
    case 'value_point':
      return market.valuePoints.find((v) => v.id === change.entityId)?.text ?? COPY.SINCE_DELETED;
    case 'hypothesis':
      return market.hypotheses.find((h) => h.id === change.entityId)?.name ?? COPY.SINCE_DELETED;
  }
}

export const fieldLabel = (field: MarketField): string => COPY.MARKET_FIELD_LABELS[field];

// ── Partner hypotheses ───────────────────────────────────────────────────────

/** The partners whose link to this market names the partner hypothesis, in the book's order. */
export const linkedPartners = (book: PartnerBook, marketId: string, hypothesisId: string): Partner[] =>
  marketPartners(book, marketId).filter((m) => m.hypothesisId === hypothesisId).map(({ partner }) => partner);

export interface CallNote { key: Topic | 'notes'; title: string; text: string }

/** A call's filled-in topics, in the guide's order, then its notes. */
export function callNotes(call: Call): CallNote[] {
  const notes: CallNote[] = TOPICS.filter((t) => call.topics[t].trim()).map((t) => ({ key: t, title: TOPIC_TITLES[t], text: call.topics[t] }));
  if (call.notes.trim()) notes.push({ key: 'notes', title: notesTitle(call.kind), text: call.notes });
  return notes;
}

/** A call note as one line of evidence: "Customer Pains: Manual invoices take two days." */
export const evidenceLine = (title: string, text: string): string => `${title}: ${text.replace(/\s+/g, ' ').trim()}`;

/** The evidence with `line` added on a line of its own. */
export function withEvidence(current: string, line: string): string {
  const kept = current.trimEnd();
  return kept ? `${kept}\n${line}` : line;
}

/** Ticks or unticks a value point; a hypothesis picks at most four. */
export function toggleValuePoint(ids: readonly string[], id: string): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (ids.includes(id)) return { ok: true, ids: ids.filter((v) => v !== id) };
  if (ids.length >= MAX_VALUE_POINTS_PER_HYPOTHESIS) return { ok: false, message: COPY.PICK_FEWER };
  return { ok: true, ids: [...ids, id] };
}

// ── Needs attention ──────────────────────────────────────────────────────────

/** One thing in the sheet the app couldn't use, for the list at the top of the market page. */
export interface AttentionItem { where: string; message: string }

export interface Attention {
  /** Rows the sheet has that couldn't be read: listed at the top (an issue names a tab and a row, not a row id). */
  general: AttentionItem[];
  /** Messages for rows the page shows, by `rowKey(entity, id)`: a deleted value point or call they name. */
  byRow: Map<string, string[]>;
}

export const rowKey = (entity: 'hypothesis' | 'change' | 'valuePoint' | 'exclusion', id: string): string => `${entity}:${id}`;

/** Where an issue is, in the sheet's words: "Exclusions tab, row 3", or a missing row of the Market tab. */
export const describeIssue = (issue: RowIssue): AttentionItem => ({
  where: issue.row === 0 ? COPY.ISSUE_MISSING_ROW(issue.tab) : COPY.ISSUE_WHERE(issue.tab, issue.row),
  message: issue.message,
});

/**
 * The sheet's row issues, and the rows that name something deleted: a value point (a partner hypothesis's) or a call
 * (a change row's, in the Partner book). Nothing here is fixed automatically: the rows stay as the person left them.
 */
export function attentionOf(market: Market, issues: readonly RowIssue[], book: PartnerBook): Attention {
  const byRow = new Map<string, string[]>();
  const onRow = (key: string, message: string) => byRow.set(key, [...(byRow.get(key) ?? []), message]);
  for (const ref of marketDanglingRefs(market)) {
    if (ref.entity === 'hypothesis') onRow(rowKey('hypothesis', ref.id), COPY.DANGLING_VALUE_POINT);
  }
  const calls = new Set(book.calls.map((call) => call.id));
  for (const change of market.changes) {
    if (change.callId !== null && !calls.has(change.callId)) onRow(rowKey('change', change.id), COPY.DANGLING_CALL);
  }
  return { general: issues.map(describeIssue), byRow };
}

/** The Market tab's issues, for the Market hypothesis tab (they are also listed at the top of the page). */
export const marketIssues = (issues: readonly RowIssue[]): string[] =>
  issues.filter((issue) => issue.tab === SHEET_COPY.TABS.market).map(describeIssue).map((item) => `${item.where}: ${item.message}`);
