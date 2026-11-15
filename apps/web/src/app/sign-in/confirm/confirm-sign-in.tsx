// The confirm page's request-time part (plan 14: its own module, so tests render it on both editions).
import { COPY } from '@partner-desk/copy';
import { safeNextPath, signInLinkEmail } from '@partner-desk/platform';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { servedSignIn } from '@/server/edition';
import { currentOwner, getAuth } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { confirmSignIn } from '../actions';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Request data (the link, the session, the settings) is read only here, inside Suspense. */
export async function Confirm({ searchParams }: Pick<PageProps<'/sign-in/confirm'>, 'searchParams'>) {
  // The request first: the edition is read when the page is served, never when it is built.
  const params = await searchParams;
  // Hosted signs in with Google: there is no email link to confirm.
  if (servedSignIn() !== 'email') notFound();
  // `next` comes from the address bar: it is held to this app again (task 2's review).
  const next = safeNextPath(first(params.next));
  if (await currentOwner()) redirect(next);
  const token = first(params.token) ?? '';
  // The address from the stored link, never from the address bar: a link someone else asked for shows their address.
  const email = await signInLinkEmail(getAuth(), token);
  if (!email) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">{COPY.SIGN_IN_TITLE}</h1>
        <p role="alert" className="mt-6 rounded-lg bg-danger-soft p-3 text-sm text-danger">{COPY.SIGN_IN_CONFIRM_GONE}</p>
        <Link href={next === '/this-week' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`} prefetch={false}
          className={buttonVariants({ variant: 'primary', className: 'mt-6 h-11 px-5' })}>{COPY.SIGN_IN_CONFIRM_NEW}</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight break-words">{COPY.SIGN_IN_CONFIRM_TITLE(email)}</h1>
      <form action={confirmSignIn} className="mt-8">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className={buttonVariants({ variant: 'primary', className: 'h-11 px-5' })}>{COPY.SIGN_IN_CONFIRM_BUTTON}</button>
      </form>
    </>
  );
}
