'use server';

import { levelsWithinRole } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { answerAllow, askedScopes, levelsOffered, scopeForLevel, serverEnv, verifyAllowQuery } from '@partner-desk/platform';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { log } from '@/server/log';
import { currentOwner, getAuth } from '@/server/runtime';
import type { AllowState } from './allow-form';

/**
 * The allow page's Allow or Cancel, as the signed-in person: the OAuth provider records the grant (the level is the
 * scope, never more than the app asked for: "Read only" drops pd.change and pd.propose, "Read and change" drops
 * pd.propose, and the third level is only ever the person's pick) and gives the address to send the browser
 * to: the app's callback with a code, or with `access_denied`. Only a POST does this (a link visit never allows).
 */
export async function answerAgent(_previous: AllowState, formData: FormData): Promise<AllowState> {
  const oauthQuery = String(formData.get('oauth_query') ?? '');
  const accept = formData.get('answer') === 'allow';
  const session = await currentOwner();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/allow?${oauthQuery}`)}`);
  const auth = getAuth();
  if (!(await verifyAllowQuery(auth, oauthQuery))) return { message: COPY.AGENT_ALLOW_FAILED };
  const asked = askedScopes(oauthQuery);
  const offered = levelsWithinRole(levelsOffered(asked), session.member?.role);
  // The level picked, if the app asked for it; else the lowest it asked for.
  const level = offered.find((offer) => offer === formData.get('level')) ?? offered[0];
  if (accept && !level) return { message: COPY.AGENT_ALLOW_FAILED };
  const url = await answerAllow(auth, {
    appUrl: serverEnv().APP_URL, headers: await headers(), oauthQuery, accept, scope: accept && level ? scopeForLevel(asked, level) : [],
  });
  if (!url) {
    log('agent_allow_failed', {});
    return { message: COPY.AGENT_ALLOW_FAILED };
  }
  // redirect() throws, so it runs last. The app's callback is often on this machine (http://127.0.0.1:…).
  redirect(url);
}
