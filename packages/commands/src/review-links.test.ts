// The summary for the partner (reviews spec 5.6): a held review's summary link, made and turned off by its owner, and
// what the link shows to anyone who has it. The link works as the business case's share link (cases.test.ts).
import { describe, expect, it, vi } from 'vitest';
import type { MapChange, MapPlan } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { MapStore, PartnerBookStore } from '@partner-desk/storage';
import { StoreFailure } from '@partner-desk/storage';
import type { Actor } from './actor';
import type { ShareDeps } from './cases';
import { changeMap, deleteMap, startMap } from './maps';
import { changeMarket, createMarket } from './markets';
import { changePartner, readPartners, removePartnerType } from './partners';
import { createCase } from './cases';
import { createProgram, readCompanyFacts } from './programs';
import { openSharedSummary, revokeSummary, shareSummary, type SummaryMail, type SummarySend } from './review-links';
import { closeReview, openReview } from './reviews';
import { hashToken, newToken } from './share-tokens';
import { makeTestDeps, TEST_NOW } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
const companyId = 'co_aaaaaaaaaa';
const TODAY = TEST_NOW.slice(0, 10);
const SIGNED = '2026-08-15';

/** What the review holds that is ours alone: never on the summary (spec 5.6). */
const HIDDEN = {
  hypothesis: 'HIDDEN-HYPOTHESIS-TEXT', answerNote: 'HIDDEN-ANSWER-NOTE', decisions: 'HIDDEN-DECISIONS', relationship: 'HIDDEN-RELATIONSHIP',
  numberNote: 'HIDDEN-NUMBER-NOTE', whyItFits: 'HIDDEN-WHY-IT-FITS',
};

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await deps.companies.rename('u1', 'Halden');
  await readPartners(deps, owner, { companyId });
  await readCompanyFacts(deps, owner, { companyId });
  deps.events.events.length = 0;
  return deps;
}

type TestDeps = Awaited<ReturnType<typeof setup>>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

const partnerChange = async (deps: TestDeps, change: Record<string, unknown>) => value(await changePartner(deps, owner, { companyId, change }));
const change = async (deps: TestDeps, mapId: string, c: MapChange) => value(await changeMap(deps, owner, { mapId, change: c })).entityId!;

async function stored(deps: TestDeps, mapId: string): Promise<MapPlan> {
  const entry = (await deps.directory.map(mapId))!;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) throw new Error('setup');
  return read.snapshot.value;
}

/**
 * A signed partner type of `company` with a MAP and its first review: prep opened with a reason, a hypothesis answer, a
 * commitment, a blocker, two numbers, decisions and a relationship note. Held on TODAY unless `held` is false.
 */
