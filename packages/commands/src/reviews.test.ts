import { describe, expect, it, vi } from 'vitest';
import type { MapChange, MapPlan } from '@partner-desk/core';
import { horizonMilestones } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { Actor } from './actor';
import { createCase, shareCase } from './cases';
import { openMapLink, resolveMapSession, shareMap } from './map-links';
import { changeMap, readMap, startMap } from './maps';
import { changeMarket, createMarket } from './markets';
import { changePartner, readPartners } from './partners';
import { createProgram, readCompanyFacts } from './programs';
import { closeReview, listReviews, openReview, readReview } from './reviews';
import { makeTestDeps, TEST_NOW } from './testing';
import * as commandsPackage from './index';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
const companyId = 'co_aaaaaaaaaa';
const TODAY = TEST_NOW.slice(0, 10);
/** Signed on this day, a 90-day first horizon ends on 2026-11-12: its review is 15 days away on TODAY (2026-10-28). */
const SIGNED = '2026-08-15';
const REVIEW_DATE = '2026-11-12';

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
const change = async (deps: TestDeps, actor: Actor, mapId: string, c: MapChange) => changeMap(deps, actor, { mapId, change: c });

async function stored(deps: TestDeps, mapId: string): Promise<MapPlan> {
  const entry = (await deps.directory.map(mapId))!;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) throw new Error('setup');
  return read.snapshot.value;
}

