import { describe, expect, it } from 'vitest';
import { FOUR_C } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { checkClose, checkCorrectExit, checkExit, checkUndoSigned, checkSign, checkStage, checkStep, signNudge, stepNudge } from './lifecycle';
import type { Partner, Score, Scores } from './types';

const NONE = { customerBase: null, credibility: null, capability: null, commitment: null };
const S = (a: (Score | null)[]) => Object.fromEntries(FOUR_C.map((c, i) => [c, a[i]])) as Scores;
function partner(over: Partial<Partner> = {}): Partner {
  return {
    id: 'p_abc123', companyId: 'co_abcdefghij', accountId: 'a_abc123', partnerType: 'reseller', stage: 'recruitment',
    step: 'researched', closed: null, closedReason: '', signedDate: null, exitedDate: null, exitReason: '',
    source: 'research', sourceDetail: '', whyItFits: '', desk: NONE, confirmed: NONE, mapFilled: false, mapLink: '',
    programId: null, level: null, mapHealth: null, mapNextMilestone: null, updatedAt: null, updatedBy: 'Claude for Ruth', ...over,
  };
}
const signed = (over: Partial<Partner> = {}) =>
  partner({ stage: 'onboarding', step: null, signedDate: '2026-01-01', ...over });
const fail = (message: string) => ({ ok: false, message });

describe('checkStep', () => {
  it('allows one step forward', () => {
    expect(checkStep(partner({ step: 'researched' }), 'discovery_call')).toEqual({ ok: true });
  });
  it('refuses skipping a step', () => {
    expect(checkStep(partner({ step: 'researched' }), 'qualification')).toEqual(fail(COPY.ONE_STEP));
  });
  it('allows a step back', () => {
    expect(checkStep(partner({ step: 'map' }), 'qualification')).toEqual({ ok: true });
  });
  it('allows any first step for a partner without one', () => {
    expect(checkStep(partner({ step: null }), 'researched')).toEqual({ ok: true });
  });
  it('refuses a step outside recruitment', () => {
    expect(checkStep(signed(), 'map')).toEqual(fail(COPY.STEP_ONLY_IN_RECRUITMENT));
  });
  it('refuses a step on a closed partner, and says to reopen it', () => {
    expect(checkStep(partner({ closed: 'no', closedReason: 'x' }), 'discovery_call')).toEqual(fail(COPY.REOPEN_BEFORE_STEP));
  });
});

describe('stepNudge', () => {
  it('asks for the hypothesis before qualification unless it holds', () => {
    const p = partner({ step: 'discovery_call' });
    expect(stepNudge(p, 'qualification', { hypothesisHolds: false })).toBe(COPY.HYPOTHESIS_FIRST);
    expect(stepNudge(p, 'qualification', { hypothesisHolds: true })).toBeNull();
  });
  it('asks for all four Cs before the MAP step', () => {
    const p = partner({ step: 'qualification', confirmed: S([2, 2, 3, null]) });
    expect(stepNudge(p, 'map', { hypothesisHolds: true })).toBe(COPY.CONFIRM_FIRST);
  });
  it('gives the confirmed advice before the MAP step, and none on proceed', () => {
    expect(stepNudge(partner({ step: 'qualification', confirmed: S([2, 1, 3, 1]) }), 'map', { hypothesisHolds: true }))
      .toBe('Not now, or follow up to fill the gaps: Credibility, Commitment');
    expect(stepNudge(partner({ step: 'qualification', confirmed: S([2, 2, 3, 2]) }), 'map', { hypothesisHolds: true })).toBeNull();
  });
  it('gives no advice going back or to other steps', () => {
    expect(stepNudge(partner({ step: 'map' }), 'qualification', { hypothesisHolds: false })).toBeNull();
    expect(stepNudge(partner({ step: 'researched' }), 'discovery_call', { hypothesisHolds: false })).toBeNull();
  });
});

describe('signing', () => {
  it('nudges before signing without an agreed MAP, and lets it through', () => {
    const p = partner({ step: 'map', mapFilled: false });
    expect(signNudge(p)).toBe(COPY.MAP_BEFORE_SIGNING);
    expect(checkSign(p)).toEqual({ ok: true });
    expect(signNudge(partner({ step: 'map', mapFilled: true }))).toBeNull();
  });
  it('refuses signing a closed partner', () => {
    expect(checkSign(partner({ closed: 'not_now', closedReason: 'x' }))).toEqual(fail(COPY.REOPEN_BEFORE_SIGNING));
  });
  it('refuses signing an already signed partner', () => {
    expect(checkSign(signed())).toEqual(fail(COPY.ALREADY_SIGNED));
  });
  it('refuses signing an exited partner', () => {
    expect(checkSign(signed({ stage: 'exit', exitedDate: '2026-06-01' }))).toEqual(fail(COPY.ALREADY_SIGNED));
  });
});