async function withReview(deps: TestDeps, opts: { company?: string; held?: boolean } = {}) {
  const accountId = (await partnerChange(deps, { kind: 'add', entity: 'account', values: { company: opts.company ?? 'Acme' } })).entityId!;
  const partnerId = (await partnerChange(deps, {
    kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller', whyItFits: HIDDEN.whyItFits },
  })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const ben = await change(deps, mapId, { kind: 'add', entity: 'person', values: { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'other' } });
  const lena = await change(deps, mapId, { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' } });
  const omar = await change(deps, mapId, { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Omar Haddad', title: '', email: 'omar@example.com', role: 'other' } });
  const noEmail = await change(deps, mapId, { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Kim No-Mail', title: '', email: null, role: 'other' } });
  const open = await change(deps, mapId, { kind: 'add', entity: 'activity', values: { title: 'Run the webinar', side: 'partner', dueDate: '2026-09-01' } });
  await change(deps, mapId, { kind: 'add', entity: 'activity', values: { title: 'Sign the reseller terms', side: 'joint', dueDate: '2026-09-10', status: 'done' } });
  await partnerChange(deps, { kind: 'markSigned', partnerId, signedDate: SIGNED });
  const market = value(await createMarket(deps, owner, {
    companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const hypothesisId = value(await changeMarket(deps, owner, {
    marketId: market.marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: HIDDEN.hypothesis } },
  })).entityId!;
  await partnerChange(deps, { kind: 'add', entity: 'marketLink', values: { partnerId, marketId: market.marketId, hypothesisId } });

  const read = value(await openReview(deps, owner, { mapId }));
  const reviewId = read.review!.id;
  const reason = read.items.find((i) => i.kind === 'notDone' && i.refId === open)!;
  const question = read.items.find((i) => i.kind === 'hypothesis')!;
  await change(deps, mapId, { kind: 'update', entity: 'reviewItem', id: reason.id, patch: { note: 'Waiting on their legal team' } });
  await change(deps, mapId, { kind: 'update', entity: 'reviewItem', id: question.id, patch: { answer: 'changed', note: HIDDEN.answerNote } });
  await change(deps, mapId, {
    kind: 'add', entity: 'reviewItem',
    values: { reviewId, kind: 'commitment', title: 'Train five sellers', side: 'partner', ownerId: lena, dueDate: '2026-12-15' },
  });
  await change(deps, mapId, { kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'blocker', title: 'No demo account', side: 'us', note: 'We owe them a sandbox' } });
  await change(deps, mapId, { kind: 'update', entity: 'review', id: reviewId, patch: { decisions: HIDDEN.decisions, relationshipNote: HIDDEN.relationship } });
  await change(deps, mapId, { kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'dealsWon', actual: 3, target: 4, source: 'finance', note: HIDDEN.numberNote } });
  await change(deps, mapId, { kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'recommend', actual: 9 } });
  if (opts.held !== false) value(await closeReview(deps, owner, { mapId, reviewId, heldOn: TODAY }));
  deps.events.events.length = 0;
  return { partnerId, accountId, mapId, reviewId, ben, lena, omar, noEmail };
}

/** The partner's page's dependencies, as the business case's (cases.test.ts): the owner's stores, read only. */
function shareDeps(deps: TestDeps, over: Partial<ShareDeps> = {}) {
  const log = vi.fn();
  const share: ShareDeps = {
    shareLinks: deps.shareLinks, reviewLinks: deps.reviewLinks, directory: deps.directory, companies: deps.companies,
    casesFor: async (userId) => (userId === 'u1' ? deps.cases : null),
    partnerBooksFor: async (userId): Promise<PartnerBookStore | null> => (userId === 'u1' ? deps.partnerBooks : null),
    mapsFor: async (userId): Promise<MapStore | null> => (userId === 'u1' ? deps.maps : null),
    ownerName: async (userId) => (userId === 'u1' ? 'Ruth' : null),
    log, ...over,
  };
  return { share, log };
}

/**
 * Sends the summary through `shareSummary` with a mail that reaches everyone, or only the people `reached` names, and
 * keeps the token the emails carry and what the mail was asked to send.
 */
async function send(
  deps: TestDeps, m: { mapId: string; reviewId: string }, personIds: string[], includeScorecard = false,
  reached?: (to: SummarySend['to']) => string[], during?: (token: string) => Promise<void>,
) {
  let token = '';
  const mails: SummarySend[] = [];
  const mail: SummaryMail = async (summary, t) => {
    token = t;
    mails.push(summary);
    await during?.(t);
    return reached ? reached(summary.to) : summary.to.map((to) => to.personId);
  };
  const out = await shareSummary(deps, owner, { mapId: m.mapId, reviewId: m.reviewId, personIds, includeScorecard }, mail);
  return out.ok ? { ok: true as const, value: { ...out.value, token, mails }, token, mails } : { ...out, token, mails };
}

const reviewOf = async (deps: TestDeps, m: { mapId: string; reviewId: string }) => (await stored(deps, m.mapId)).reviews.find((r) => r.id === m.reviewId)!;

describe('shareSummary', () => {
  it('shareSummary on a prep review is refused, and nothing is written or sent', async () => {
    const deps = await setup();
    const m = await withReview(deps, { held: false });
    const before = await stored(deps, m.mapId);
    const out = await send(deps, m, [m.lena]);
    expect(out).toMatchObject({
      ok: false, error: 'invalid', message: COPY.REVIEW_SUMMARY_NOT_HELD, fieldErrors: { reviewId: COPY.REVIEW_SUMMARY_NOT_HELD },
    });
    expect(out.mails).toEqual([]);
    expect(await stored(deps, m.mapId)).toEqual(before);
    expect(deps.reviewLinks.rows).toEqual([]);
    expect(deps.events.events).toEqual([]);
  });

  it('writes the scorecard choice and makes the link before any email, sends, then stamps the review with the names of those it reached', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    let atMail: { review: Awaited<ReturnType<typeof reviewOf>>; page: Awaited<ReturnType<typeof openSharedSummary>> } | null = null;
    const out = value(await send(deps, m, [m.lena, m.omar], true, undefined, async (token) => {
      atMail = { review: await reviewOf(deps, m), page: await openSharedSummary(share, token) };
    }));
    // When the emails go out, the link works and shows the scorecard, and the review isn't marked sent yet.
    expect(atMail!.review).toMatchObject({ includeScorecard: true, summarySentAt: null, summarySentTo: '' });
    expect(atMail!.page).toMatchObject({ kind: 'ok', view: { scorecard: expect.any(Array) } });
    expect(out).toMatchObject({ sent: 2, total: 2 });
    expect(out.mails).toEqual([{
      ownerUserId: 'u1', mapId: m.mapId, reviewId: m.reviewId,
      to: [{ personId: m.lena, email: 'lena@example.com' }, { personId: m.omar, email: 'omar@example.com' }],
    }]);
    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await reviewOf(deps, m)).toMatchObject({
      summarySentAt: TEST_NOW, summarySentTo: 'Lena Ortiz, Omar Haddad', includeScorecard: true, updatedBy: 'Ruth',
    });
    // The token itself is never stored, only its hash, and it isn't in the answer.
    expect(deps.reviewLinks.rows).toEqual([expect.objectContaining({
      ownerUserId: 'u1', mapId: m.mapId, reviewId: m.reviewId, tokenHash: hashToken(out.token), revokedAt: null,
    })]);
    expect(JSON.stringify(deps.reviewLinks.rows)).not.toContain(out.token);
    expect(JSON.stringify(value(await shareSummary(deps, owner, { mapId: m.mapId, reviewId: m.reviewId, personIds: [m.lena], includeScorecard: true }, async (s) => s.to.map((t) => t.personId))))).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('writes the review once when the scorecard choice is unchanged: only the stamp', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const applies = vi.spyOn(deps.maps, 'apply');
    const batches = vi.spyOn(deps.maps, 'applyMany');
    value(await send(deps, m, [m.lena], false));
    expect(applies.mock.calls.length + batches.mock.calls.length).toBe(1);
    expect(await reviewOf(deps, m)).toMatchObject({ includeScorecard: false, summarySentAt: TEST_NOW, summarySentTo: 'Lena Ortiz' });
  });

  it('all emails fail: the review isn’t marked sent, the person is told, the new link is off and nothing is recorded', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const out = await send(deps, m, [m.lena, m.omar], true, () => []);
    expect(out).toMatchObject({ ok: false, error: 'unavailable', message: COPY.REVIEW_SUMMARY_NOT_SENT });
    expect(await reviewOf(deps, m)).toMatchObject({ summarySentAt: null, summarySentTo: '' });
    expect(await openSharedSummary(share, out.token)).toEqual({ kind: 'gone' });
    expect(deps.reviewLinks.rows.filter((r) => r.revokedAt === null)).toEqual([]);
    expect(deps.events.events).toEqual([]);
  });

  it('one of two emails fails: the review is stamped with the one name it reached', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const out = value(await send(deps, m, [m.lena, m.omar], false, (to) => to.filter((t) => t.personId === m.omar).map((t) => t.personId)));
    expect(out).toMatchObject({ sent: 1, total: 2 });
    expect(await reviewOf(deps, m)).toMatchObject({ summarySentAt: TEST_NOW, summarySentTo: 'Omar Haddad' });
    expect((await openSharedSummary(share, out.token)).kind).toBe('ok');
  });

  it('a send again that reaches nobody keeps the earlier stamp and names, and leaves no link working', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const first = value(await send(deps, m, [m.lena]));
    deps.clock = () => '2026-10-29T08:00:00.000Z';
    const again = await send(deps, m, [m.omar], false, () => []);
    expect(again).toMatchObject({ ok: false, message: COPY.REVIEW_SUMMARY_NOT_SENT });
    expect(await reviewOf(deps, m)).toMatchObject({ summarySentAt: TEST_NOW, summarySentTo: 'Lena Ortiz' });
    // Sending again turns the earlier link off first, as the dialog says, and nothing went out: no link works.
    expect(await openSharedSummary(share, first.token)).toEqual({ kind: 'gone' });
    expect(await openSharedSummary(share, again.token)).toEqual({ kind: 'gone' });
  });

  it('turns the earlier link off before the scorecard choice is written, so an earlier recipient never sees it', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const first = value(await send(deps, m, [m.lena], false));
    const real = deps.maps.apply.bind(deps.maps);
    const seen: string[] = [];
    vi.spyOn(deps.maps, 'apply').mockImplementation(async (ref, c, stamp) => {
      const patch = (c as { patch?: Record<string, unknown> }).patch ?? {};
      if ('includeScorecard' in patch) seen.push((await openSharedSummary(share, first.token)).kind);
      return real(ref, c, stamp);
    });
    value(await send(deps, m, [m.omar], true));
    expect(seen).toEqual(['gone']);
  });

  it('a mail that throws is a summary not sent: ids-only log, the new link off, no stamp, no event', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const log = vi.spyOn(deps, 'log');
    const out = await send(deps, m, [m.lena], true, () => { throw new Error('Resend refused lena@example.com'); });
    expect(out).toMatchObject({ ok: false, error: 'unavailable', message: COPY.REVIEW_SUMMARY_NOT_SENT });
    expect(log.mock.calls).toEqual([['review_summary_mail_failed', { mapId: m.mapId, reviewId: m.reviewId }]]);
    expect(await openSharedSummary(share, out.token)).toEqual({ kind: 'gone' });
    expect(await reviewOf(deps, m)).toMatchObject({ summarySentAt: null, summarySentTo: '' });
    expect(deps.events.events).toEqual([]);
  });

  it('a stamp that can’t be written after the emails went out: logged with ids, the person is told it was sent, the send recorded', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const log = vi.spyOn(deps, 'log');
    const real = deps.maps.apply.bind(deps.maps);
    vi.spyOn(deps.maps, 'apply').mockImplementation(async (ref, c, stamp) => {
      const patch = (c as { patch?: Record<string, unknown> }).patch ?? {};
      if ('summarySentAt' in patch) return { ok: false, error: 'unavailable', message: COPY.REVIEW_SUMMARY_NOT_SENT };
      return real(ref, c, stamp);
    });
    const out = value(await send(deps, m, [m.lena]));
    expect(out).toMatchObject({ sent: 1, total: 1 });
    expect(log.mock.calls).toEqual([['review_summary_stamp_failed', { mapId: m.mapId, reviewId: m.reviewId, error: 'unavailable' }]]);
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'reviews.share', entityIds: [m.mapId, m.reviewId, deps.reviewLinks.rows[0]!.id] })]);
    // The review reads as not sent, so the person may send it again.
    expect(await reviewOf(deps, m)).toMatchObject({ summarySentAt: null, summarySentTo: '' });
  });

  it('a note typed on the review while the emails go out is kept by the stamp', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    value(await send(deps, m, [m.lena], true, undefined, async () => {
      const review = await reviewOf(deps, m);
      value(await changeMap(deps, owner, {
        mapId: m.mapId, change: { kind: 'update', entity: 'review', id: m.reviewId, patch: { decisions: 'Typed during the send' }, expectedUpdatedAt: review.updatedAt },
      }));
    }));
    expect(await reviewOf(deps, m)).toMatchObject({ decisions: 'Typed during the send', summarySentAt: TEST_NOW, summarySentTo: 'Lena Ortiz', includeScorecard: true });
  });

  it('records the send with the MAP, review and link ids only: no person id, token, address, name or summary text', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    const linkId = deps.reviewLinks.rows[0]!.id;
    expect(deps.events.events).toEqual([expect.objectContaining({
      command: 'reviews.share', actorUserId: 'u1', entityIds: [m.mapId, m.reviewId, linkId],
    })]);
    const events = JSON.stringify(deps.events.events);
    for (const hidden of [token, hashToken(token), m.lena, 'lena@example.com', 'Lena', 'Train five sellers', ...Object.values(HIDDEN)]) {
      expect(events, hidden).not.toContain(hidden);
    }
  });

  it('keeps one working link per review: a new send turns the old one off', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const first = value(await send(deps, m, [m.lena])).token;
    const second = value(await send(deps, m, [m.omar])).token;
    expect(await openSharedSummary(share, first)).toEqual({ kind: 'gone' });
    expect((await openSharedSummary(share, second)).kind).toBe('ok');
    expect(deps.reviewLinks.rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect(await reviewOf(deps, m)).toMatchObject({ summarySentTo: 'Omar Haddad' });
  });

  it('sends only to people on the partner’s side with an email, and to at least one', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    for (const personIds of [[m.ben], [m.noEmail], ['pe_gone'], [m.lena, m.ben]]) {
      const out = await send(deps, m, personIds);
      expect(out, JSON.stringify(personIds)).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { personIds: COPY.REVIEW_SUMMARY_PICK_PEOPLE } });
      expect(out.mails).toEqual([]);
    }
    expect(await send(deps, m, [])).toMatchObject({ ok: false, error: 'invalid' });
    const sends = async () => [];
    expect(await shareSummary(deps, owner, { mapId: m.mapId, reviewId: m.reviewId, personIds: [m.lena] }, sends)).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.reviewLinks.rows).toEqual([]);
    expect((await reviewOf(deps, m)).summarySentAt).toBeNull();
  });

  it('is the owner’s decision: refused for an agent at every level, a stranger, a person with a link and an unknown review', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const mail = vi.fn(async () => []);
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(await shareSummary(deps, agent(level), { mapId: m.mapId, reviewId: m.reviewId, personIds: [m.lena], includeScorecard: false }, mail))
        .toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(await shareSummary(deps, stranger, { mapId: m.mapId, reviewId: m.reviewId, personIds: [m.lena], includeScorecard: false }, mail))
      .toMatchObject({ ok: false, error: 'file_not_found' });
    const link: Actor = { kind: 'link', userId: 'u1', mapId: m.mapId, linkId: 'ml_x', personId: m.lena, side: 'partner', name: 'Lena Ortiz' };
    expect(await shareSummary(deps, link, { mapId: m.mapId, reviewId: m.reviewId, personIds: [m.lena], includeScorecard: false }, mail))
      .toMatchObject({ ok: false, error: 'forbidden' });
    expect(await send(deps, { mapId: m.mapId, reviewId: 'rv_gone' }, [m.lena])).toMatchObject({ ok: false, error: 'not_found' });
    expect(mail).not.toHaveBeenCalled();
    expect(deps.reviewLinks.rows).toEqual([]);
  });

  it('writes nothing when the review row changed under it, and makes no link and sends nothing', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const real = deps.maps.apply.bind(deps.maps);
    vi.spyOn(deps.maps, 'apply').mockImplementation(async (ref, c, stamp) => {
      const expected = (c as { expectedUpdatedAt?: string | null }).expectedUpdatedAt;
      expect(expected).toBeDefined();
      return real(ref, { ...c, expectedUpdatedAt: 'stale' } as typeof c, stamp);
    });
    const out = await send(deps, m, [m.lena], true);
    expect(out).toMatchObject({ ok: false, error: 'conflict' });
    expect(out.mails).toEqual([]);
    expect(deps.reviewLinks.rows).toEqual([]);
  });
});

