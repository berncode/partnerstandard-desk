import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { LinkFrame, LinkNotice } from '../link-frame';

export const metadata: Metadata = { title: COPY.LINK_INVALID_TITLE, robots: { index: false, follow: false } };

/** A link revoked, unknown, or to a MAP that is gone: deleted, its partner type removed, or its owner's account gone. */
export default function InvalidLinkPage() {
  return (
    <LinkFrame>
      <LinkNotice title={COPY.LINK_INVALID_TITLE}>{COPY.LINK_INVALID_TEXT}</LinkNotice>
    </LinkFrame>
  );
}
