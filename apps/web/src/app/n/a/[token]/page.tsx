// In the link pages' frame.
import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { LinkFrame, LinkNotice } from '@/app/c/link-frame';
import { viewAction } from '@/server/email-actions';
import { emailActionDeps } from '@/server/runtime';
import { ActionForm } from './action-form';
import { confirmEmailAction } from './actions';

// The token is in the address: it is never sent on as a referrer (next.config), and the page is kept out of search engines.
export const metadata: Metadata = { title: COPY.MAP_ACTION_TITLE, referrer: 'no-referrer', robots: { index: false, follow: false } };
// The POST saves to the owner's Google Drive.
export const maxDuration = 60;

export default function EmailActionPage(props: PageProps<'/n/a/[token]'>) {
  return (
    <LinkFrame>
      <Suspense fallback={<div className="h-40" aria-busy="true" />}>
        <Confirmation params={props.params} />
      </Suspense>
    </LinkFrame>
  );
}

/** A GET only reads (Review Focus 2): link scanners open every link, so nothing on this page writes until its button. */
async function Confirmation({ params }: Pick<PageProps<'/n/a/[token]'>, 'params'>) {
  const { token } = await params;
  await connection();
  const result = await viewAction(emailActionDeps(), token);
  if (result.kind !== 'confirm') {
    const { title, message } = COPY.MAP_ACTION_NOTICE[result.kind];
    return <LinkNotice title={title}>{message}</LinkNotice>;
  }
  return <ActionForm token={token} view={result.view} onConfirm={confirmEmailAction} />;
}