describe('checkStage', () => {
  it('allows one stage forward and back after signing', () => {
    expect(checkStage(signed({ stage: 'onboarding' }), 'growth')).toEqual({ ok: true });
    expect(checkStage(signed({ stage: 'growth' }), 'onboarding')).toEqual({ ok: true });
    expect(checkStage(signed({ stage: 'expansion' }), 'exit')).toEqual({ ok: true });
  });
  it('refuses a stage move back to recruitment', () => {
    expect(checkStage(signed(), 'recruitment')).toEqual(fail(COPY.NO_BACK_TO_RECRUITMENT));
  });
  it('refuses skipping a stage', () => {
    expect(checkStage(signed({ stage: 'onboarding' }), 'expansion')).toEqual(fail(COPY.ONE_STAGE));
  });
  it('refuses a stage move before signing', () => {
    expect(checkStage(partner(), 'onboarding')).toEqual(fail(COPY.SIGN_BEFORE_STAGE));
  });
  it('refuses a stage move after the exit is done', () => {
    expect(checkStage(signed({ stage: 'exit', exitedDate: '2026-06-01', exitReason: 'x' }), 'expansion')).toEqual(fail(COPY.ALREADY_EXITED));
  });
});

describe('checkClose', () => {
  it('allows closing an unsigned partner with a reason', () => {
    expect(checkClose(partner(), 'Not a fit')).toEqual({ ok: true });
  });
  it('refuses closing a signed partner', () => {
    expect(checkClose(signed(), 'x')).toEqual(fail(COPY.CLOSE_AFTER_SIGNING));
  });
  it('refuses a blank reason', () => {
    expect(checkClose(partner(), '   ')).toEqual(fail(COPY.REASON_NEEDED));
  });
});

describe('checkExit', () => {
  it('allows marking a signed partner exited with a reason', () => {
    expect(checkExit(signed(), 'Contract ended')).toEqual({ ok: true });
  });
  it('refuses marking exited before signing', () => {
    expect(checkExit(partner(), 'x')).toEqual(fail(COPY.EXIT_BEFORE_SIGNING));
  });
  it('refuses marking exited twice', () => {
    expect(checkExit(signed({ exitedDate: '2026-06-01' }), 'x')).toEqual(fail(COPY.ALREADY_EXITED));
  });
  it('refuses a blank reason', () => {
    expect(checkExit(signed(), '')).toEqual(fail(COPY.REASON_NEEDED));
  });
});

describe('checkUndoSigned', () => {
  it.each(['onboarding', 'growth', 'expansion', 'exit'] as const)('allows it in %s', (stage) => {
    expect(checkUndoSigned(signed({ stage }))).toEqual({ ok: true });
  });
  it('refuses a partner never signed', () => {
    expect(checkUndoSigned(partner())).toEqual(fail(COPY.UNDO_SIGNED_NOT_SIGNED));
  });
  it('refuses an exited partner', () => {
    expect(checkUndoSigned(signed({ stage: 'exit', exitedDate: '2026-06-01', exitReason: 'x' }))).toEqual(fail(COPY.UNDO_SIGNED_EXITED));
  });
});

describe('checkCorrectExit', () => {
  const exited = signed({ stage: 'exit', exitedDate: '2026-06-01', exitReason: 'x' });
  it('allows a date on or after the signing date', () => {
    expect(checkCorrectExit(exited, '2026-01-01')).toEqual({ ok: true });
    expect(checkCorrectExit(exited, '2026-07-01')).toEqual({ ok: true });
  });
  it('refuses a date before the signing date', () => {
    expect(checkCorrectExit(exited, '2025-12-31')).toEqual(fail(COPY.EXIT_DATE_BEFORE_SIGNING));
  });
  it('refuses a partner not exited', () => {
    expect(checkCorrectExit(signed(), '2026-07-01')).toEqual(fail(COPY.CORRECT_EXIT_NOT_EXITED));
    expect(checkCorrectExit(partner(), '2026-07-01')).toEqual(fail(COPY.CORRECT_EXIT_NOT_EXITED));
  });
});
