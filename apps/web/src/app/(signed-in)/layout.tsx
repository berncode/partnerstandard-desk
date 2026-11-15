import { countProposals } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame } from '@/frame/app-frame';
import { ProposalsWaiting } from '@/frame/nav-items';
import { AccountMenu } from '@/ui/account-menu';
import { actorFor, companyFor, currentOwner, depsFor } from '@/server/runtime';
import { Skeleton } from '@/ui/loading';

/**
 * Every signed-in screen. The shell (sidebar, links, footer) is static; the session is read only inside the Suspense
 * children, for the company name and the account. A signed-out visit is sent to /sign-in by the page itself
 * (`requireOwner(path)`), which knows its own path; here a signed-out visit just shows no name.
 */
export default function SignedInLayout({ children }: LayoutProps<'/'>) {
  return (
    <AppFrame
      company={<Suspense fallback={<Skeleton className="h-5 w-28" />}><CompanyName /></Suspense>}
      user={<Suspense fallback={<Skeleton className="h-10 w-full" />}><Account /></Suspense>}
      proposalsWaiting={<Suspense fallback={null}><WaitingCount /></Suspense>}
    >
      {children}
    </AppFrame>
  );
}

async function CompanyName() {
  const session = await currentOwner();
  if (!session) return null;
  // A company has no name until Settings gives it one: until then, the line links there.
  const name = (await companyFor(session)).name;
  if (name) return name;
  return <Link href="/settings" className="rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">{COPY.NAME_YOUR_COMPANY}</Link>;
}

async function Account() {
  const session = await currentOwner();
  if (!session) return null;
  return <AccountMenu name={session.owner.displayName} email={session.email} />;
}

/**
 * How many agents' proposals wait for the person, beside This week: from our index alone (no Google read), counted at
 * the time of the read. An index that can't be read shows no count.
 */
async function WaitingCount() {
  const session = await currentOwner();
  if (!session) return null;
  const deps = depsFor(session);
  const counted = await countProposals(deps, actorFor(session)).catch(() => null);
  if (!counted?.ok) return null;
  return <ProposalsWaiting count={counted.value.total} readAt={deps.clock()} />;
}
