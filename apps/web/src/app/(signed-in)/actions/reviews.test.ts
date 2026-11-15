import { changeMap, changePartner, readPartners, readReview, startMap, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const COMPANY = 'co_aaaaaaaaaa';
const state = vi.hoisted(() => ({
  session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps>, mail: true as boolean,
  sent: [] as Array<{ to: { personId: string; email: string }; token: string }>, reach: (() => true) as (email: string) => boolean,
}));
vi.mock('@/server/runtime', () => ({
  mailConfigured: () => state.mail,
  sendReviewSummary: async (send: { to: Array<{ personId: string; email: string }> }, token: string) => {
    const { to: people, ...rest } = send;
    for (const to of people) state.sent.push({ to: { ...rest, ...to }, token });
    return people.filter((to) => state.reach(to.email)).map((to) => to.personId);
  },
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: COMPANY, name: 'Halden' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { reviewClose, reviewOpen, reviewSummaryRevoke, reviewSummarySend } = await import('./reviews');

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };

/** Acme as a signed reseller with a MAP. */
async function signedMap(): Promise<string> {
  const send = async (change: unknown) => {
    const out = await changePartner(state.deps, anna, { companyId: COMPANY, change });
    if (!out.ok) throw new Error(out.message);
    return out.value.entityId;
  };
  const accountId = await send({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
  const partnerId = (await send({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } }))!;
  const started = await startMap(state.deps, anna, { companyId: COMPANY, partnerId });
  if (!started.ok) throw new Error(started.message);
  await send({ kind: 'markSigned', partnerId, signedDate: '2026-10-01' });
  return started.value.mapId;
}

beforeEach(async () => {
  state.session = session;
  state.mail = true;
  state.sent = [];
  state.reach = () => true;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  await readPartners(state.deps, anna, { companyId: COMPANY });
});

describe('reviewOpen and reviewClose', () => {
  it('starts the prep, then closes the review and suggests Growth after the first one', async () => {
    const mapId = await signedMap();
    expect(await reviewOpen({ mapId })).toEqual({ ok: true });
    const read = await readReview(state.deps, anna, { mapId });
    if (!read.ok || !read.value.review) throw new Error('no prep');
    const reviewId = read.value.review.id;
    const today = '2026-10-28'; // The test clock's day (TEST_NOW).
    expect(await reviewClose({ mapId, reviewId, heldOn: today })).toEqual({ ok: true, suggestion: 'growth' });
    // A second close is refused: the review is already held.
    expect(await reviewClose({ mapId, reviewId, heldOn: today })).toMatchObject({
      ok: false, error: 'invalid', message: COPY.REVIEW_ERR_ALREADY_HELD, fieldErrors: { reviewId: COPY.REVIEW_ERR_ALREADY_HELD },
    });
  });

  it('gives closing’s field errors keyed by the commitment', async () => {
    const mapId = await signedMap();
    await reviewOpen({ mapId });
    const read = await readReview(state.deps, anna, { mapId });
    if (!read.ok || !read.value.review) throw new Error('no prep');
    const reviewId = read.value.review.id;
    const added = await changeMap(state.deps, anna, {
      mapId, change: { kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'commitment', title: 'Train sellers', side: 'us' } },
    });
    if (!added.ok) throw new Error(added.message);
    expect(await reviewClose({ mapId, reviewId, heldOn: '2026-10-28' })).toMatchObject({
      ok: false, fieldErrors: { [added.value.entityId!]: COPY.REVIEW_ERR_NEEDS_DUE },
    });
  });

  it('answers signed out without a session', async () => {
    state.session = null;
    expect(await reviewOpen({ mapId: 'map_1' })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
    expect(await reviewClose({ mapId: 'map_1', reviewId: 'rv_1', heldOn: '2026-10-28' })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
  });
});

describe('reviewSummarySend and reviewSummaryRevoke', () => {
  /** A held first review with two partner-side people. */
  async function held() {
    const mapId = await signedMap();
    const person = async (name: string, email: string) => {
      const out = await changeMap(state.deps, anna, { mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name, title: '', email, role: 'other' } } });
      if (!out.ok) throw new Error(out.message);
      return out.value.entityId!;
    };
    const lena = await person('Lena Ortiz', 'lena@example.com');
    const omar = await person('Omar Haddad', 'omar@example.com');
    await reviewOpen({ mapId });
    const read = await readReview(state.deps, anna, { mapId });
    if (!read.ok || !read.value.review) throw new Error('no prep');
    const reviewId = read.value.review.id;
    await reviewClose({ mapId, reviewId, heldOn: '2026-10-28' });
    return { mapId, reviewId, lena, omar };
  }

  it('sends each person the new link by email, says how many it reached, and marks the review sent only when one went out', async () => {
    const { mapId, reviewId, lena, omar } = await held();
    expect(await reviewSummarySend({ mapId, reviewId, personIds: [lena, omar], includeScorecard: false })).toEqual({ ok: true, message: COPY.REVIEW_SUMMARY_SENT(2) });
    expect(state.sent.map((s) => s.to)).toEqual([
      expect.objectContaining({ personId: lena, email: 'lena@example.com', mapId, reviewId, ownerUserId: 'u_anna' }),
      expect.objectContaining({ personId: omar, email: 'omar@example.com' }),
    ]);
    expect(state.sent[0]!.token).toBe(state.sent[1]!.token);
    const review = async () => {
      const read = await readReview(state.deps, anna, { mapId, reviewId });
      if (!read.ok || !read.value.review) throw new Error('no review');
      return read.value.review;
    };
    expect(await review()).toMatchObject({ summarySentTo: 'Lena Ortiz, Omar Haddad' });
    state.sent = [];
    state.reach = (email) => email.startsWith('lena');
    expect(await reviewSummarySend({ mapId, reviewId, personIds: [lena, omar], includeScorecard: true })).toEqual({ ok: true, message: COPY.REVIEW_SUMMARY_SENT_SOME(1, 2) });
    expect(await review()).toMatchObject({ summarySentTo: 'Lena Ortiz' });
    state.reach = () => false;
    expect(await reviewSummarySend({ mapId, reviewId, personIds: [omar], includeScorecard: true })).toMatchObject({ ok: false, message: COPY.REVIEW_SUMMARY_NOT_SENT });
    // Nothing went out: the review still says what it said.
    expect(await review()).toMatchObject({ summarySentTo: 'Lena Ortiz' });
  });

  it('sends nothing without email set up, for a review not held or for someone not on the partner’s side', async () => {
    const { mapId, reviewId, lena } = await held();
    state.mail = false;
    expect(await reviewSummarySend({ mapId, reviewId, personIds: [lena], includeScorecard: false })).toMatchObject({ ok: false, message: COPY.REVIEW_SUMMARY_NO_MAIL });
    state.mail = true;
    expect(await reviewSummarySend({ mapId, reviewId, personIds: ['pe_gone'], includeScorecard: false })).toMatchObject({ ok: false, message: COPY.REVIEW_SUMMARY_PICK_PEOPLE });
    expect(await reviewSummarySend({ mapId, reviewId, personIds: [lena] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(state.sent).toEqual([]);
    expect(state.deps.reviewLinks.rows).toEqual([]);
  });

  it('turns the link off, and answers signed out without a session', async () => {
    const { mapId, reviewId, lena } = await held();
    await reviewSummarySend({ mapId, reviewId, personIds: [lena], includeScorecard: false });
    expect(await reviewSummaryRevoke({ mapId, reviewId })).toEqual({ ok: true, message: COPY.REVIEW_SUMMARY_TURNED_OFF });
    expect(state.deps.reviewLinks.rows.every((r) => r.revokedAt !== null)).toBe(true);
    state.session = null;
    expect(await reviewSummarySend({ mapId, reviewId, personIds: [lena], includeScorecard: false })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
    expect(await reviewSummaryRevoke({ mapId, reviewId })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
  });
});
