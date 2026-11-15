// Google and test sign-in only, in PartnerStandard Desk's words.
import { COPY } from '@partner-desk/copy';
import { signInAgreementFrom, builtLegalLinks } from '@/server/legal';
import { Suspense } from 'react';
import { SignInAgreement } from '@/ui/legal-links';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';
import { Options } from './sign-in-options';

export const metadata = { title: COPY.SIGN_IN_TITLE };

const LINK = 'underline underline-offset-2 hover:text-ink';

export default function SignInPage(props: PageProps<'/sign-in'>) {
  const built = builtAgreement();
  return (
    <>
      <StaticHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{COPY.SIGN_IN_TITLE}</h1>
        <Suspense fallback={<div className="mt-8 h-11" aria-busy="true" />}>
          <Options searchParams={props.searchParams} />
        </Suspense>
        {/* A Vercel build is hosted: the line is in the static HTML, as before. */}
        {built && <SignInAgreement {...built} className={LINK} />}
      </main>
      <SiteFooter />
    </>
  );
}

/** The sign-in line, when it is known as the page is built (a Vercel build: hosted). */
function builtAgreement() {
  const links = builtLegalLinks();
  return links ? signInAgreementFrom(links) : null;
}
