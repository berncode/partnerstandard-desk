import { RECRUITMENT_STEPS, STAGES, type RecruitmentStep, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { confirmedRecommendation } from './recommend';
import type { Partner } from './types';

export type RuleResult = { ok: true } | { ok: false; message: string };

const OK: RuleResult = { ok: true };
const refuse = (message: string): RuleResult => ({ ok: false, message });

/** A step moves forward or back one at a time, and only while the partner is in recruitment and open. */
export function checkStep(p: Partner, to: RecruitmentStep): RuleResult {
  if (p.stage !== 'recruitment') return refuse(COPY.STEP_ONLY_IN_RECRUITMENT);
  if (p.closed !== null) return refuse(COPY.REOPEN_BEFORE_STEP);
  const from = p.step === null ? -1 : RECRUITMENT_STEPS.indexOf(p.step);
  return Math.abs(RECRUITMENT_STEPS.indexOf(to) - from) > 1 ? refuse(COPY.ONE_STEP) : OK;
}

/** Advice shown before moving forward a step. Never blocks. `hypothesisHolds` comes from the market. */
export function stepNudge(p: Partner, to: RecruitmentStep, ctx: { hypothesisHolds: boolean }): string | null {
  const from = p.step === null ? -1 : RECRUITMENT_STEPS.indexOf(p.step);
  if (RECRUITMENT_STEPS.indexOf(to) <= from) return null;
  switch (to) {
    case 'qualification':
      return ctx.hypothesisHolds ? null : COPY.HYPOTHESIS_FIRST;
    case 'map': {
      const recommendation = confirmedRecommendation(p.confirmed);
      if (!recommendation) return COPY.CONFIRM_FIRST;
      return recommendation.kind === 'proceed' ? null : recommendation.text;
    }
    default:
      return null;
  }
}

/** Advice shown before marking a partner signed. Never blocks. */
export function signNudge(p: Partner): string | null {
  return p.mapFilled ? null : COPY.MAP_BEFORE_SIGNING;
}

export function checkSign(p: Partner): RuleResult {
  if (p.signedDate !== null || p.stage !== 'recruitment') return refuse(COPY.ALREADY_SIGNED);
  return p.closed === null ? OK : refuse(COPY.REOPEN_BEFORE_SIGNING);
}

/** After signing, a partner moves one stage at a time among onboarding to exit, until the exit is done. */
export function checkStage(p: Partner, to: Stage): RuleResult {
  if (p.signedDate === null) return refuse(COPY.SIGN_BEFORE_STAGE);
  if (p.exitedDate !== null) return refuse(COPY.ALREADY_EXITED);
  if (to === 'recruitment') return refuse(COPY.NO_BACK_TO_RECRUITMENT);
  return Math.abs(STAGES.indexOf(to) - STAGES.indexOf(p.stage)) > 1 ? refuse(COPY.ONE_STAGE) : OK;
}

/** A signing is undone only while the partner has not exited; the partner goes back to the MAP step of recruitment. */
export function checkUndoSigned(p: Partner): RuleResult {
  if (p.signedDate === null) return refuse(COPY.UNDO_SIGNED_NOT_SIGNED);
  return p.exitedDate !== null ? refuse(COPY.UNDO_SIGNED_EXITED) : OK;
}

/** An exit is corrected only once it is made, and not to a day before the signing. */
export function checkCorrectExit(p: Partner, exitedDate: string): RuleResult {
  if (p.exitedDate === null) return refuse(COPY.CORRECT_EXIT_NOT_EXITED);
  return p.signedDate !== null && exitedDate < p.signedDate ? refuse(COPY.EXIT_DATE_BEFORE_SIGNING) : OK;
}

export function checkClose(p: Partner, reason: string): RuleResult {
  if (p.signedDate !== null) return refuse(COPY.CLOSE_AFTER_SIGNING);
  return reason.trim() === '' ? refuse(COPY.REASON_NEEDED) : OK;
}

export function checkExit(p: Partner, reason: string): RuleResult {
  if (p.signedDate === null) return refuse(COPY.EXIT_BEFORE_SIGNING);
  if (p.exitedDate !== null) return refuse(COPY.ALREADY_EXITED);
  return reason.trim() === '' ? refuse(COPY.REASON_NEEDED) : OK;
}
