// Where the work lives, for pages that know no person (the guide): the edition's, not a session's (plan 13, task 13).
import { editionFlags, onVercel, serverEnv } from '@partner-desk/platform/env';

/** Known when the page is built only on Vercel, which is always hosted; null elsewhere, where it is read when served. */
export const builtStorage = (): 'google' | null => (onVercel() ? 'google' : null);

/** This deployment's storage, from its settings: call it only at request time. */
export const servedStorage = (): 'google' | 'database' => editionFlags(serverEnv()).storage;

/** How this deployment signs in, from its settings: call it only at request time (plan 14). */
export const servedSignIn = (): 'google' | 'email' => editionFlags(serverEnv()).signIn;

/** Whether a company server can send its sign-in links: a first admin named, and mail set up (plan 14). */
export function emailSignInReady(): { admin: boolean } {
  return { admin: editionFlags(serverEnv()).adminEmail !== null };
}
