// The sign-in page's request-time part (plan 14: its own module, so tests render it on both editions): hosted's Google
// and test sign-in, or a company server's email link.
import { COPY, copyFor } from '@partner-desk/copy';
import { safeNextPath, SIGN_IN_MESSAGES, signInProblem, testSignInEnabled, verifyAllowQuery } from '@partner-desk/platform';
import { redirect } from 'next/navigation';
import { useId } from 'react';
import { emailSignInReady, servedSignIn } from '@/server/edition';
import { builtLegalLinks, legalLinks, signInAgreementFrom } from '@/server/legal';
import { currentOwner, getAuth, googleSignInEnabled, mailConfigured } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { SignInAgreement } from '@/ui/legal-links';
import { continueWithGoogle, emailSignInLink } from './actions';

const LINK = 'underline underline-offset-2 hover:text-ink';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * An agent app's signed request, when its OAuth provider sent a signed-out person here (`/sign-in?client_id=…&sig=…`):
 * the address's own parameters, checked. Null for any other visit.
 */
async function agentRequest(params: Record<string, string | string[] | undefined>): Promise<string | null> {
  if (params.sig === undefined) return null;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === 'next' || name === 'error') continue;
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, one);
  }
  const oauthQuery = query.toString();
  return (await verifyAllowQuery(getAuth(), oauthQuery)) ? oauthQuery : null;
}

/** Request data (search params, the session, the env, the legal links) is read only here, inside Suspense. */
export async function Options({ searchParams }: Pick<PageProps<'/sign-in'>, 'searchParams'>) {
  const params = await searchParams;
  // On an agent's way: back to the allow page after sign-in, and the request goes through Google with the person.
  const oauthQuery = await agentRequest(params);
  const next = oauthQuery ? `/oauth/allow?${oauthQuery}` : safeNextPath(first(params.next));
  if (await currentOwner()) redirect(next);
  const problem = signInProblem(first(params.error));
  const agreement = builtLegalLinks() ? null : signInAgreementFrom(legalLinks());
  // A company server signs in by email link (owner, 2026-11-08); hosted, with Google, as before.
  const email = servedSignIn() === 'email';
  const words = copyFor(email ? 'database' : 'google');
  return (
    <>
      <p className="mt-2 text-ink-2">{words.SIGN_IN_TEXT}</p>
      <div className="mt-8 flex flex-col items-center gap-3">
        {/* Better Auth's error code means nothing to people: only our message is shown. */}
        {problem && <p role="alert" className="w-full rounded-lg bg-danger-soft p-3 text-sm text-danger">{SIGN_IN_MESSAGES[problem]}</p>}
        {email && <EmailLinkForm next={next} link={first(params.link)} />}
        {!email && googleSignInEnabled() && (
          <form action={continueWithGoogle}>
            <input type="hidden" name="next" value={next} />
            {oauthQuery && <input type="hidden" name="oauth_query" value={oauthQuery} />}
            <button type="submit" className={buttonVariants({ variant: 'primary', className: 'h-11 px-5' })}>{COPY.SIGN_IN_GOOGLE}</button>
          </form>
        )}
        {testSignInEnabled() && (
          // A route handler, not a page: a plain <a>, so nothing prefetches it.
          <a href={`/api/test-auth?next=${encodeURIComponent(next)}`} className={buttonVariants({ className: 'h-11 px-5' })}>
            {COPY.SIGN_IN_TEST}
          </a>
        )}
      </div>
      {/* Off Vercel, this deployment's terms and privacy policy: a company server's own; left out without both. */}
      {agreement && <SignInAgreement {...agreement} className={LINK} />}
    </>
  );
}

/** What the last "Email me a link" did, as `/sign-in?link=` says. */
const LINK_MESSAGES: Record<string, { text: string; role: 'status' | 'alert' }> = {
  sent: { text: COPY.SIGN_IN_EMAIL_SENT, role: 'status' },
  bad_email: { text: COPY.SIGN_IN_EMAIL_BAD, role: 'alert' },
  too_many: { text: COPY.SIGN_IN_EMAIL_TOO_MANY, role: 'alert' },
  failed: { text: COPY.SIGN_IN_EMAIL_FAILED, role: 'alert' },
  gone: { text: COPY.SIGN_IN_CONFIRM_GONE, role: 'alert' },
};

/**
 * A company server's sign-in (plan 14): an email field and "Email me a link". Without a first admin or mail settings
 * it says which is missing instead. The answer after a send is the same for any address.
 */
function EmailLinkForm({ next, link }: { next: string; link: string | undefined }) {
  const message = link ? LINK_MESSAGES[link] : undefined;
  const messageId = useId();
  // A refused address is the field's own error, read with it (task 4's review).
  const fieldError = link === 'bad_email' || link === 'too_many';
  if (!emailSignInReady().admin) return <p role="alert" className="w-full rounded-lg bg-warn-soft p-3 text-sm text-warn">{COPY.SIGN_IN_NO_ADMIN}</p>;
  if (!mailConfigured()) return <p role="alert" className="w-full rounded-lg bg-warn-soft p-3 text-sm text-warn">{COPY.SIGN_IN_NO_MAIL}</p>;
  return (
    <>
      {message && (
        <p id={messageId} role={message.role} className={message.role === 'alert' ? 'w-full rounded-lg bg-danger-soft p-3 text-sm text-danger' : 'w-full rounded-lg bg-brand-soft p-3 text-sm text-ink'}>
          {message.text}
        </p>
      )}
      <form action={emailSignInLink} className="flex w-full flex-col gap-2 text-left">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="sign-in-email" className="text-sm font-medium">{COPY.SIGN_IN_EMAIL_LABEL}</label>
        <input id="sign-in-email" name="email" type="email" required autoComplete="email" maxLength={254}
          aria-invalid={fieldError || undefined} aria-describedby={message ? messageId : undefined}
          className="h-11 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand" />
        <button type="submit" className={buttonVariants({ variant: 'primary', className: 'h-11 px-5' })}>{COPY.SIGN_IN_EMAIL_SEND}</button>
      </form>
    </>
  );
}
