// The "removed" access notice.
import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { LinkFrame, LinkNotice } from '../link-frame';

export const metadata: Metadata = { title: COPY.LINK_REMOVED_TITLE, robots: { index: false, follow: false } };

/** The owner revoked this person's links while they had the MAP open. */
export default function RemovedPage() {
  return (
    <LinkFrame>
      <LinkNotice title={COPY.LINK_REMOVED_TITLE}>{COPY.LINK_REMOVED_TEXT}</LinkNotice>
    </LinkFrame>
  );
}