/** A partner type of Acme with a MAP: a person per side and the horizon's work, signed on SIGNED unless `signed` is false. */
async function withMap(deps: TestDeps, opts: { signed?: boolean; partnerType?: string; company?: string } = {}) {
  const account = await partnerChange(deps, { kind: 'add', entity: 'account', values: { company: opts.company ?? 'Acme' } });
  const accountId = account.entityId!;
  const partnerId = (await partnerChange(deps, {
    kind: 'add', entity: 'partner', values: { accountId, partnerType: opts.partnerType ?? 'reseller', whyItFits: 'SECRET why it fits' },
  })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const add = async (entity: 'activity' | 'person', values: Record<string, unknown>) =>
    value(await change(deps, owner, mapId, { kind: 'add', entity, values })).entityId!;
  const ben = await add('person', { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'other' });
  const lena = await add('person', { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' });
  const before = await add('activity', { title: 'SECRET left from before', side: 'us', dueDate: '2026-08-01' });
  const open = await add('activity', { title: 'SECRET open task', side: 'partner', dueDate: '2026-09-01' });
  const done = await add('activity', { title: 'SECRET done task', side: 'joint', dueDate: '2026-09-10', status: 'done' });
  await add('activity', { title: 'SECRET not needed', side: 'us', dueDate: '2026-09-05', status: 'na' });
  const later = await add('activity', { title: 'SECRET next year', side: 'us', dueDate: '2027-01-01' });
  if (opts.signed !== false) await partnerChange(deps, { kind: 'markSigned', partnerId, signedDate: SIGNED });
  deps.events.events.length = 0;
  return { accountId, partnerId, mapId, ben, lena, activities: { before, open, done, later } };
}

/** A market for resellers with one hypothesis, linked to the partner type. */
async function linkHypothesis(deps: TestDeps, partnerId: string, name = 'SECRET agencies that build shops') {
  const market = value(await createMarket(deps, owner, {
    companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const added = value(await changeMarket(deps, owner, { marketId: market.marketId, change: { kind: 'add', entity: 'hypothesis', values: { name } } }));
  const hypothesisId = added.entityId!;
  await partnerChange(deps, { kind: 'add', entity: 'marketLink', values: { partnerId, marketId: market.marketId, hypothesisId } });
  deps.events.events.length = 0;
  return { marketId: market.marketId, hypothesisId };
}

/** A business case for the partner type (its program made fresh), so the review has targets from it. */
async function withCase(deps: TestDeps, partnerId: string) {
  const programId = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' })).programId;
  await partnerChange(deps, { kind: 'update', entity: 'partner', id: partnerId, patch: { programId } });
  const caseId = value(await createCase(deps, owner, { companyId, partnerId })).caseId;
  deps.events.events.length = 0;
  return caseId;
}

/** The open review with one commitment for the partner side, ready to close. */
async function withCommitment(deps: TestDeps, m: Awaited<ReturnType<typeof withMap>>) {
  const read = value(await openReview(deps, owner, { mapId: m.mapId }));
  const reviewId = read.review!.id;
  const commitment = value(await change(deps, owner, m.mapId, {
    kind: 'add', entity: 'reviewItem',
    values: { reviewId, kind: 'commitment', title: 'SECRET train five sellers', side: 'partner', ownerId: m.lena, dueDate: '2026-12-15' },
  })).entityId!;
  deps.events.events.length = 0;
  return { reviewId, commitment };
}

/** A person's link, opened: the actor their session resolves to. */
async function linkActor(deps: TestDeps, mapId: string, personId: string) {
  const { token } = value(await shareMap(deps, owner, { mapId, personId }));
  const opened = await openMapLink(deps, token);
  if (opened.kind !== 'session') throw new Error('setup');
  const resolved = await resolveMapSession(deps, opened.sessionToken, mapId);
  if (resolved.kind !== 'active') throw new Error('setup');
  return resolved.actor;
}

describe('readReview', () => {
  it('before prep: the status, no review, the horizon’s work and what the review page shows', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { hypothesisId, marketId } = await linkHypothesis(deps, m.partnerId);
    const read = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect(read).toMatchObject({
      mapId: m.mapId, partnerName: 'Acme', partnerType: 'reseller', review: null, numbers: [], items: [], held: [],
      status: { kind: 'coming', date: REVIEW_DATE, daysLeft: 15, prepId: null }, categoryNumber: 'activeSellers', case: null, caseOptions: [],
      whyItFits: 'SECRET why it fits', caseAgainstActual: null, expectedUpdatedAt: '',
    });
    expect(read.info).toMatchObject({ stage: 'onboarding', startDate: SIGNED, horizonDays: 90 });
    expect(read.work.map((a) => a.id).sort()).toEqual([m.activities.before, m.activities.open, m.activities.done].sort());
    expect(read.people.map((p) => p.id)).toEqual([m.ben, m.lena]);
    expect(read.hypotheses).toEqual([{ id: hypothesisId, marketId, marketName: 'Austria', text: 'SECRET agencies that build shops' }]);
    // No business case: only the recommend target, the method's 8 (spec 5.4), and nothing to prefill money from.
    expect(read.targets).toMatchObject({ recommend: 8, dealsWon: null, weBill: null, partnerEarns: null });
    expect(read.perDeal).toBeNull();
    expect(read.health.health).not.toBeNull();
  });

  it('prefills the active sellers of the partner’s account for a channel partner type', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    await partnerChange(deps, { kind: 'add', entity: 'person', values: { accountId: m.accountId, name: 'Seller One', activeSeller: true } });
    await partnerChange(deps, { kind: 'add', entity: 'person', values: { accountId: m.accountId, name: 'Not selling', activeSeller: false } });
    expect(value(await readReview(deps, owner, { mapId: m.mapId })).prefill).toMatchObject({ categoryNumber: 1 });
  });

  it('names the newest shared case by default, else the newest case, and the review’s own pick when it has one (spec 5.4)', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const programId = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' })).programId;
    await partnerChange(deps, { kind: 'update', entity: 'partner', id: m.partnerId, patch: { programId } });
    const older = value(await createCase(deps, owner, { companyId, partnerId: m.partnerId })).caseId;
    const newer = value(await createCase(deps, owner, { companyId, partnerId: m.partnerId })).caseId;
    let read = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect(read.case?.caseId).toBe(newer);
    expect(read.caseOptions.map((c) => [c.caseId, c.shared])).toEqual([[newer, false], [older, false]]);
    expect(typeof read.targets.dealsWon).toBe('number');
    // What one deal is worth, so the page prefills what we bill from the deals won as they are typed.
    expect(read.perDeal).toEqual({ weBill: expect.any(Number), partnerEarns: expect.any(Number) });
    value(await shareCase(deps, owner, { caseId: older }));
    read = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect(read.case?.caseId).toBe(older);
    const reviewId = value(await openReview(deps, owner, { mapId: m.mapId })).review!.id;
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'review', id: reviewId, patch: { caseId: newer } }));
    expect(value(await readReview(deps, owner, { mapId: m.mapId })).case?.caseId).toBe(newer);
  });

  it('leaves out a linked market that can’t be read, says the questions are incomplete, and logs ids only', async () => {
    const deps = await setup();
    const lines: unknown[] = [];
    deps.log = (event, ids) => { lines.push([event, ids]); };
    const m = await withMap(deps);
    const { marketId, hypothesisId } = await linkHypothesis(deps, m.partnerId);
    const reviewId = value(await openReview(deps, owner, { mapId: m.mapId })).review!.id;
    expect(value(await readReview(deps, owner, { mapId: m.mapId })).hypothesesIncomplete).toBe(false);
    for (const error of ['unavailable', 'structure'] as const) {
      vi.spyOn(deps.markets, 'read').mockResolvedValueOnce({ ok: false, error, message: 'Austria SECRET' });
      const read = value(await readReview(deps, owner, { mapId: m.mapId }));
      expect(read).toMatchObject({ hypotheses: [], hypothesesIncomplete: true, review: { id: reviewId } });
      // The prep's question is still there: it is an item of the review.
      expect(read.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'hypothesis', refId: hypothesisId })]));
    }
    expect(lines).toContainEqual(['review_market_read_failed', { mapId: m.mapId, marketId, error: 'unavailable' }]);
    expect(JSON.stringify(lines)).not.toMatch(/SECRET|Austria/);
  });

  it('is refused for another person, a link holder, and a MAP that is not there', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    expect(await readReview(deps, stranger, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await readReview(deps, owner, { mapId: 'map_missing00' })).toMatchObject({ ok: false, error: 'file_not_found' });
    const link = await linkActor(deps, m.mapId, m.lena);
    expect(await readReview(deps, link, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await openReview(deps, link, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await listReviews(deps, link, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await readReview(deps, owner, { mapId: m.mapId, reviewId: 'rv_missing' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await readReview(deps, owner, { mapId: m.mapId, extra: 1 })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('openReview', () => {
  it('openReview makes one prep row with notDone items for open work and one hypothesis item per linked hypothesis', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { hypothesisId } = await linkHypothesis(deps, m.partnerId);
    const applyMany = vi.spyOn(deps.maps, 'applyMany');
    const read = value(await openReview(deps, owner, { mapId: m.mapId }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    const plan = await stored(deps, m.mapId);
    expect(plan.reviews).toEqual([expect.objectContaining({ id: read.review!.id, horizon: 1, state: 'prep', nextHorizonDays: 90, updatedBy: 'Ruth' })]);
    const items = plan.reviewItems;
    expect(items.every((i) => i.reviewId === read.review!.id)).toBe(true);
    expect(items.filter((i) => i.kind === 'notDone').map((i) => i.refId).sort()).toEqual([m.activities.before, m.activities.open].sort());
    expect(items.filter((i) => i.kind === 'hypothesis')).toEqual([expect.objectContaining({ refId: hypothesisId, answer: null })]);
    expect(read).toMatchObject({ status: { kind: 'coming', prepId: read.review!.id }, expectedUpdatedAt: TEST_NOW });
    expect(read.items).toEqual(items);
    expect(deps.events.events.filter((e) => e.command === 'reviews.open')).toEqual([
      expect.objectContaining({ entityIds: [m.mapId, read.review!.id], actorKind: 'owner' }),
    ]);
  });

  it('asks about "Why it fits" when no hypothesis is linked', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const read = value(await openReview(deps, owner, { mapId: m.mapId }));
    expect(read.items.filter((i) => i.kind === 'hypothesis')).toEqual([expect.objectContaining({ refId: null })]);
  });

  it('openReview twice gives the same review', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const first = value(await openReview(deps, owner, { mapId: m.mapId }));
    const plan = await stored(deps, m.mapId);
    const applyMany = vi.spyOn(deps.maps, 'applyMany');
    const second = value(await openReview(deps, owner, { mapId: m.mapId }));
    expect(second.review).toEqual(first.review);
    expect(second.items).toEqual(first.items);
    expect(applyMany).not.toHaveBeenCalled();
    expect(await stored(deps, m.mapId)).toEqual(plan);
  });

  it('two opens at once (a double click) end with one prep: the second takes its rows out again and gives the first', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const entry = (await deps.directory.map(m.mapId))!;
    const beforeOpen = await deps.maps.read({ fileId: entry.fileId });
    const first = value(await openReview(deps, owner, { mapId: m.mapId }));
    // The second open read the MAP before the first one's write landed.
    vi.spyOn(deps.maps, 'read').mockResolvedValueOnce(beforeOpen);
    const second = value(await openReview(deps, owner, { mapId: m.mapId }));
    expect(second.review?.id).toBe(first.review!.id);
    const plan = await stored(deps, m.mapId);
    expect(plan.reviews.map((r) => r.id)).toEqual([first.review!.id]);
    expect(plan.reviewItems.every((i) => i.reviewId === first.review!.id)).toBe(true);
    expect(deps.events.events.filter((e) => e.command === 'reviews.open')).toHaveLength(1);
  });

  it('gives the next horizon an offered length: the nearest to the current horizon’s, the longer one on a tie', async () => {
    for (const [horizonDays, expected] of [[45, 60], [365, 180], [90, 90]] as const) {
      const deps = await setup();
      const m = await withMap(deps);
      value(await change(deps, owner, m.mapId, { kind: 'updateInfo', patch: { horizonDays } }));
      expect(value(await openReview(deps, owner, { mapId: m.mapId })).review, String(horizonDays)).toMatchObject({ nextHorizonDays: expected });
    }
  });

  it('a linked market that can’t be read leaves the prep unwritten: a prep never misses a question', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    await linkHypothesis(deps, m.partnerId);
    const before = await stored(deps, m.mapId);
    vi.spyOn(deps.markets, 'read').mockResolvedValue({ ok: false, error: 'unavailable', message: 'Google isn’t answering' });
    expect(await openReview(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await stored(deps, m.mapId)).toEqual(before);
  });

  it('openReview before signing is refused', async () => {
    const deps = await setup();
    const m = await withMap(deps, { signed: false });
    const plan = await stored(deps, m.mapId);
    expect(value(await readReview(deps, owner, { mapId: m.mapId })).status).toEqual({ kind: 'none' });
    expect(await openReview(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'invalid', message: COPY.REVIEW_NOT_NOW });
    expect(await stored(deps, m.mapId)).toEqual(plan);
    expect(deps.events.events.filter((e) => e.command === 'reviews.open')).toEqual([]);
  });
});

// Owner, 2026-11-01: only the MAP's own rows count as MAP progress; preparing a review doesn't, so review prep never
// hides a stalled MAP. Closing a review starts a horizon and adds activities, which is MAP progress.
describe('review prep isn’t MAP progress', () => {
  const at = (day: string) => `2026-${day}T09:00:00.000Z`;
  const lastChange = async (deps: TestDeps, mapId: string) => (await deps.directory.map(mapId))!.lastChangeAt;
  const progress = async (deps: TestDeps, mapId: string) => value(await readMap(deps, owner, { mapId })).lastProgressAt;

  it('opening the prep and every change to a review, its numbers or its items leave the MAP’s last change as it was', async () => {
    const deps = await setup();
    deps.clock = () => at('10-20');
    const m = await withMap(deps);
    const before = await lastChange(deps, m.mapId);
    expect(before).toBe(at('10-20'));

    deps.clock = () => at('10-29');
    const read = value(await openReview(deps, owner, { mapId: m.mapId }));
    const reviewId = read.review!.id;
    expect(await lastChange(deps, m.mapId)).toBe(before);

    const reviewChanges: MapChange[] = [
      { kind: 'update', entity: 'review', id: reviewId, patch: { decisions: 'SECRET run the webinar again' } },
      { kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'dealsWon', actual: 2 } },
      { kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'blocker', title: 'SECRET no demo kit', side: 'us' } },
    ];
    for (const c of reviewChanges) {
      const out = value(await change(deps, owner, m.mapId, c));
      // The answer the page counts health from says so too.
      expect(out.lastProgressAt, JSON.stringify(c)).toBe(before);
    }
    const plan = await stored(deps, m.mapId);
    const number = plan.reviewNumbers[0]!.id;
    const blocker = plan.reviewItems.find((i) => i.kind === 'blocker')!.id;
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'reviewNumber', id: number, patch: { actual: 3 } }));
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'reviewItem', id: blocker, patch: { note: 'SECRET sandbox' } }));
    value(await change(deps, owner, m.mapId, { kind: 'delete', entity: 'reviewItem', id: blocker }));
    value(await change(deps, owner, m.mapId, { kind: 'delete', entity: 'reviewNumber', id: number }));
    expect(await lastChange(deps, m.mapId)).toBe(before);
    expect(await progress(deps, m.mapId)).toBe(before);
    // The writes themselves are still recorded, with ids only.
    expect(deps.events.events.filter((e) => e.command === 'maps.change')).toHaveLength(7);
  });

  it('a change to the MAP’s own rows during the prep is progress, and so is closing the review', async () => {
    const deps = await setup();
    deps.clock = () => at('10-20');
    const m = await withMap(deps);
    deps.clock = () => at('10-29');
    const { reviewId } = await withCommitment(deps, m);
    expect(await lastChange(deps, m.mapId)).toBe(at('10-20'));

    deps.clock = () => at('10-30');
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'activity', id: m.activities.open, patch: { note: 'SECRET called them' } }));
    expect(await lastChange(deps, m.mapId)).toBe(at('10-30'));

    deps.clock = () => at('10-31');
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: '2026-10-31' }));
    expect(await lastChange(deps, m.mapId)).toBe(at('10-31'));
    expect(await progress(deps, m.mapId)).toBe(at('10-31'));
  });
});

