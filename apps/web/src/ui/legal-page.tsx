import type { LegalDoc } from '@/content/legal/types';
import { LegalDocument } from './legal-document';
import { SiteFooter } from './site-footer';
import { StaticHeader } from './static-header';

/** A whole legal page: static header, the document, footer. No request data anywhere (ensureStatic = 'navigation'). */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <StaticHeader />
      <main className="flex-1">
        <LegalDocument doc={doc} />
      </main>
      <SiteFooter legal="ours" />
    </>
  );
}
