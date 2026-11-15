import type { Metadata } from 'next';
import { PRIVACY } from '@/content/legal/privacy';
import { LegalPage } from '@/ui/legal-page';

// Nothing here reads the request.
export const ensureStatic = 'navigation';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How PartnerStandard Desk handles personal data, including Google user data.',
};

export default function Page() {
  return <LegalPage doc={PRIVACY} />;
}
