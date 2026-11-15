import { API_PROBLEMS } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { LegalDocument } from '@/ui/legal-document';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';
import { problemsDoc } from './doc';

// The page the API's error answers name in `type`: /problems/<code> shows it too (next.config.ts, rewrites).
export const metadata: Metadata = { title: API_PROBLEMS.title, description: API_PROBLEMS.description };

export default function Page() {
  return (
    <>
      <StaticHeader />
      <main className="flex-1">
        <LegalDocument doc={problemsDoc()} />
      </main>
      <SiteFooter />
    </>
  );
}
