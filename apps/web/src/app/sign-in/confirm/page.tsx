// Where a company server's sign-in email leads (plan 14): "Sign in to PartnerStandard Desk as anna@acme.example?" and one
// button. A visit only reads which address the link is for; only the button's POST uses the link (AGENTS.md: emails
// never act on a GET), so a link scanner opening it leaves it working.
import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';
import { Confirm } from './confirm-sign-in';

export const metadata = { title: COPY.SIGN_IN_TITLE };

export default function ConfirmSignInPage(props: PageProps<'/sign-in/confirm'>) {
  return (
    <>
      <StaticHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <Suspense fallback={<div className="mt-8 h-11" aria-busy="true" />}>
          <Confirm searchParams={props.searchParams} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
