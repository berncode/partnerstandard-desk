// What a proposal's card shows (agent proposals design, spec 10): the rows with now and proposed, and whether it still
// waits, changed since, can't apply any more, is so already, expired or was answered.
import {
  STAGE_LABELS,
  STEP_LABELS,
  type FourC,
} from '@partner-desk/method';
import {
  CLOSED_LABELS,
  COPY,
  HYPOTHESIS_STATUS_LABELS,
  MARKET_STATUS_LABELS,
  SHEET_COPY,
} from '@partner-desk/copy';
import type { Market } from '../markets/types';
import type { IsoDateTime, Partner, PartnerBook } from '../partners/types';
import { dayLabel } from '../shared/day';
import { PROPOSAL_SHOWN_AFTER_DAYS, type ProposalInput, type ProposalTarget, type ProposedCompany } from './input';
import { proposedValue, type ProposedValue } from './rows';
import { alreadySo, possibleNow, targetUpdatedAt, type ProposalScene } from './rules';
import type { ProposalItem, ProposalItemStatus, ProposalKind, ProposalStatus } from './types';

export type { ProposalStatus } from './types';

/** A proposal as our index has it (ids, codes and times), with the agent's name and whether it is still turned on. */
export interface ProposalHead {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  createdAt: IsoDateTime;
  answeredAt: IsoDateTime | null;
  expiresAt: IsoDateTime;
  agentName: string;
  makerOn: boolean;
}

/**
 * waiting: it can be accepted as it is. changed: the target changed since it was proposed (the card shows both
 * values). cannot: it can't apply any more (`cannot` says why; only Reject). already: the target holds what it
 * proposes (accepting closes it). expired and answered: one line, `answeredLine`, for 30 days.
 */
export type ProposalState = 'waiting' | 'changed' | 'cannot' | 'already' | 'expired' | 'answered';

/** One row of the card: what it sets, its value now and the proposed one (in words), and the letter's evidence. */
export interface ProposalRow { itemId: string; what: string; now: string; proposed: string; evidence: string; status: ProposalItemStatus }

export interface ProposalView {
  head: ProposalHead;
  target: ProposalTarget;
  /** The target's name when proposed: the company, the market or the hypothesis. */
  about: string;
  /** The agent's reason; empty for 4C, whose letters each have their evidence. */
  reason: string;
  rows: ProposalRow[];
  state: ProposalState;
  cannot: string | null;
  answeredLine: string | null;
  /**
   * The target's `updatedAt` now, as the card shows it; null when unknown (a market kind without its market file).
   * The card always shows the value now beside the proposed one, so an accept sends this one.
   */
  targetUpdatedAt: IsoDateTime | null;
}

