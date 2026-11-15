import type { Metadata } from 'next';
import { TERMS } from '@/content/legal/terms';
import { LegalPage } from '@/ui/legal-page';

// Nothing here reads the request.
export const ensureStatic = 'navigation';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using PartnerStandard Desk.',
};

export default function Page() {
  return <LegalPage doc={TERMS} />;
}
