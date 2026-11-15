import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { LinkFrame, LinkNotice } from '../link-frame';

export const metadata: Metadata = { title: COPY.LINK_SIGNED_OUT_TITLE, robots: { index: false, follow: false } };

/** After Sign out on a MAP opened by link: the session is over, the link still works. */
export default function SignedOutPage() {
  return (
    <LinkFrame>
      <LinkNotice title={COPY.LINK_SIGNED_OUT_TITLE}>{COPY.LINK_SIGNED_OUT_TEXT}</LinkNotice>
    </LinkFrame>
  );
}
