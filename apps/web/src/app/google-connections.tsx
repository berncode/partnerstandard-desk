import { COPY } from '@partner-desk/copy';

const LINK = 'font-medium text-brand-strong underline underline-offset-2';

/** Google's page for removing an app's access. We never revoke it ourselves: all PartnerStandard tools share it. */
export const GOOGLE_CONNECTIONS_URL = 'https://myaccount.google.com/connections';

/**
 * The line the notice after deleting an account shows, since neither Delete account nor anything else revokes.
 */
export function GoogleConnectionsLine({ className, after }: { className?: string; after?: string }) {
  return (
    <p className={className}>
      {COPY.GOOGLE_CONNECTIONS_BEFORE}
      <a href={GOOGLE_CONNECTIONS_URL} target="_blank" rel="noreferrer" className={LINK}>{COPY.GOOGLE_CONNECTIONS_LINK}</a>.{after && ` ${after}`}
    </p>
  );
}