export interface ProposalViewScene {
  book: PartnerBook;
  /** The markets the page read, by id. This week reads none: a market kind then simply waits. */
  markets: Readonly<Record<string, { market: Market | null; archived: boolean }>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WHAT = SHEET_COPY.PROPOSALS.LABELS.what;
const time = (at: IsoDateTime | null | undefined) => (at ? Date.parse(at) : Number.NaN);

/** The proposal's input rebuilt from its rows, to run the same rules on it; null when a row can't be read. */
function inputOf(kind: ProposalKind, items: readonly ProposalItem[], values: readonly ProposedValue[]): ProposalInput | null {
  const first = items[0]!;
  const reason = first.evidence;
  const only = values.length === 1 ? values[0]! : null;
  const partner = first.partnerId === null ? null : { partnerId: first.partnerId, expectedUpdatedAt: first.targetUpdated };
  switch (kind) {
    case 'fourC': {
      if (!partner || !values.every((v) => v.field === 'desk')) return null;
      const letters: Partial<Record<FourC, { score: 0 | 1 | 2 | 3; evidence: string }>> = {};
      values.forEach((v, i) => { if (v.field === 'desk') letters[v.letter] = { score: v.score, evidence: items[i]!.evidence }; });
      return { kind, ...partner, letters };
    }
    case 'stage':
      return partner && (only?.field === 'step' || only?.field === 'stage') ? { kind, ...partner, to: only.to, reason } : null;
    case 'close':
      return partner && only?.field === 'closed' ? { kind, ...partner, as: only.as, reason } : null;
    case 'signed':
      return partner && only?.field === 'signedDate' ? { kind, ...partner, signedDate: only.date, reason } : null;
    case 'partners': {
      if (first.marketId === null || !values.every((v) => v.field === 'company')) return null;
      const companies = values.flatMap((v): ProposedCompany[] => (v.field === 'company' ? [v.company] : []));
      return { kind, marketId: first.marketId, hypothesisId: first.hypothesisId, companies, reason };
    }
    case 'hypothesisStatus':
      return first.marketId !== null && first.hypothesisId !== null && only?.field === 'hypothesisStatus'
        ? { kind, marketId: first.marketId, hypothesisId: first.hypothesisId, expectedUpdatedAt: first.targetUpdated, to: only.to, reason }
        : null;
    case 'marketStatus':
      return first.marketId !== null && only?.field === 'marketStatus'
        ? { kind, marketId: first.marketId, expectedUpdatedAt: first.targetUpdated, to: only.to, note: only.note, reason }
        : null;
  }
}

const stageNow = (p: Partner) => (p.stage === 'recruitment' && p.step !== null ? STEP_LABELS[p.step] : STAGE_LABELS[p.stage]);

/** The target's value now, in the words the card shows; empty when the target or its value isn't there. */
function nowOf(item: ProposalItem, partner: Partner | undefined, market: Market | null): string {
  switch (item.what) {
    case 'desk.customerBase': case 'desk.credibility': case 'desk.capability': case 'desk.commitment': {
      const score = partner?.desk[item.what.slice('desk.'.length) as FourC];
      return score === undefined || score === null ? '' : String(score);
    }
    case 'step': case 'stage':
      return partner ? stageNow(partner) : '';
    case 'closed':
      return partner?.closed ? CLOSED_LABELS[partner.closed] : '';
    case 'signedDate':
      return partner?.signedDate ? dayLabel(partner.signedDate) : '';
    case 'company':
      return '';
    case 'hypothesisStatus': {
      const status = market?.hypotheses.find((h) => h.id === item.hypothesisId)?.status;
      return status ? HYPOTHESIS_STATUS_LABELS[status] : '';
    }
    case 'marketStatus':
      return market ? MARKET_STATUS_LABELS[market.info.status] : '';
  }
}

/** The proposed value in the words the card shows: a signing date as a day ("3 Nov 2026"); the sheet keeps 2026-11-03. */
const proposedText = (item: ProposalItem): string => (item.what === 'signedDate' ? dayLabel(item.proposed.trim()) : item.proposed);

/** The text beside a row: a letter's evidence, a new partner's Why it fits, a market status's note. */
function evidenceOf(item: ProposalItem, value: ProposedValue | null): string {
  if (value?.field === 'company') return value.company.whyItFits;
  if (value?.field === 'marketStatus') return value.note;
  return item.what.startsWith('desk.') ? item.evidence : '';
}

/** "Accepted", "Accepted 2 of 4" or "Rejected", from the rows' own answers. */
function answeredLineOf(items: readonly ProposalItem[]): string {
  const accepted = items.filter((i) => i.status === 'accepted').length;
  if (accepted === 0) return COPY.PROPOSAL_REJECTED;
  return accepted === items.length ? COPY.PROPOSAL_ACCEPTED : COPY.PROPOSAL_ACCEPTED_SOME(accepted, items.length);
}

const ANSWERED_ITEM: ReadonlySet<ProposalItemStatus> = new Set(['accepted', 'rejected']);
const GONE_ITEM: ReadonlySet<ProposalItemStatus> = new Set(['withdrawn', 'replaced', 'not_sent']);
const HEAD_LINES: Partial<Record<ProposalStatus, string>> = {
  accepted: COPY.PROPOSAL_ACCEPTED, partly_accepted: COPY.PROPOSAL_ACCEPTED, rejected: COPY.PROPOSAL_REJECTED,
};

type Decided = Pick<ProposalView, 'state' | 'cannot' | 'answeredLine' | 'targetUpdatedAt'>;

/** Whether a waiting proposal can be accepted as it is, against the book and its market as they are now. */
function waitingState(
  kind: ProposalKind, items: readonly ProposalItem[], values: readonly (ProposedValue | null)[], book: PartnerBook,
  markets: ProposalViewScene['markets'],
): Decided {
  const readable = values.every((v) => v !== null) ? inputOf(kind, items, values as ProposedValue[]) : null;
  if (!readable) return { state: 'cannot', cannot: COPY.GONE, answeredLine: null, targetUpdatedAt: null };
  const input = readable;
  const marketId = 'marketId' in input ? input.marketId : null;
  const entry = marketId === null ? { market: null, archived: false } : markets[marketId];
  // A market kind on a page that didn't read its market (This week): nothing to compare, so it simply waits.
  if (!entry) return { state: 'waiting', cannot: null, answeredLine: null, targetUpdatedAt: null };
  const scene: ProposalScene = { book, market: entry.market, archived: entry.archived };
  const now = targetUpdatedAt(input, scene);
  const verdict = possibleNow(input, scene);
  if (!verdict.ok) return { state: 'cannot', cannot: verdict.message, answeredLine: null, targetUpdatedAt: now };
  if (alreadySo(input, scene)) return { state: 'already', cannot: null, answeredLine: null, targetUpdatedAt: now };
  // An empty Target updated means "don't know": the card can't say it changed since, so it simply waits.
  const kept = items[0]!.targetUpdated;
  const changed = items.every((i) => i.targetUpdated !== null) && now !== kept;
  return { state: changed ? 'changed' : 'waiting', cannot: null, answeredLine: null, targetUpdatedAt: now };
}

/**
 * The cards to show, newest first: one per index head that has rows in the book. An answered or expired one shows one
 * line for 30 days, then goes; a withdrawn or replaced one never shows. The file's answer wins over a waiting head
 * (the index write after it failed); a waiting head past its expiry shows as expired before the job marks it.
 */
export function proposalViews(heads: readonly ProposalHead[], scene: ProposalViewScene, now: IsoDateTime): ProposalView[] {
  const nowMs = Date.parse(now);
  const shownUntil = (at: number) => at + PROPOSAL_SHOWN_AFTER_DAYS * DAY_MS;
  const out: ProposalView[] = [];
  for (const head of heads) {
    if (head.status === 'withdrawn' || head.status === 'replaced') continue;
    const items = scene.book.proposalItems.filter((i) => i.proposalId === head.id);
    if (items.length === 0 || items.every((i) => GONE_ITEM.has(i.status))) continue;
    const first = items[0]!;
    const values = items.map(proposedValue);
    const partner = first.partnerId === null ? undefined : scene.book.partners.find((p) => p.id === first.partnerId);
    const market = first.marketId === null ? null : scene.markets[first.marketId]?.market ?? null;
    const rows = items.map((item, i): ProposalRow => ({
      itemId: item.id, what: WHAT[item.what], now: nowOf(item, partner, market), proposed: proposedText(item),
      evidence: evidenceOf(item, values[i]!), status: item.status,
    }));

    let decided: Decided;
    let endedAt: number | null = null;
    const answered = items.filter((i) => ANSWERED_ITEM.has(i.status));
    if (answered.length > 0) {
      const latest = Math.max(...answered.map((i) => time(i.answeredOn)).filter((t) => !Number.isNaN(t)));
      // No answered time to read: it counts from its expiry, so it never shows for ever.
      endedAt = Number.isNaN(time(head.answeredAt)) ? (Number.isFinite(latest) ? latest : time(head.expiresAt)) : time(head.answeredAt);
      decided = { state: 'answered', cannot: null, answeredLine: answeredLineOf(items), targetUpdatedAt: null };
    } else if (HEAD_LINES[head.status]) {
      endedAt = Number.isNaN(time(head.answeredAt)) ? time(head.expiresAt) : time(head.answeredAt);
      decided = { state: 'answered', cannot: null, answeredLine: HEAD_LINES[head.status]!, targetUpdatedAt: null };
    } else if (head.status === 'expired' || nowMs >= time(head.expiresAt) || items.some((i) => i.status === 'expired')) {
      endedAt = time(head.expiresAt);
      decided = { state: 'expired', cannot: null, answeredLine: COPY.PROPOSAL_EXPIRED, targetUpdatedAt: null };
    } else {
      decided = waitingState(head.kind, items, values, scene.book, scene.markets);
    }
    if (endedAt !== null && nowMs > shownUntil(endedAt)) continue;

    out.push({
      head,
      target: { accountId: first.accountId, partnerId: first.partnerId, marketId: first.marketId, hypothesisId: first.hypothesisId },
      about: first.about,
      reason: head.kind === 'fourC' ? '' : first.evidence,
      rows,
      ...decided,
    });
  }
  return out.sort((a, b) => time(b.head.createdAt) - time(a.head.createdAt));
}
