/**
 * What a failed sign-in means. Better Auth sends people back to /sign-in?error=<code>. Only our message is shown, never
 * the code. Ported from Recruitment's sign-in-errors.ts (Google is the only sign-in here).
 */
import { COPY } from '@partner-desk/copy';

export type SignInProblem = 'other_provider' | 'no_email' | 'failed';

export function signInProblem(error: string | undefined): SignInProblem | null {
  if (!error) return null;
  if (error === 'account_not_linked') return 'other_provider';
  if (error === 'email_not_found') return 'no_email';
  return 'failed';
}

export const SIGN_IN_MESSAGES: Record<SignInProblem, string> = {
  other_provider: COPY.SIGN_IN_OTHER_PROVIDER,
  no_email: COPY.SIGN_IN_NO_EMAIL,
  failed: COPY.SIGN_IN_FAILED,
};
