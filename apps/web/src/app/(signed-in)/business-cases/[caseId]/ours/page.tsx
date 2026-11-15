import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { caseTabPath } from '@/cases/case-nav';
import { OurCaseTab } from '@/cases/our-case-tab';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

export const metadata = { title: COPY.CASE_OURS_TAB_TITLE };
// Our case saves to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** Tab 3 of a case, our case (internal, spec 4). The layout holds the case. */
export default function CaseOursPage({ params }: PageProps<'/business-cases/[caseId]/ours'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <OursScreen params={params} />
    </Suspense>
  );
}

async function OursScreen({ params }: Pick<PageProps<'/business-cases/[caseId]/ours'>, 'params'>) {
  const { caseId } = await params;
  // The layout reads the case for the signed-in person; a signed-out visit is sent to sign in from here too.
  await requireOwner(caseTabPath(caseId, 'ours'));
  return <OurCaseTab />;
}
