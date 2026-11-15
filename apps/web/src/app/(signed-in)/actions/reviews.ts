'use server';

import {
  closeReview, invalid, listMaps, openReview, ownerToday, readReview, revokeSummary, shareSummary,
} from '@partner-desk/commands';
import { type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import type { RemoteOutcome } from '@/editor/remote';
import { areaStateOf, type ReviewAreaState } from '@/partner/review-area-model';
import { mailConfigured, sendReviewSummary } from '@/server/runtime';
import { asOwner, done, refused } from './context';

// The review page's own actions (reviews spec 5.2, 5.3). Every prep edit goes through the MAP's `mapChange`; these
// start the prep and close the review. Each calls its command (one way in).

/** Starts the current horizon's prep: written to the MAP the first time, given back as it is after that. */
export async function reviewOpen(input: unknown): Promise<RemoteOutcome> {
  return asOwner(async ({ deps, actor }) => {
    const out = await openReview(deps, actor, input);
    return out.ok ? { ok: true } : refused(out);
  });
}

/** Closes a review, a person's decision: the next horizon starts and the commitments become MAP activities. */
export async function reviewClose(input: unknown): Promise<RemoteOutcome<{ suggestion: Stage | null }>> {
  return asOwner(async ({ deps, actor }) => done(await closeReview(deps, actor, input)));
}

/**
 * A partner type's Reviews area (reviews spec 5.5): its MAP's next review, held reviews and case against actual, read
 * through `readReview`. A MAP that can't be read keeps its place, with why.
 */
export async function reviewArea(input: unknown): Promise<RemoteOutcome<{ state: ReviewAreaState }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = z.object({ partnerId: z.unknown() }).strict().safeParse(input);
    if (!parsed.success) return refused(invalid());
    const listed = await listMaps(deps, actor, { companyId: await companyId(), partnerId: parsed.data.partnerId });
    if (!listed.ok) return refused(listed);
    const item = listed.value[0];
    if (!item) return { ok: true, state: { kind: 'none' } };
    const read = await readReview(deps, actor, { mapId: item.mapId });
    if (!read.ok) return { ok: true, state: { kind: 'unread', mapId: item.mapId, message: read.message } };
    return { ok: true, state: areaStateOf(read.value, await ownerToday(deps, actor.userId)) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The summary for the partner (reviews spec 5.6): the owner's only.

const summaryInput = z.object({ mapId: z.string(), reviewId: z.string(), personIds: z.unknown(), includeScorecard: z.unknown() }).strict();

/**
 * Send summary: `shareSummary` writes the scorecard choice, makes the new link, has each person emailed on the owner's
 * behalf (`sendReviewSummary`) and only then marks the review sent, with the names it reached (owner, 2026-11-01). Only
 * once email is set up. When no email went out, the review isn't marked and the person is told. A person the email
 * couldn't reach is counted here, never named.
 */
export async function reviewSummarySend(input: unknown): Promise<RemoteOutcome<{ message: string }>> {
  return asOwner(async ({ deps, actor, sender }) => {
    const parsed = summaryInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    if (!mailConfigured()) return { ok: false, error: 'invalid' as const, message: COPY.REVIEW_SUMMARY_NO_MAIL };
    const out = await shareSummary(deps, actor, parsed.data, (send, token) => sendReviewSummary(send, token, sender));
    if (!out.ok) return { ...refused(out), message: out.fieldErrors?.personIds ?? out.fieldErrors?.reviewId ?? out.message };
    const { sent, total } = out.value;
    return { ok: true, message: sent === total ? COPY.REVIEW_SUMMARY_SENT(sent) : COPY.REVIEW_SUMMARY_SENT_SOME(sent, total) };
  });
}

/** Turn off the link: the summary link stops working at once. */
export async function reviewSummaryRevoke(input: unknown): Promise<RemoteOutcome<{ message: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const out = await revokeSummary(deps, actor, input);
    return out.ok ? { ok: true, message: COPY.REVIEW_SUMMARY_TURNED_OFF } : refused(out);
  });
}