describe('revokeSummary', () => {
  it('turns the review’s link off at once, and records it with ids only', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    deps.events.events.length = 0;
    value(await revokeSummary(deps, owner, { mapId: m.mapId, reviewId: m.reviewId }));
    expect(await openSharedSummary(share, token)).toEqual({ kind: 'gone' });
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'reviews.revoke', entityIds: [m.mapId, m.reviewId] })]);
    // The review keeps its stamp: the reminder on This week doesn't come back.
    expect((await stored(deps, m.mapId)).reviews.find((r) => r.id === m.reviewId)!.summarySentAt).toBe(TEST_NOW);
  });

  it('is refused for a stranger, and an agent at level read', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    expect(await revokeSummary(deps, stranger, { mapId: m.mapId, reviewId: m.reviewId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await revokeSummary(deps, agent('read'), { mapId: m.mapId, reviewId: m.reviewId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await openSharedSummary(share, token)).kind).toBe('ok');
  });
});

describe('openSharedSummary', () => {
  it('shows what spec 5.6 allows: the date, both companies, done and not done with reasons, commitments, blockers and the next review', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    const shown = await openSharedSummary(share, token);
    if (shown.kind !== 'ok') throw new Error(shown.kind);
    expect(shown.view).toEqual({
      heldOn: TODAY, horizon: 1, partnerName: 'Acme', partnerType: 'reseller', ourName: 'Halden',
      done: [{ title: 'Sign the reseller terms', side: 'joint' }],
      notDone: [{ title: 'Run the webinar', side: 'partner', reason: 'Waiting on their legal team' }],
      commitments: [{ title: 'Train five sellers', side: 'partner', owner: 'Lena Ortiz', dueDate: '2026-12-15' }],
      blockers: [{ title: 'No demo account', side: 'us', note: 'We owe them a sandbox' }],
      // The next horizon started on the day it was held, 90 days.
      nextReview: '2027-01-25',
      scorecard: null, categoryNumber: 'activeSellers', currency: null,
    });
  });

  it('lists only the commitments that became MAP activities: one never moved (a hand edit of the sheet) is left out', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const plan = await stored(deps, m.mapId);
    const moved = plan.reviewItems.find((i) => i.reviewId === m.reviewId && i.kind === 'commitment')!;
    // A commitment row added by hand to the held review's sheet: it never became an activity.
    const entry = (await deps.directory.map(m.mapId))!;
    const record = { partnerName: 'Acme', partnerType: 'reseller', stage: 'onboarding', signedDate: SIGNED, closed: null, closedReason: '' } as const;
    const handEdit = await deps.maps.apply({ fileId: entry.fileId }, {
      kind: 'update', entity: 'reviewItem', id: moved.id, patch: { moved: false, title: 'Never moved' }, record,
    }, { now: TEST_NOW, actor: 'Ruth' });
    expect(handEdit.ok).toBe(true);
    const { token } = value(await send(deps, m, [m.lena]));
    const shown = await openSharedSummary(shareDeps(deps).share, token);
    if (shown.kind !== 'ok') throw new Error(shown.kind);
    expect(shown.view.commitments).toEqual([]);
  });

  it('never holds the hypothesis, its answer, the decisions, the relationship note or a number’s source and note', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    for (const includeScorecard of [false, true]) {
      const { token } = value(await send(deps, m, [m.lena], includeScorecard));
      const json = JSON.stringify(await openSharedSummary(share, token));
      for (const hidden of [...Object.values(HIDDEN), 'finance', 'changed', 'source', m.mapId, m.reviewId, 'u1', m.lena]) {
        expect(json, hidden).not.toContain(hidden);
      }
    }
  });

  it('holds the scorecard’s numbers, the recommend score among them, only when includeScorecard is on', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const off = await openSharedSummary(share, value(await send(deps, m, [m.lena], false)).token);
    expect(off.kind === 'ok' && off.view.scorecard).toBeNull();
    const on = await openSharedSummary(share, value(await send(deps, m, [m.lena], true)).token);
    if (on.kind !== 'ok') throw new Error(on.kind);
    expect(on.view.scorecard).toEqual(expect.arrayContaining([
      { key: 'dealsWon', actual: 3, target: 4 },
      { key: 'recommend', actual: 9, target: 8 },
    ]));
    expect(on.view.categoryNumber).toBe('activeSellers');
  });

  it('names the business case’s currency with the scorecard, as the review page picks the case; none without a case or the scorecard', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const scorecard = async (on: boolean) => {
      const shown = await openSharedSummary(share, value(await send(deps, m, [m.lena], on)).token);
      if (shown.kind !== 'ok') throw new Error(shown.kind);
      return shown.view.currency;
    };
    expect(await scorecard(true)).toBeNull();
    const programId = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' })).programId;
    await partnerChange(deps, { kind: 'update', entity: 'partner', id: m.partnerId, patch: { programId } });
    const caseId = value(await createCase(deps, owner, { companyId, partnerId: m.partnerId })).caseId;
    const entry = (await deps.directory.businessCase(caseId))!;
    const read = await deps.cases.read({ fileId: entry.fileId });
    if (!read.ok) throw new Error('setup');
    expect(await scorecard(true)).toBe(read.snapshot.value.offer.currency);
    expect(await scorecard(false)).toBeNull();
    // A case that can't be read: the page still shows, money without a sign.
    const { share: failing } = shareDeps(deps, { casesFor: async () => ({ ...deps.cases, read: async () => { throw new StoreFailure('unavailable', 'down'); } }) });
    const shown = await openSharedSummary(failing, value(await send(deps, m, [m.lena], true)).token);
    expect(shown.kind === 'ok' && shown.view.currency).toBeNull();
  });

  it('a token opens only its own review', async () => {
    const deps = await setup();
    const acme = await withReview(deps, { company: 'Acme' });
    const bright = await withReview(deps, { company: 'Brightwave' });
    const { share } = shareDeps(deps);
    const a = value(await send(deps, acme, [acme.lena])).token;
    const b = value(await send(deps, bright, [bright.lena])).token;
    const shownA = await openSharedSummary(share, a);
    const shownB = await openSharedSummary(share, b);
    expect(shownA.kind === 'ok' && shownA.view.partnerName).toBe('Acme');
    expect(shownB.kind === 'ok' && shownB.view.partnerName).toBe('Brightwave');
  });

  it('a revoked token shows gone, as an unknown one and one that isn’t a token: the same answer for each', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    await deps.reviewLinks.revokeReview('u1', m.mapId, m.reviewId, TEST_NOW);
    for (const t of [token, newToken(), 'not-a-token', '', null, 42, `${token}x`]) {
      expect(await openSharedSummary(share, t), String(t)).toEqual({ kind: 'gone' });
    }
  });

  it('deleting the MAP turns its summary links off', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { share } = shareDeps(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    value(await deleteMap(deps, owner, { mapId: m.mapId }));
    expect(deps.reviewLinks.rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(await openSharedSummary(share, token)).toEqual({ kind: 'gone' });
  });

  it('removing the partner type turns its summary links off, its MAP file kept or trashed', async () => {
    for (const items of ['keep', 'trash'] as const) {
      const deps = await setup();
      const m = await withReview(deps);
      const { share } = shareDeps(deps);
      const { token } = value(await send(deps, m, [m.lena]));
      value(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: [m.partnerId, m.accountId], items }));
      expect(deps.reviewLinks.rows.every((r) => r.revokedAt !== null), items).toBe(true);
      expect(await openSharedSummary(share, token)).toEqual({ kind: 'gone' });
    }
  });

  it('is gone once the owner is gone, and says it can’t be shown now when the owner’s storage fails', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    expect(await openSharedSummary(shareDeps(deps, { mapsFor: async () => null }).share, token)).toEqual({ kind: 'gone' });
    const failing = { ...deps.maps, read: async () => { throw new StoreFailure('unavailable', 'down'); } } as MapStore;
    const { share, log } = shareDeps(deps, { mapsFor: async () => failing });
    expect(await openSharedSummary(share, token)).toEqual({ kind: 'unavailable' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(hashToken(token));
  });

  it('only reads: it writes nothing to the MAP, the links, the events or the directory', async () => {
    const deps = await setup();
    const m = await withReview(deps);
    const { token } = value(await send(deps, m, [m.lena]));
    const before = { plan: await stored(deps, m.mapId), links: structuredClone(deps.reviewLinks.rows), events: deps.events.events.length };
    const writes = [
      vi.spyOn(deps.maps, 'apply'), vi.spyOn(deps.maps, 'applyMany'), vi.spyOn(deps.maps, 'trash'), vi.spyOn(deps.partnerBooks, 'apply'),
      vi.spyOn(deps.reviewLinks, 'create'), vi.spyOn(deps.reviewLinks, 'revokeReview'), vi.spyOn(deps.reviewLinks, 'revokeMaps'),
      vi.spyOn(deps.directory, 'setMapLastChange'),
    ];
    const { share } = shareDeps(deps);
    expect((await openSharedSummary(share, token)).kind).toBe('ok');
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(await stored(deps, m.mapId)).toEqual(before.plan);
    expect(deps.reviewLinks.rows).toEqual(before.links);
    expect(deps.events.events).toHaveLength(before.events);
  });
});
