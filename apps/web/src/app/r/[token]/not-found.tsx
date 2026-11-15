// The summary link that doesn't work, as the business case's (src/app/s/[token]/not-found.tsx).
import { COPY } from '@partner-desk/copy';
import { SharedFrame, SharedMessage } from '@/app/s/[token]/shared-frame';

/**
 * An unknown or turned-off link, a review whose MAP was deleted or whose partner type was removed, or an owner who is
 * gone: one answer for each, so the page tells nothing about which. Next adds the robots noindex tag.
 */
export default function SummaryNotFound() {
  return (
    <SharedFrame>
      <SharedMessage>{COPY.SHARE_GONE}</SharedMessage>
    </SharedFrame>
  );
}
