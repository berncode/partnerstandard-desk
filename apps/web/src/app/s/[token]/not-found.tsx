import { COPY } from '@partner-desk/copy';
import { SharedFrame, SharedMessage } from './shared-frame';

/**
 * An unknown or turned-off link, a case no longer shared, deleted, or whose owner is gone. Next adds the robots noindex
 * tag; the HTTP status stays 200, since the static header has already been sent by the time the link is looked up.
 */
export default function SharedCaseNotFound() {
  return (
    <SharedFrame>
      <SharedMessage>{COPY.SHARE_GONE}</SharedMessage>
    </SharedFrame>
  );
}
