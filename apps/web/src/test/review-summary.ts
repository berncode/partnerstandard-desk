// A held review with a summary link, built through the commands on their memory dependencies, for the summary page's
// tests (reviews spec 5.6). Every text that must stay ours is a marker found nowhere else.
import {
  changeMap, changeMarket, changePartner, closeReview, createMarket, openReview, readCompanyFacts, readPartners, shareSummary, startMap,
  type Actor, type ShareDeps,
} from '@partner-desk/commands';
import { makeTestDeps, TEST_NOW } from '@partner-desk/commands/testing';
import type { MapChange } from '@partner-desk/core';

export const SUMMARY_OWNER: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
export const SUMMARY_TODAY = TEST_NOW.slice(0, 10);

/** What the review holds that is ours alone: never on the summary page. */
export const OURS_ONLY = {
  hypothesis: 'OURS-HYPOTHESIS-7d1a', answerNote: 'OURS-ANSWER-NOTE-2b9c', decisions: 'OURS-DECISIONS-5e3f',
  relationship: 'OURS-RELATIONSHIP-8a4d', numberNote: 'OURS-NUMBER-NOTE-1c6e', whyItFits: 'OURS-WHY-IT-FITS-9f2b',
};

/** The numbers the review holds: on the page only with "Include the scorecard". */
export const NUMBERS = { dealsWon: 37, dealsTarget: 41, recommend: 9 };

const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** Acme as reseller with a MAP, its first review held on TODAY, and its summary sent to Lena with or without the scorecard. */
export async function heldReviewWithLink({ includeScorecard }: { includeScorecard: boolean }) {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  const owner = SUMMARY_OWNER;
  await deps.companies.rename('u1', 'Halden');
  await readPartners(deps, owner, { companyId });
  await readCompanyFacts(deps, owner, { companyId });
  const partner = async (change: Record<string, unknown>) => value(await changePartner(deps, owner, { companyId, change }));
  const accountId = (await partner({ kind: 'add', entity: 'account', values: { company: 'Acme' } })).entityId!;
  const partnerId = (await partner({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller', whyItFits: OURS_ONLY.whyItFits } })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const map = async (change: MapChange) => value(await changeMap(deps, owner, { mapId, change })).entityId!;
  const lena = await map({ kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' } });
  const open = await map({ kind: 'add', entity: 'activity', values: { title: 'Run the webinar', side: 'partner', dueDate: '2026-09-01' } });
  await map({ kind: 'add', entity: 'activity', values: { title: 'Sign the reseller terms', side: 'joint', dueDate: '2026-09-10', status: 'done' } });
  await partner({ kind: 'markSigned', partnerId, signedDate: '2026-08-15' });
  const market = value(await createMarket(deps, owner, {
    companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const hypothesisId = value(await changeMarket(deps, owner, {
    marketId: market.marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: OURS_ONLY.hypothesis } },
  })).entityId!;
  await partner({ kind: 'add', entity: 'marketLink', values: { partnerId, marketId: market.marketId, hypothesisId } });

  const read = value(await openReview(deps, owner, { mapId }));
  const reviewId = read.review!.id;
  const reason = read.items.find((i) => i.kind === 'notDone' && i.refId === open)!;
  const question = read.items.find((i) => i.kind === 'hypothesis')!;
  await map({ kind: 'update', entity: 'reviewItem', id: reason.id, patch: { note: 'Waiting on their legal team' } });
  await map({ kind: 'update', entity: 'reviewItem', id: question.id, patch: { answer: 'doesnt_hold', note: OURS_ONLY.answerNote } });
  await map({ kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'commitment', title: 'Train five sellers', side: 'partner', ownerId: lena, dueDate: '2026-12-15' } });
  await map({ kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'blocker', title: 'No demo account', side: 'us', note: 'We owe them a sandbox' } });
  await map({ kind: 'update', entity: 'review', id: reviewId, patch: { decisions: OURS_ONLY.decisions, relationshipNote: OURS_ONLY.relationship } });
  await map({
    kind: 'add', entity: 'reviewNumber',
    values: { reviewId, key: 'dealsWon', actual: NUMBERS.dealsWon, target: NUMBERS.dealsTarget, source: 'finance', note: OURS_ONLY.numberNote },
  });
  await map({ kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'recommend', actual: NUMBERS.recommend } });
  value(await closeReview(deps, owner, { mapId, reviewId, heldOn: SUMMARY_TODAY }));
  // The email itself is the mail's job (review-summary-mail.ts): here it only keeps the token and reaches everyone.
  let token = '';
  value(await shareSummary(deps, owner, { mapId, reviewId, personIds: [lena], includeScorecard }, async (send, t) => {
    token = t;
    return send.to.map((to) => to.personId);
  }));

  const share: ShareDeps = {
    shareLinks: deps.shareLinks, reviewLinks: deps.reviewLinks, directory: deps.directory, companies: deps.companies,
    casesFor: async (userId) => (userId === 'u1' ? deps.cases : null),
    partnerBooksFor: async (userId) => (userId === 'u1' ? deps.partnerBooks : null),
    mapsFor: async (userId) => (userId === 'u1' ? deps.maps : null),
    ownerName: async (userId) => (userId === 'u1' ? 'Ruth' : null),
    log: () => {},
  };
  return { deps, share, token, mapId, reviewId, lena };
}
