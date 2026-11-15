import { describe, expect, it } from 'vitest';
import { signInProblem, SIGN_IN_MESSAGES } from './sign-in-errors';

describe('signInProblem', () => {
  it.each([
    [undefined, null],
    ['account_not_linked', 'other_provider'],
    ['email_not_found', 'no_email'],
    ['access_denied', 'failed'],
    ['invalid_code', 'failed'],
    ['state_mismatch', 'failed'],
  ] as const)('%s → %s', (error, problem) => {
    expect(signInProblem(error)).toBe(problem);
  });

  it('words each problem as Recruitment does, for PartnerStandard Desk', () => {
    expect(SIGN_IN_MESSAGES).toEqual({
      other_provider: 'This email already signs in another way. Use the button you signed in with before.',
      no_email: 'That account didn’t share an email address, and PartnerStandard Desk needs one to sign you in.',
      failed: 'Sign-in didn’t finish. Try again.',
    });
  });

  it('has a message for every problem, none of them raw codes or em dashes', () => {
    for (const message of Object.values(SIGN_IN_MESSAGES)) {
      expect(message).not.toMatch(/_/);
      expect(message).not.toContain('—');
    }
  });
});
