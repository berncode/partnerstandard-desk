import type { Hypothesis } from '@partner-desk/core';
import { aPartner as partner, anAccount, call, marketLink, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { describe, expect, it } from 'vitest';
import {
  endStateOf, hypothesisHolds, marketsToAdd, movesToDiscoveryCall, oldPartnerAddress, partnerCalls, partnerHref, partnerRecommendation,
  pasteRefusal, pastRecruitment, proceedProblem, sectionForType, stageBoxes, stepPills, stepperHint, usedValues, type MarketState,
} from './partner-model';

const hypothesis = (over: Partial<Hypothesis>): Hypothesis => ({ ...sampleMarket().hypotheses[0]!, ...over });
const signed = partner({ stage: 'onboarding', step: null, signedDate: '2026-09-15' });

describe('partnerHref', () => {
  it('opens the company, or one partner type', () => {
    expect(partnerHref('a_abc123')).toBe('/partners/a_abc123');
    expect(partnerHref('a_abc123', 'reseller')).toBe('/partners/a_abc123?type=reseller');
    expect(partnerHref('a b', 'co-seller')).toBe('/partners/a%20b?type=co-seller');
  });
});

describe('oldPartnerAddress', () => {
  it('sends an old address that names a partner type to its company’s page on that type', () => {
    const book = sampleBook({ partners: [partner(), partner({ id: 'p_tech', partnerType: 'technology' })] });
    expect(oldPartnerAddress(book, 'p_tech')).toBe('/partners/a_abc123?type=technology');
    expect(oldPartnerAddress(book, 'a_abc123')).toBeNull();
    expect(oldPartnerAddress(book, 'p_unknown')).toBeNull();
  });
});

describe('sectionForType', () => {
  it('uses the type in the address, else the first partner type', () => {
    const reseller = partner();
    const technology = partner({ id: 'p_tech', partnerType: 'technology' });
    expect(sectionForType([reseller, technology], 'technology')?.id).toBe('p_tech');
    expect(sectionForType([reseller, technology], null)?.id).toBe(reseller.id);
    expect(sectionForType([reseller], 'nope')?.id).toBe(reseller.id);
    expect(sectionForType([], 'reseller')).toBeUndefined();
  });
});

describe('partnerRecommendation', () => {
  it('is the confirmed check once all four Cs are scored, else the desk check', () => {
    expect(partnerRecommendation(partner())?.text).toBe('Worth a discovery call');
    const confirmed = { customerBase: 2, credibility: 2, capability: 2, commitment: 3 } as const;
    expect(partnerRecommendation(partner({ confirmed }))?.text).toBe('Proceed');
    const none = { customerBase: null, credibility: null, capability: null, commitment: null };
    expect(partnerRecommendation(partner({ desk: none }))).toBeNull();
  });
});

describe('endStateOf', () => {
  it('tells recruiting, closed, signed and exited apart', () => {
    expect(endStateOf(partner())).toBe('recruiting');
    expect(endStateOf(partner({ closed: 'no', closedReason: 'Not a fit' }))).toBe('closed');
    expect(endStateOf(signed)).toBe('signed');
    expect(endStateOf({ ...signed, stage: 'exit' })).toBe('signed');
    expect(endStateOf({ ...signed, stage: 'exit', exitedDate: '2026-10-21' })).toBe('exited');
  });
});

describe('stepPills', () => {
  it('blocks every other step with the read-only line it is given: a company server’s "Sign in again" (plan 14)', () => {
    const pills = stepPills(partner({ step: 'discovery_call' }), true, 'Sign in again to keep editing.');
    expect(pills.filter((pill) => pill.state !== 'current').map((pill) => pill.blocked)).toEqual(Array(pills.length - 1).fill('Sign in again to keep editing.'));
    const boxes = stageBoxes(partner({ stage: 'onboarding', step: null, signedDate: '2026-09-15' }), true, 'Sign in again to keep editing.');
    const movable = boxes.filter((box) => box.movable);
    expect(movable.length).toBeGreaterThan(0);
    expect(movable.every((box) => box.blocked === 'Sign in again to keep editing.')).toBe(true);
  });

  it('lets a step move one at a time and says why the others cannot', () => {
    const pills = stepPills(partner({ step: 'discovery_call' }), false);
    expect(pills.map((p) => [p.step, p.state, p.blocked])).toEqual([
      ['researched', 'done', null],
      ['discovery_call', 'current', null],
      ['qualification', 'later', null],
      ['map', 'later', 'Move one step at a time.'],
    ]);
  });

  it('blocks every step while closed, after signing and while read-only', () => {
    expect(stepPills(partner({ closed: 'not_now' }), false).filter((p) => p.state !== 'current').map((p) => p.blocked))
      .toEqual(Array(3).fill('Reopen this partner before you move it.'));
    expect(stepPills(signed, false).every((p) => p.state === 'done' && p.blocked !== null)).toBe(true);
    expect(stepPills(partner(), true).every((p) => p.state === 'current' || p.blocked !== null)).toBe(true);
  });
});

describe('stageBoxes', () => {
  it('before signing, only Recruitment is current and no stage can be chosen', () => {
    const boxes = stageBoxes(partner(), false);
    expect(boxes.map((b) => [b.stage, b.state, b.movable])).toEqual([
      ['recruitment', 'current', false],
      ['onboarding', 'later', false],
      ['growth', 'later', false],
      ['expansion', 'later', false],
      ['exit', 'later', false],
    ]);
  });

  it('after signing, the neighbors can be chosen, never Recruitment', () => {
    const growth = { ...signed, stage: 'growth' as const };
    const boxes = stageBoxes(growth, false);
    expect(boxes.map((b) => [b.stage, b.state, b.movable, b.blocked])).toEqual([
      ['recruitment', 'done', false, null],
      ['onboarding', 'done', true, null],
      ['growth', 'current', false, null],
      ['expansion', 'later', true, null],
      ['exit', 'later', true, 'Move one stage at a time.'],
    ]);
    expect(stageBoxes(signed, false).find((b) => b.stage === 'onboarding')?.state).toBe('current');
  });

  it('signed straight from Researched: Recruitment done, Onboarding current, the rest later', () => {
    const fromResearched = { ...partner({ step: 'researched' }), step: null, stage: 'onboarding' as const, signedDate: '2026-09-15' };
    expect(stageBoxes(fromResearched, false).map((b) => [b.stage, b.state])).toEqual([
      ['recruitment', 'done'], ['onboarding', 'current'], ['growth', 'later'], ['expansion', 'later'], ['exit', 'later'],
    ]);
  });

  it('signed, then moved to Growth: earlier stages done, Growth current', () => {
    const growth = { ...signed, stage: 'growth' as const };
    expect(stageBoxes(growth, false).map((b) => [b.stage, b.state])).toEqual([
      ['recruitment', 'done'], ['onboarding', 'done'], ['growth', 'current'], ['expansion', 'later'], ['exit', 'later'],
    ]);
  });

  it('exited: only Recruitment and Exit are done, the middle stages are plain (the stage it left from is not recorded)', () => {
    const exited = { ...signed, stage: 'exit' as const, exitedDate: '2026-10-21' };
    expect(stageBoxes(exited, false).map((b) => [b.stage, b.state])).toEqual([
      ['recruitment', 'done'], ['onboarding', 'plain'], ['growth', 'plain'], ['expansion', 'plain'], ['exit', 'done'],
    ]);
  });

  it('after the exit, nothing moves; read-only blocks every move', () => {
    const exited = { ...signed, stage: 'exit' as const, exitedDate: '2026-10-21' };
    expect(stageBoxes(exited, false).some((b) => b.movable)).toBe(false);
    expect(stageBoxes(signed, true).filter((b) => b.movable).every((b) => b.blocked !== null)).toBe(true);
  });
});

describe('pastRecruitment', () => {
  it('is true once signed or exited, even with no signed date, and false while recruiting or closed', () => {
    expect(pastRecruitment(signed)).toBe(true);
    expect(pastRecruitment({ ...partner(), step: null, stage: 'exit', signedDate: null, exitedDate: '2026-10-21' })).toBe(true);
    expect(pastRecruitment(partner())).toBe(false);
    expect(pastRecruitment(partner({ closed: 'no' }))).toBe(false);
  });
});

describe('stepperHint', () => {
  it('says in words why the disabled steps and stages are disabled', () => {
    expect(stepperHint(partner(), false)).toBe('Move one step at a time. Mark signed moves a partner to Onboarding.');
    expect(stepperHint(partner({ closed: 'no' }), false)).toBe('Reopen this partner before you move it.');
    expect(stepperHint(signed, false)).toBe("Move one stage at a time. A signed partner can't go back to recruitment.");
    expect(stepperHint({ ...signed, exitedDate: '2026-10-21', stage: 'exit' }, false)).toBeNull();
    expect(stepperHint(partner(), true)).toBeNull();
  });
});

describe('proceedProblem', () => {
  it('lets Proceed to MAP work from Qualification only, and names where the partner is', () => {
    expect(proceedProblem(partner({ step: 'qualification' }), 'Acme GmbH')).toBeNull();
    expect(proceedProblem(partner({ step: 'discovery_call' }), 'Acme GmbH'))
      .toBe('Proceed to MAP works from Qualification. Acme GmbH is at Discovery call.');
    expect(proceedProblem(partner({ step: 'qualification', closed: 'not_now' }), 'Acme GmbH')).toBe('Reopen this partner before you move it.');
  });
});

describe('calls', () => {
  const book = sampleBook({
    calls: [
      call({ id: 'k_1', date: '2026-10-01' }), call({ id: 'k_2', date: '2026-10-09' }), call({ id: 'k_3', date: '2026-10-01' }),
      call({ id: 'k_x', partnerId: 'p_other', date: '2026-10-20' }),
    ],
  });

  it('lists a partner’s calls newest first, the later row first on the same day', () => {
    expect(partnerCalls(book, 'p_abc123').map((c) => c.id)).toEqual(['k_2', 'k_3', 'k_1']);
  });

  it('offers the move to Discovery call only for the first discovery call of a researched partner', () => {
    const empty = sampleBook({ calls: [] });
    expect(movesToDiscoveryCall(empty, 'p_abc123', 'discovery')).toBe(true);
    expect(movesToDiscoveryCall(empty, 'p_abc123', 'follow_up')).toBe(false);
    expect(movesToDiscoveryCall(book, 'p_abc123', 'discovery')).toBe(false);
    const later = sampleBook({ partners: [partner({ step: 'qualification' })], calls: [] });
    expect(movesToDiscoveryCall(later, 'p_abc123', 'discovery')).toBe(false);
  });

  it('names the section a refused paste is too long in', () => {
    expect(pasteRefusal('customerPains')).toBe('Customer Pains: This is longer than a sheet cell can hold. Shorten it, or split it over two calls.');
    expect(pasteRefusal('notes')).toMatch(/^Other notes: /);
  });
});

describe('usedValues', () => {
  it('suggests the verticals already used, once each, sorted', () => {
    const book = sampleBook({
      accounts: [anAccount({ vertical: 'Security' }), anAccount({ id: 'a_2', vertical: ' Managed IT ' }), anAccount({ id: 'a_3', vertical: 'Security' })],
    });
    expect(usedValues(book, 'vertical')).toEqual(['Managed IT', 'Security']);
  });
});

describe('markets', () => {
  const markets = [
    { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
    { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
    { marketId: 'm_c', displayName: 'Italy · Reseller', archived: true },
    { marketId: 'm_d', displayName: 'Spain · Distributor', archived: false },
  ];

  it('offers the open markets of the partner’s type it is not in yet', () => {
    const book = sampleBook({ marketLinks: [marketLink({ marketId: 'm_a' })] });
    expect(marketsToAdd(book, markets, partner()).map((m) => m.marketId)).toEqual(['m_b']);
  });

  it('a partner hypothesis holds when one of its markets links one that holds', () => {
    const holds = sampleMarket({ hypotheses: [hypothesis({ id: 'h_1', status: 'holds' })] });
    const draft = sampleMarket({ hypotheses: [hypothesis({ id: 'h_1', status: 'draft' })] });
    const linked = sampleBook({ marketLinks: [marketLink({ marketId: 'm_a', hypothesisId: 'h_1' })] });
    const ready = (market: typeof holds): Record<string, MarketState> => ({ m_a: { status: 'ready', market } });
    expect(hypothesisHolds(linked, 'p_abc123', ready(holds))).toBe(true);
    expect(hypothesisHolds(linked, 'p_abc123', ready(draft))).toBe(false);
    expect(hypothesisHolds(linked, 'p_abc123', {})).toBe(false);
    expect(hypothesisHolds(sampleBook({ marketLinks: [marketLink({ marketId: 'm_a' })] }), 'p_abc123', ready(holds))).toBe(false);
  });
});
