// What the partner page shows, worked out from the Partner book around the Partner record's steps and stages. Pure: no React, no I/O.
import {
  checkStage, checkStep, confirmedRecommendation, deskRecommendation,
  type Call, type CallKind, type Hypothesis, type Market, type Partner, type PartnerBook, type Recommendation,
} from '@partner-desk/core';
import { RECRUITMENT_STEPS, STAGES, STAGE_LABELS, STEP_LABELS, TOPIC_TITLES, type RecruitmentStep, type Stage, type Topic } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { marketsForType, type MarketOption } from '@/partners/partners-model';

/** The partner page for a company, or for one of its partner types. */
export function partnerHref(accountId: string, partnerType?: string): string {
  const path = `/partners/${encodeURIComponent(accountId)}`;
  return partnerType ? `${path}?type=${encodeURIComponent(partnerType)}` : path;
}

/**
 * Where an old address goes: before partner accounts a partner's page was `/partners/{partnerId}`. When `id` is not a
 * company but one of its partner types, the company's page opened on that type; otherwise null.
 */
export function oldPartnerAddress(book: PartnerBook, id: string): string | null {
  if (book.accounts.some((account) => account.id === id)) return null;
  const section = book.partners.find((p) => p.id === id);
  return section ? partnerHref(section.accountId, section.partnerType) : null;
}

/** The partner type named in the address, if this company has it. Otherwise the first one. */
export function sectionForType(sections: readonly Partner[], type: string | null): Partner | undefined {
  return sections.find((section) => section.partnerType === type) ?? sections[0];
}

/** Whether the header shows its advice: only while the partner is in recruitment and not closed. */
export const showsRecommendation = (p: Partner): boolean => endStateOf(p) === 'recruiting';

/** The header's advice: the confirmed check once all four Cs are scored, else the desk check. */
export function partnerRecommendation(p: Partner): Recommendation | null {
  return confirmedRecommendation(p.confirmed) ?? deskRecommendation(p.desk);
}

/** Where the partner's record ends up: still recruiting, closed as not now or no, signed, or exited. */
export type EndState = 'recruiting' | 'closed' | 'signed' | 'exited';

export function endStateOf(p: Partner): EndState {
  if (p.exitedDate !== null) return 'exited';
  if (p.signedDate !== null) return 'signed';
  return p.closed !== null ? 'closed' : 'recruiting';
}

/** Whether the partner is past recruitment (signed or exited, with or without a signed date): its steps are not recorded. */
export const pastRecruitment = (p: Partner): boolean => p.signedDate !== null || p.exitedDate !== null;

/** Earlier, the one the partner is at, or later; "plain" is a stage the record can't say was reached (after the exit). */
export type Place = 'done' | 'current' | 'later' | 'plain';

export interface StepPill {
  step: RecruitmentStep;
  state: Place;
  /** Why this step can't be chosen now; null when it can (or when it is the current one). */
  blocked: string | null;
}

/** Recruitment's steps, one step back or forward at a time; after signing, every step is done. */
/** `readOnlyMessage`: why nothing can be chosen while the page is read-only, in the edition's words. */
export function stepPills(p: Partner, readOnly: boolean, readOnlyMessage: string = COPY.SAVE_READ_ONLY): StepPill[] {
  const current = p.step === null ? RECRUITMENT_STEPS.length : RECRUITMENT_STEPS.indexOf(p.step);
  return RECRUITMENT_STEPS.map((step, index) => {
    const state: Place = index === current ? 'current' : index < current ? 'done' : 'later';
    if (state === 'current') return { step, state, blocked: null };
    const rule = checkStep(p, step);
    return { step, state, blocked: readOnly ? readOnlyMessage : rule.ok ? null : rule.message };
  });
}

export interface StageBox {
  stage: Stage;
  state: Place;
  /** A stage after signing is a button; Recruitment, and every stage before signing, is not. */
  movable: boolean;
  blocked: string | null;
}

/**
 * The five stages. Before signing nothing here moves (Mark signed does); after it, one stage back or forward, until the
 * exit is marked.
 */
export function stageBoxes(p: Partner, readOnly: boolean, readOnlyMessage: string = COPY.SAVE_READ_ONLY): StageBox[] {
  const current = STAGES.indexOf(p.stage);
  const exited = p.exitedDate !== null;
  return STAGES.map((stage, index) => {
    // The record keeps no history. After the exit only Recruitment (signed) and Exit are known; the stages between are plain.
    const state: Place = exited
      ? stage === 'recruitment' || stage === 'exit' ? 'done' : 'plain'
      : index === current ? 'current' : index < current ? 'done' : 'later';
    const movable = p.signedDate !== null && p.exitedDate === null && stage !== 'recruitment' && state !== 'current';
    if (!movable) return { stage, state, movable, blocked: null };
    const rule = checkStage(p, stage);
    return { stage, state, movable, blocked: readOnly ? readOnlyMessage : rule.ok ? null : rule.message };
  });
}

