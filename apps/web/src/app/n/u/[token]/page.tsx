// In the link pages' frame.
import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { LinkFrame, LinkNotice } from '@/app/c/link-frame';
import { unsubscribeDeps } from '@/server/runtime';
import { unsubscribeView } from '@/server/unsubscribe';
import { unsubscribeAction } from './actions';
import { UnsubscribeForm } from './unsubscribe-form';

export const metadata: Metadata = { title: COPY.MAP_UNSUBSCRIBE_TITLE, referrer: 'no-referrer', robots: { index: false, follow: false } };

export default function UnsubscribePage(props: PageProps<'/n/u/[token]'>) {
  return (
    <LinkFrame>
      <Suspense fallback={<div className="h-32" aria-busy="true" />}>
        <Unsubscribe params={props.params} />
      </Suspense>
    </LinkFrame>
  );
}

/** A GET only reads (Review Focus 2); the button posts. */
async function Unsubscribe({ params }: Pick<PageProps<'/n/u/[token]'>, 'params'>) {
  const { token } = await params;
  await connection();
  const view = await unsubscribeView(unsubscribeDeps(), token);
  if (view.kind === 'invalid') return <LinkNotice title={COPY.MAP_UNSUBSCRIBE_INVALID}>{COPY.MAP_UNSUBSCRIBE_INVALID_TEXT}</LinkNotice>;
  return <UnsubscribeForm token={token} label={view.label} initiallyDone={view.kind === 'done'} onUnsubscribe={unsubscribeAction} />;
}
