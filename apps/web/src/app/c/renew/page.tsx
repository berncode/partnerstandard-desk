// The expired link names its MAP, not the link.
import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LinkFrame } from '../link-frame';
import { requestLink } from './actions';
import { RenewForm } from './renew-form';

export const metadata: Metadata = { title: COPY.LINK_EXPIRED_TITLE, robots: { index: false, follow: false } };

export default function RenewPage(props: PageProps<'/c/renew'>) {
  return (
    <LinkFrame>
      <h1 className="text-xl font-semibold tracking-tight">{COPY.LINK_EXPIRED_TITLE}</h1>
      <p className="mt-2 text-ink-2">{COPY.LINK_EXPIRED_TEXT}</p>
      <Suspense fallback={<div className="mt-6 h-32" aria-busy="true" />}>
        <Form searchParams={props.searchParams} />
      </Suspense>
    </LinkFrame>
  );
}

async function Form({ searchParams }: Pick<PageProps<'/c/renew'>, 'searchParams'>) {
  const { map } = await searchParams;
  const mapId = (Array.isArray(map) ? map[0] : map) ?? '';
  return <RenewForm mapId={mapId} onRequest={requestLink} />;
}