/** The words under the stepper: why the steps and stages that can't be chosen can't. Null when nothing needs saying. */
export function stepperHint(p: Partner, readOnly: boolean): string | null {
  if (readOnly) return null;
  switch (endStateOf(p)) {
    case 'recruiting':
      return `${COPY.ONE_STEP} ${COPY.SIGN_TO_MOVE_ON}`;
    case 'closed':
      return COPY.REOPEN_BEFORE_STEP;
    case 'signed':
      return `${COPY.ONE_STAGE} ${COPY.NO_BACK_TO_RECRUITMENT}`;
    case 'exited':
      return null;
  }
}

/** Why *Proceed to MAP* can't be used: it works from Qualification only, and not while closed. */
export function proceedProblem(p: Partner, company: string): string | null {
  if (p.closed !== null) return COPY.REOPEN_BEFORE_STEP;
  if (p.step === 'qualification') return null;
  return COPY.PROCEED_FROM_QUALIFICATION(company, p.step ? STEP_LABELS[p.step] : STAGE_LABELS[p.stage]);
}

/** A partner's calls, newest first; on the same day, the later row first. */
export function partnerCalls(book: PartnerBook, partnerId: string): Call[] {
  return book.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.partnerId === partnerId)
    .sort((a, b) => b.call.date.localeCompare(a.call.date) || b.index - a.index)
    .map(({ call }) => call);
}

/** Logging the first discovery call offers to move a researched partner to Discovery call. Asked before the call is added. */
export function movesToDiscoveryCall(book: PartnerBook, partnerId: string, kind: CallKind): boolean {
  const p = book.partners.find((x) => x.id === partnerId);
  if (kind !== 'discovery' || p?.stage !== 'recruitment' || p.step !== 'researched' || p.closed !== null) return false;
  return !book.calls.some((call) => call.partnerId === partnerId && call.kind === 'discovery');
}

/** The free notes box: "Other notes" next to the six topics, just "Notes" on a follow-up call. */
export const notesTitle = (kind: CallKind): string => (kind === 'discovery' ? COPY.OTHER_NOTES : COPY.NOTES);

/** Pasted notes with a section too long for a sheet cell are refused whole; the message names the section. */
export function pasteRefusal(section: Topic | 'notes'): string {
  return `${section === 'notes' ? notesTitle('discovery') : TOPIC_TITLES[section]}: ${COPY.TOO_LONG}`;
}

/** The distinct values of a free-text field used across the book, for suggestions. */
export function usedValues(book: PartnerBook, field: 'vertical' | 'subVertical'): string[] {
  const values = new Set(book.accounts.map((account) => account[field].trim()).filter(Boolean));
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** A linked market's file, as far as the page has it. */
export type MarketState = { status: 'ready'; market: Market } | { status: 'failed'; message: string } | { status: 'loading' };

/** The open markets of the partner's type that it is not in yet. */
export function marketsToAdd(book: PartnerBook, markets: readonly MarketOption[], p: Partner): MarketOption[] {
  const linked = new Set(book.marketLinks.filter((l) => l.partnerId === p.id).map((l) => l.marketId));
  return marketsForType(markets, p.partnerType).filter((m) => !linked.has(m.marketId));
}

/** Whether a partner hypothesis it is linked to holds, in any of its markets (the nudge before Qualification). */
export function hypothesisHolds(book: PartnerBook, partnerId: string, states: Readonly<Record<string, MarketState>>): boolean {
  return book.marketLinks.some((link) => {
    if (link.partnerId !== partnerId || link.hypothesisId === null) return false;
    const state = states[link.marketId];
    return state?.status === 'ready' && state.market.hypotheses.some((h) => h.id === link.hypothesisId && h.status === 'holds');
  });
}

/** A market's listed name, or words for one the directory no longer lists. */
export const marketName = (markets: readonly MarketOption[], marketId: string): string =>
  markets.find((m) => m.marketId === marketId)?.displayName ?? COPY.UNKNOWN_MARKET;

/** The partner hypothesis a market link names, in the market's file: missing when it was deleted from the market. */
export function linkedHypothesis(state: MarketState, hypothesisId: string | null): Hypothesis | 'none' | 'deleted' | null {
  if (state.status !== 'ready') return null;
  if (hypothesisId === null) return 'none';
  return state.market.hypotheses.find((h) => h.id === hypothesisId) ?? 'deleted';
}

/** Where a market's partner hypotheses are edited: its Partner hypotheses tab. */
export const hypothesesPath = (marketId: string): string => `/markets/${encodeURIComponent(marketId)}?tab=hypotheses`;
