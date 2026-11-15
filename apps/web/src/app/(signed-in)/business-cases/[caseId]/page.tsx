import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PartnerCaseTab } from '@/cases/case-editor';
import { caseTabPath } from '@/cases/case-nav';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

export const metadata = { title: COPY.CASE_PARTNER_TAB_TITLE };
// The case saves to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** Tab 2 of a case, the partner case, at the case's own address as in the Business Case app. The layout holds the case. */
export default function PartnerCasePage({ params }: PageProps<'/business-cases/[caseId]'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <PartnerCaseScreen params={params} />
    </Suspense>
  );
}

async function PartnerCaseScreen({ params }: Pick<PageProps<'/business-cases/[caseId]'>, 'params'>) {
  const { caseId } = await params;
  // The layout reads the case for the signed-in person; a signed-out visit is sent to sign in from here too.
  await requireOwner(caseTabPath(caseId, 'case'));
  return <PartnerCaseTab />;
}
