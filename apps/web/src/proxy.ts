// PartnerStandard's privacy policy, terms and imprint never show on a company server (spec 2026-11-07 §14; plan 13,
// task 12), and the email sign-in's confirm page never on hosted (plan 14). The pages stay as they are; this check
// runs only on their addresses, at request time, because one image serves every company and the edition is set when
// it starts, not when it is built.
import { editionFlags, onVercel, serverEnv } from '@partner-desk/platform/env';
import { NextResponse, type NextRequest } from 'next/server';

/** The address no page answers: the app's own "not found" page, with a 404. */
const NO_PAGE = '/_self-hosted/no-page';

const notFound = (request: NextRequest) => NextResponse.rewrite(new URL(NO_PAGE, request.url));

export function proxy(request: NextRequest) {
  // Hosted signs in with Google: there is no email link to confirm, and Vercel is always hosted (task 4's review).
  if (request.nextUrl.pathname === '/sign-in/confirm') {
    return onVercel() || editionFlags(serverEnv()).signIn !== 'email' ? notFound(request) : NextResponse.next();
  }
  // Vercel is always hosted: the static page as it is, without reading the settings (final review).
  if (onVercel() || editionFlags(serverEnv()).legal === 'ours') return NextResponse.next();
  return notFound(request);
}

export const config = { matcher: ['/privacy', '/terms', '/imprint', '/sign-in/confirm'] };