describe('closeReview', () => {
  it('closeReview starts the next horizon, adds the commitments as activities and marks the review held', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId, commitment } = await withCommitment(deps, m);
    // Held yesterday: the next horizon starts on the day it was held, not on the owner's today (spec 5.3 point 2).
    const out = value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: '2026-10-27' }));
    expect(out).toEqual({ suggestion: 'growth' });
    const plan = await stored(deps, m.mapId);
    expect(plan.info.laterHorizons).toEqual([{ startDate: '2026-10-27', horizonDays: 90 }]);
    expect(plan.info.nextReviewDate).toBeNull();
    expect(plan.activities.filter((a) => a.title === 'SECRET train five sellers')).toEqual([expect.objectContaining({
      side: 'partner', ownerId: m.lena, dueDate: '2026-12-15', status: 'not_started', updatedBy: 'Ruth',
    })]);
    expect(plan.reviews).toEqual([expect.objectContaining({ id: reviewId, state: 'held', heldOn: '2026-10-27' })]);
    expect(plan.reviewItems.find((i) => i.id === commitment)).toMatchObject({ moved: true });
    // Closing never moves the stage (People decide).
    expect(value(await readPartners(deps, owner, { companyId })).value.partners.find((p) => p.id === m.partnerId)).toMatchObject({ stage: 'onboarding' });
    // The MAP's last change and the partner row's summary follow the write.
    expect((await deps.directory.map(m.mapId))!.lastChangeAt).toBe(TEST_NOW);
    const read = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect(read.info.pastHorizons).toHaveLength(1);
    expect(read.review).toBeNull();
    expect(read.held.map((r) => r.id)).toEqual([reviewId]);
  });

  it('closeReview called twice: the second is refused and the MAP has one new horizon and each activity once', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    const after = await stored(deps, m.mapId);
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.REVIEW_ERR_ALREADY_HELD, fieldErrors: { reviewId: COPY.REVIEW_ERR_ALREADY_HELD } });
    const plan = await stored(deps, m.mapId);
    expect(plan).toEqual(after);
    expect(plan.info.laterHorizons).toHaveLength(1);
    expect(plan.activities.filter((a) => a.title === 'SECRET train five sellers')).toHaveLength(1);
    expect(deps.events.events.filter((e) => e.command === 'reviews.close')).toHaveLength(1);
  });

  it('closeReview with a failing MAP write leaves the review in prep and the MAP unchanged, and tells the person', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    const before = await stored(deps, m.mapId);
    vi.spyOn(deps.maps, 'applyMany').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Google isn’t answering' });
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toEqual({ ok: false, error: 'unavailable', message: 'Google isn’t answering' });
    expect(await stored(deps, m.mapId)).toEqual(before);
    expect((await stored(deps, m.mapId)).reviews[0]).toMatchObject({ state: 'prep' });
    expect(deps.events.events.filter((e) => e.command === 'reviews.close')).toEqual([]);
  });

  it('keeps the targets the review shows on its number rows, in the same write (spec 5.3 point 5)', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    await withCase(deps, m.partnerId);
    const { reviewId } = await withCommitment(deps, m);
    const shown = value(await readReview(deps, owner, { mapId: m.mapId })).targets;
    expect(typeof shown.dealsWon).toBe('number');
    const writes = vi.spyOn(deps.maps, 'applyMany');
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    expect(writes).toHaveBeenCalledTimes(1);
    const numbers = (await stored(deps, m.mapId)).reviewNumbers.filter((n) => n.reviewId === reviewId);
    expect(Object.fromEntries(numbers.map((n) => [n.key, n.target]))).toEqual({
      dealsWon: shown.dealsWon, weBill: shown.weBill, partnerEarns: shown.partnerEarns, recommend: 8,
    });
    // The held review reads them back as stored: a case changed later doesn't move them (spec 5.5).
    expect(value(await readReview(deps, owner, { mapId: m.mapId, reviewId })).numbers).toHaveLength(4);
  });

  it('keeps a target the person typed, and adds rows only for the keys that have a target', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    value(await change(deps, owner, m.mapId, { kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'recommend', target: 9, actual: 7 } }));
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    // No business case: recommend is the only target, and the typed 9 stays.
    const numbers = (await stored(deps, m.mapId)).reviewNumbers.filter((n) => n.reviewId === reviewId);
    expect(numbers.map((n) => [n.key, n.target, n.actual])).toEqual([['recommend', 9, 7]]);
  });

  it('a failing write leaves the review in prep and writes no target rows', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    await withCase(deps, m.partnerId);
    const { reviewId } = await withCommitment(deps, m);
    vi.spyOn(deps.maps, 'applyMany').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Google isn’t answering' });
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY })).toMatchObject({ ok: false, error: 'unavailable' });
    const plan = await stored(deps, m.mapId);
    expect(plan.reviews[0]).toMatchObject({ state: 'prep' });
    expect(plan.reviewNumbers).toEqual([]);
  });

  it('refuses a next horizon length typed by hand in the sheet that the MAP doesn’t offer, and writes nothing', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    expect(await change(deps, owner, m.mapId, { kind: 'update', entity: 'review', id: reviewId, patch: { nextHorizonDays: 45 } }))
      .toMatchObject({ ok: false, error: 'invalid' });
    // A hand edit of the Reviews tab reaches the file without the change schema.
    const entry = (await deps.directory.map(m.mapId))!;
    const handEdit = await deps.maps.apply({ fileId: entry.fileId }, {
      kind: 'update', entity: 'review', id: reviewId, patch: { nextHorizonDays: 45 },
      record: { partnerName: 'Acme', partnerType: 'reseller', stage: 'onboarding', signedDate: SIGNED, closed: null, closedReason: '' },
    }, { now: TEST_NOW, actor: 'Ruth' });
    expect(handEdit.ok).toBe(true);
    const before = await stored(deps, m.mapId);
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { nextHorizonDays: COPY.REVIEW_ERR_HORIZON_LENGTH } });
    expect(await stored(deps, m.mapId)).toEqual(before);
    expect(deps.events.events.filter((e) => e.command === 'reviews.close')).toEqual([]);
  });

  it('refuses a held-on date in the future or a commitment without a due date, with the field, and writes nothing', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId, commitment } = await withCommitment(deps, m);
    const before = await stored(deps, m.mapId);
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: '2026-10-29' }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { heldOn: COPY.REVIEW_ERR_HELD_FUTURE } });
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: '28 Oct' })).toMatchObject({ ok: false, error: 'invalid' });
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'reviewItem', id: commitment, patch: { dueDate: null } }));
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { [commitment]: COPY.REVIEW_ERR_NEEDS_DUE } });
    expect((await stored(deps, m.mapId)).info).toEqual(before.info);
  });

  it('marks the closed horizon’s business review milestone achieved on the held-on day, in the same write; the others stay', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    for (const name of ['Day 60: First joint opportunity', 'Day 90: First business review']) {
      value(await change(deps, owner, m.mapId, { kind: 'add', entity: 'milestone', values: { name, targetDate: '2026-11-12' } }));
    }
    const first = await withCommitment(deps, m);
    const writes = vi.spyOn(deps.maps, 'applyMany');
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId: first.reviewId, heldOn: '2026-10-27' }));
    expect(writes).toHaveBeenCalledTimes(1);
    const named = (plan: MapPlan, name: string) => plan.milestones.find((x) => x.name === name);
    let plan = await stored(deps, m.mapId);
    expect(named(plan, 'Day 90: First business review')).toMatchObject({ achievedDate: '2026-10-27' });
    expect(named(plan, 'Day 60: First joint opportunity')).toMatchObject({ achievedDate: null });

    // Horizon 2 started with its own milestones; closing its review marks its business review only.
    const second = value(await openReview(deps, owner, { mapId: m.mapId })).review!.id;
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId: second, heldOn: TODAY }));
    plan = await stored(deps, m.mapId);
    expect(named(plan, 'Horizon 2: Business review')).toMatchObject({ achievedDate: TODAY });
    expect(named(plan, 'Horizon 2: Day 30 check-in')).toMatchObject({ achievedDate: null });
    expect(named(plan, 'Horizon 3: Business review')).toMatchObject({ achievedDate: null });
  });

  it('closes when the business review milestone was copied by hand in the sheet, and marks neither copy', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    value(await change(deps, owner, m.mapId, { kind: 'add', entity: 'milestone', values: { name: 'Day 90: First business review' } }));
    const { reviewId } = await withCommitment(deps, m);
    // The copy reaches the file by hand (the memory store's file, as a hand edit of the sheet), past the name check.
    const entry = (await deps.directory.map(m.mapId))!;
    const files = (deps.maps as unknown as { files: Map<string, MapPlan> }).files;
    const file = files.get(entry.fileId)!;
    files.set(entry.fileId, { ...file, milestones: [...file.milestones, { ...file.milestones[0]!, id: 'm_copy00' }] });
    expect((await stored(deps, m.mapId)).milestones).toHaveLength(2);
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    expect((await stored(deps, m.mapId)).milestones.every((x) => x.achievedDate === null)).toBe(true);
  });

  it('closes when the MAP has a milestone named like a suggested one: that suggestion is left out', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    const [first] = horizonMilestones({ startDate: TODAY, horizonDays: 90, horizon: 2 });
    value(await change(deps, owner, m.mapId, { kind: 'add', entity: 'milestone', values: { name: first!.name.toLowerCase() } }));
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    const plan = await stored(deps, m.mapId);
    expect(plan.reviews[0]).toMatchObject({ state: 'held' });
    expect(plan.milestones.filter((x) => x.name.toLowerCase() === first!.name.toLowerCase())).toHaveLength(1);
  });

  it('refuses a commitment title longer than an activity title, keyed by the commitment, and writes nothing', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId, commitment } = await withCommitment(deps, m);
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'reviewItem', id: commitment, patch: { title: 'x'.repeat(301) } }));
    const before = await stored(deps, m.mapId);
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { [commitment]: COPY.REVIEW_ERR_TITLE_LONG } });
    expect(await stored(deps, m.mapId)).toEqual(before);
  });

  it('a store refusal of a commitment’s activity comes back keyed by the commitment', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId, commitment } = await withCommitment(deps, m);
    // The batch is: start the horizon, then one activity per commitment. The store refused the second change.
    vi.spyOn(deps.maps, 'applyMany').mockResolvedValueOnce({
      ok: false, error: 'invalid', message: 'Please fix the highlighted fields', fieldErrors: { title: 'Too long' }, valid: 1,
    });
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toEqual({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { [commitment]: 'Too long' } });
  });

  it('any other store refusal comes back as its message, with no field errors, so the dialog shows it', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    vi.spyOn(deps.maps, 'applyMany').mockResolvedValueOnce({
      ok: false, error: 'invalid', message: 'Please fix the highlighted fields', fieldErrors: { name: 'Another milestone is already called “Day 30”.' }, valid: 0,
    });
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toEqual({ ok: false, error: 'invalid', message: 'Another milestone is already called “Day 30”.' });
    vi.spyOn(deps.maps, 'applyMany').mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'Changed since you opened it', valid: 3 });
    expect(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }))
      .toEqual({ ok: false, error: 'conflict', message: 'Changed since you opened it' });
  });

  it('closeReview records ids only', async () => {
    const deps = await setup();
    const lines: unknown[] = [];
    deps.log = (event, ids) => { lines.push([event, ids]); };
    const m = await withMap(deps);
    await linkHypothesis(deps, m.partnerId);
    const { reviewId } = await withCommitment(deps, m);
    value(await change(deps, owner, m.mapId, {
      kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'dealsWon', actual: 31337, note: 'SECRET note' },
    }));
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'review', id: reviewId, patch: { decisions: 'SECRET decision' } }));
    deps.events.events.length = 0;
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    const entry = (await deps.directory.map(m.mapId))!;
    expect(deps.events.events.filter((e) => e.command === 'reviews.close')).toEqual([{
      id: expect.any(String), at: TEST_NOW, command: 'reviews.close', actorKind: 'owner', actorUserId: 'u1', fileId: entry.fileId,
      entityIds: [m.mapId, reviewId],
    }]);
    value(await readReview(deps, owner, { mapId: m.mapId, reviewId }));
    value(await listReviews(deps, owner, { companyId }));
    const text = JSON.stringify([deps.events.events, lines]);
    expect(text).not.toMatch(/SECRET|31337|Acme|Lena|example\.com|Austria/);
  });
});

