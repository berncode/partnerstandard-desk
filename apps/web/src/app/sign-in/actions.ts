'use server';

import { createHmac } from 'node:crypto';
import { redeemSignInLink, requestSignInLink, safeNextPath, serverEnv, TursoRateLimiter } from '@partner-desk/platform';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { servedSignIn } from '@/server/edition';
import { log } from '@/server/log';
import { getAuth, getDb } from '@/server/runtime';

/**
 * Starts Google sign-in on the server: Better Auth sets its state cookie (nextCookies) and gives Google's consent page.
 * The scopes are fixed in buildAuth; nothing here can change them. After Google, the person lands on `next`.
 *
 * `oauth_query`: an agent app's signed request, when the person signs in on its way (the allow page). The OAuth
 * provider checks its signature, keeps it with the sign-in, and after Google sends the person on to the allow page.
 * It changes nothing that is sent to Google.
 */
export async function continueWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get('next'));
  const oauthQuery = formData.get('oauth_query');
  const agent = typeof oauthQuery === 'string' && oauthQuery ? { oauth_query: oauthQuery } : {};
  let url: string | undefined;
  try {
    // The provider's hook reads `oauth_query`; Better Auth's own type of the body doesn't name it.
    const body = { provider: 'google' as const, callbackURL: next, ...agent };
    const result = await getAuth().api.signInSocial({ body, headers: await headers() });
    url = 'url' in result ? result.url : undefined;
  } catch {
    // The name only: the error's text can hold what Google or Better Auth sent back.
    log('sign_in_start_failed', {});
    url = undefined;
  }
  // redirect() throws, so it runs outside the try.
  redirect(url ?? `/sign-in?error=failed&next=${encodeURIComponent(next)}`);
}

/** How often a sign-in link may be asked for, in 15 minutes: per address, and per network address (plan 14). */
const LINK_WINDOW_MS = 15 * 60 * 1000;
const LINKS_PER_EMAIL = 3;
const LINKS_PER_IP = 10;

/** A limit key: keyed with the app's secret, so an address or IP can't be guessed back from it (task 4's review). */
const keyOf = (kind: string, value: string) => `sign-in-link:${kind}:${createHmac('sha256', serverEnv().BETTER_AUTH_SECRET).update(value).digest('base64url')}`;

/** /sign-in with what happened to the link, and where it goes on to. */
function signInPage(link: 'sent' | 'bad_email' | 'too_many' | 'failed' | 'gone', next: string): string {
  return `/sign-in?link=${link}${next === '/this-week' ? '' : `&next=${encodeURIComponent(next)}`}`;
}

/**
 * A company server's "Email me a link" (plan 14): a link goes to the address if it may sign in, and the page says the
 * same either way, so it never tells who may. Limited per address and per network address, since Better Auth's own
 * limit only counts its web routes (task 2's review). The keys are keyed hashes: no address or IP is stored. The
 * network address is the request's `x-forwarded-for`, which a client can set: that limit stops simple scripts, and
 * the address's own limit protects the admin's inbox [builder's call].
 */
export async function emailSignInLink(formData: FormData): Promise<void> {
  // Only a company server signs in by email link; hosted writes nothing here (task 4's review).
  if (servedSignIn() !== 'email') redirect('/sign-in');
  const next = safeNextPath(formData.get('next'));
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(signInPage('bad_email', next));
  const requestHeaders = await headers();
  const ip = (requestHeaders.get('x-forwarded-for')?.split(',')[0] ?? requestHeaders.get('x-real-ip') ?? 'unknown').trim();
  const limiter = new TursoRateLimiter(getDb());
  const now = Date.now();
  let allowed: boolean;
  try {
    // The network first: a refused one doesn't use up the address's own count (task 4's review).
    allowed = await limiter.hit(keyOf('ip', ip), LINKS_PER_IP, LINK_WINDOW_MS, now)
      && await limiter.hit(keyOf('email', email), LINKS_PER_EMAIL, LINK_WINDOW_MS, now);
  } catch {
    log('sign_in_link_limit_failed', {});
    redirect(signInPage('failed', next));
  }
  if (!allowed) redirect(signInPage('too_many', next));
  const asked = await requestSignInLink(getAuth(), email, requestHeaders, next);
  if (!asked) log('sign_in_link_failed', {});
  redirect(signInPage(asked ? 'sent' : 'failed', next));
}

/**
 * The confirm page's one button (plan 14): only this POST uses the link's token, never a visit to the link
 * (AGENTS.md). Signed in, it goes on to `next`; a used or old link goes back to sign-in, which says so.
 */
export async function confirmSignIn(formData: FormData): Promise<void> {
  if (servedSignIn() !== 'email') redirect('/sign-in');
  const next = safeNextPath(formData.get('next'));
  const token = String(formData.get('token') ?? '');
  const signedIn = await redeemSignInLink(getAuth(), token, await headers());
  redirect(signedIn ? next : signInPage('gone', next));
}
