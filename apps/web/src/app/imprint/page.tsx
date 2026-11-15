import type { Metadata } from 'next';
import { IMPRINT } from '@/content/legal/imprint';
import { LegalPage } from '@/ui/legal-page';

// Nothing here reads the request.
export const ensureStatic = 'navigation';

export const metadata: Metadata = {
  title: 'Imprint',
  description: 'Who operates PartnerStandard Desk.',
};

export default function Page() {
  return <LegalPage doc={IMPRINT} />;
}