describe('access', () => {
  it('an agent at level change may openReview; closeReview by an agent is forbidden', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const read = value(await openReview(deps, agent('change'), { mapId: m.mapId }));
    expect(read.review).toMatchObject({ state: 'prep', updatedBy: 'Desk Agent for Ruth' });
    value(await change(deps, agent('change'), m.mapId, {
      kind: 'add', entity: 'reviewItem', values: { reviewId: read.review!.id, kind: 'blocker', title: 'No demo kit', side: 'us' },
    }));
    const before = await stored(deps, m.mapId);
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(await closeReview(deps, agent(level), { mapId: m.mapId, reviewId: read.review!.id, heldOn: TODAY }))
        .toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(await stored(deps, m.mapId)).toEqual(before);
    for (const level of ['read', 'propose'] as const) {
      expect(value(await readReview(deps, agent(level), { mapId: m.mapId })).review?.id).toBe(read.review!.id);
    }
    expect(await openReview(deps, agent('read'), { mapId: m.mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    // A propose agent may do all a change agent may (agent proposals spec 5.2): the prep is open already, so it gets that one.
    expect(value(await openReview(deps, agent('propose'), { mapId: m.mapId })).review?.id).toBe(read.review!.id);
    expect(await closeReview(deps, stranger, { mapId: m.mapId, reviewId: read.review!.id, heldOn: TODAY })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('an agent at level read may not open a review that has no prep yet, and nothing is written', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const before = await stored(deps, m.mapId);
    expect(await openReview(deps, agent('read'), { mapId: m.mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await stored(deps, m.mapId)).toEqual(before);
  });
});

describe('readReview when no review can be held and none was', () => {
  it('reads no business case and no market, with the same shape as a full read', async () => {
    const deps = await setup();
    const m = await withMap(deps, { signed: false });
    await withCase(deps, m.partnerId);
    await linkHypothesis(deps, m.partnerId);
    const cases = vi.spyOn(deps.cases, 'read');
    const caseList = vi.spyOn(deps.directory, 'businessCases');
    const markets = vi.spyOn(deps.markets, 'read');
    const read = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect([cases, caseList, markets].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect(read).toMatchObject({
      status: { kind: 'none' }, review: null, held: [], heldAnswers: {}, case: null, caseOptions: [], hypotheses: [],
      hypothesesIncomplete: false, caseAgainstActual: null, caseCurrency: null, perDeal: null, expectedUpdatedAt: '',
    });
    // The same fields as once signed, when the case and the market are read.
    await partnerChange(deps, { kind: 'markSigned', partnerId: m.partnerId, signedDate: SIGNED });
    const full = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect(Object.keys(read).sort()).toEqual(Object.keys(full).sort());
    expect(cases).toHaveBeenCalled();
    expect(markets).toHaveBeenCalled();
  });
});

describe('Review Focus 3: the partnership changes under an open prep', () => {
  it('after undo signing, readReview gives status none and openReview is refused', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    value(await openReview(deps, owner, { mapId: m.mapId }));
    await partnerChange(deps, { kind: 'undoSigned', partnerId: m.partnerId });
    const plan = await stored(deps, m.mapId);
    const read = value(await readReview(deps, owner, { mapId: m.mapId }));
    expect(read.status).toEqual({ kind: 'none' });
    expect(read.review).toBeNull();
    expect(await openReview(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'invalid', message: COPY.REVIEW_NOT_NOW });
    expect(await stored(deps, m.mapId)).toEqual(plan);
  });

  it('gives each held review its hypothesis answers, and none for an unanswered one', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { hypothesisId } = await linkHypothesis(deps, m.partnerId);
    const { reviewId } = await withCommitment(deps, m);
    const item = (await stored(deps, m.mapId)).reviewItems.find((i) => i.kind === 'hypothesis' && i.refId === hypothesisId)!;
    expect(value(await readReview(deps, owner, { mapId: m.mapId })).heldAnswers).toEqual({});
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'reviewItem', id: item.id, patch: { answer: 'changed' } }));
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    expect(value(await readReview(deps, owner, { mapId: m.mapId })).heldAnswers).toEqual({ [reviewId]: ['changed'] });
  });

  it('a held review is still readable after the exit', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withCommitment(deps, m);
    value(await closeReview(deps, owner, { mapId: m.mapId, reviewId, heldOn: TODAY }));
    await partnerChange(deps, { kind: 'markExited', partnerId: m.partnerId, exitedDate: TODAY, reason: 'Moved on' });
    const read = value(await readReview(deps, owner, { mapId: m.mapId, reviewId }));
    expect(read.status).toEqual({ kind: 'none' });
    expect(read.review).toMatchObject({ id: reviewId, state: 'held', heldOn: TODAY });
    expect(read.items.some((i) => i.kind === 'commitment')).toBe(true);
    // The held review's own horizon's work: the activities of horizon 1, not the new one's.
    expect(read.work.map((a) => a.id)).toContain(m.activities.open);
    expect(await openReview(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('a partner type taken out of Partners: the review is not found, and nothing crashes', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    value(await openReview(deps, owner, { mapId: m.mapId }));
    const book = deps.directory.books.get(companyId)!;
    const read = await deps.partnerBooks.read({ fileId: book.fileId });
    if (!read.ok) throw new Error('setup');
    vi.spyOn(deps.partnerBooks, 'read').mockResolvedValue({
      ...read, snapshot: { ...read.snapshot, value: { ...read.snapshot.value, partners: [] } },
    });
    expect(await readReview(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, message: COPY.MAP_TYPE_GONE });
    expect(value(await listReviews(deps, owner, { companyId }))).toEqual([]);
  });
});

describe('listReviews', () => {
  it('lists each MAP’s next review and its held ones, and an unreadable MAP as later with no date', async () => {
    const deps = await setup();
    const signed = await withMap(deps);
    const { reviewId } = await withCommitment(deps, signed);
    value(await closeReview(deps, owner, { mapId: signed.mapId, reviewId, heldOn: TODAY }));
    const unsigned = await withMap(deps, { signed: false, partnerType: 'referral', company: 'Brightwave' });
    const prepped = await withMap(deps, { partnerType: 'technology', company: 'Corvid' });
    const prepId = value(await openReview(deps, owner, { mapId: prepped.mapId })).review!.id;
    const broken = await withMap(deps, { partnerType: 'affiliate', company: 'Delta' });
    const brokenFile = (await deps.directory.map(broken.mapId))!.fileId;
    const read = deps.maps.read.bind(deps.maps);
    vi.spyOn(deps.maps, 'read').mockImplementation(async (ref) =>
      (ref.fileId === brokenFile ? { ok: false, error: 'unavailable', message: 'x' } : read(ref)));
    deps.events.events.length = 0;

    const lines = value(await listReviews(deps, owner, { companyId }));
    const of = (mapId: string) => lines.filter((l) => l.mapId === mapId);
    expect(of(signed.mapId)).toEqual(expect.arrayContaining([
      { mapId: signed.mapId, partnerId: signed.partnerId, displayName: 'Acme as reseller', horizon: 1, date: TODAY, state: 'held', reviewId, heldOn: TODAY },
      // The new horizon (90 days from TODAY) ends on 2027-01-25: its review is later.
      { mapId: signed.mapId, partnerId: signed.partnerId, displayName: 'Acme as reseller', horizon: 2, date: '2027-01-25', state: 'later', reviewId: null, heldOn: null },
    ]));
    expect(of(signed.mapId)).toHaveLength(2);
    expect(of(unsigned.mapId)).toEqual([]);
    expect(of(prepped.mapId)).toEqual([expect.objectContaining({ horizon: 1, date: REVIEW_DATE, state: 'coming', reviewId: prepId })]);
    expect(of(broken.mapId)).toEqual([{
      mapId: broken.mapId, partnerId: broken.partnerId, displayName: 'Delta as affiliate partner', horizon: 0, date: null, state: 'later', reviewId: null,
      heldOn: null, unreadable: true,
    }]);
    expect(deps.events.events).toEqual([]); // a read leaves no event (owner, 2026-11-14)
    expect(await listReviews(deps, owner, { companyId: 'nope' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await listReviews(deps, stranger, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await listReviews(deps, stranger, { companyId: 'co_bbbbbbbbbb' }))).toEqual([]);
  });

  it('a review with prep started that is not coming up yet is listed as prep', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    // A 180-day horizon: the review is months away, but its prep can start.
    value(await change(deps, owner, m.mapId, { kind: 'updateInfo', patch: { horizonDays: 180 } }));
    const prepId = value(await openReview(deps, owner, { mapId: m.mapId })).review!.id;
    expect(value(await listReviews(deps, owner, { companyId }))).toEqual([
      expect.objectContaining({ mapId: m.mapId, state: 'prep', reviewId: prepId, date: '2027-02-10' }),
    ]);
  });

  it('with a partnerId, lists that partner type’s reviews and reads only its MAP', async () => {
    const deps = await setup();
    const asked = await withMap(deps);
    const other = await withMap(deps, { partnerType: 'technology', company: 'Corvid' });
    const askedFile = (await deps.directory.map(asked.mapId))!.fileId;
    const mapRead = vi.spyOn(deps.maps, 'read');
    deps.events.events.length = 0;

    const lines = value(await listReviews(deps, owner, { companyId, partnerId: asked.partnerId }));
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((l) => l.mapId))).toEqual(new Set([asked.mapId]));
    expect(new Set(lines.map((l) => l.partnerId))).toEqual(new Set([asked.partnerId]));
    expect(lines.some((l) => l.mapId === other.mapId)).toBe(false);
    expect(mapRead.mock.calls.map(([ref]) => ref.fileId)).toEqual([askedFile]);
    expect(deps.events.events).toEqual([]);

    // A partner type with no MAP lists nothing and reads no MAP; an empty partnerId is refused.
    mapRead.mockClear();
    expect(value(await listReviews(deps, owner, { companyId, partnerId: 'pt_nomap00000' }))).toEqual([]);
    expect(mapRead).not.toHaveBeenCalled();
    expect(await listReviews(deps, owner, { companyId, partnerId: '' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('the package', () => {
  it('exports the review commands', () => {
    for (const command of ['readReview', 'openReview', 'closeReview', 'listReviews']) expect(commandsPackage).toHaveProperty(command);
  });
});
