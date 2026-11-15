// The landing page's parts that read the request or the edition (plan 14: their own module, so tests render them on
// both editions).
import { COPY, copyFor } from '@partner-desk/copy';
import { testSignInEnabled } from '@partner-desk/platform';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { servedSignIn } from '@/server/edition';
import { currentOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { continueWithGoogle } from './sign-in/actions';
import { GoogleConnectionsLine } from './google-connections';

export function StorageLine({ text }: { text: string }) {
  return (
    <p className="mt-4 flex items-center gap-2 text-sm text-ink-3">
      <Lock className="h-4 w-4" aria-hidden />
      {text}
    </p>
  );
}

/**
 * Hosted's parts of the landing page, read when served: a company server's page is its team's door, only the name, the
 * title and Sign in (owner, 2026-11-14).
 */
export async function HostedOnly({ children }: { children: React.ReactNode }) {
  await connection();
  return servedSignIn() === 'email' ? null : children;
}

/** After Delete account the settings action redirects here with ?account=deleted. */
export async function AccountNotice({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { account } = await searchParams;
  if (account !== 'deleted') return null;
  const email = servedSignIn() === 'email';
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6">
      <div role="status" className="space-y-1 rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">
        <p>{copyFor(email ? 'database' : 'google').ACCOUNT_DELETED}</p>
        {/* A company server has no Google access to remove. */}
        {!email && <GoogleConnectionsLine />}
      </div>
    </div>
  );
}

/** Reads the session, so it sits in Suspense: the page around it stays a static shell. */
export async function HeroActions() {
  if (await currentOwner()) redirect('/this-week');
  // A company server signs in by email link, on the sign-in page (plan 14).
  if (servedSignIn() === 'email') {
    return (
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/sign-in" prefetch={false} className={buttonVariants({ variant: 'primary', className: 'h-11 px-5' })}>{copyFor('database').LANDING_START}</Link>
        {testSignInEnabled() && <a href="/api/test-auth?next=/this-week" className={buttonVariants({ className: 'h-11 px-5' })}>{COPY.LANDING_TEST}</a>}
      </div>
    );
  }
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {/* A server action, like the sign-in page: Better Auth sets its state cookie on the way to Google. */}
      <form action={continueWithGoogle}>
        <input type="hidden" name="next" value="/this-week" />
        <button type="submit" className={buttonVariants({ variant: 'primary', className: 'h-11 px-5' })}>{COPY.LANDING_START}</button>
      </form>
      {/* A route handler, not a page: a plain <a>, so nothing prefetches it. */}
      {testSignInEnabled() && <a href="/api/test-auth?next=/this-week" className={buttonVariants({ className: 'h-11 px-5' })}>{COPY.LANDING_TEST}</a>}
    </div>
  );
}
