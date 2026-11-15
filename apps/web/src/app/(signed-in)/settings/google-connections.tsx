import { COPY } from '@partner-desk/copy';
import { GoogleConnectionsLine } from '@/app/google-connections';

/**
 * The line on removing access at Google, as Settings words it: it also says that this signs the person out of the
 * other PartnerStandard tools. We never revoke the grant ourselves. (The line itself is the landing page's.)
 */
export function SettingsConnectionsLine({ className }: { className?: string }) {
  return <GoogleConnectionsLine className={className} after={COPY.SETTINGS_ALSO_SIGNS_OUT} />;
}
