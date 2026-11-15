import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { caseTabPath } from '@/cases/case-nav';
import { OfferTab } from '@/cases/offer-tab';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

export const metadata = { title: COPY.CASE_OFFER_TAB_TITLE };
// The offer tab saves to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** Tab 1 of a case, the offer to the partner (spec 6). The layout holds the case. */
export default function CaseOfferPage({ params }: PageProps<'/business-cases/[caseId]/offer'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <OfferScreen params={params} />
    </Suspense>
  );
}

async function OfferScreen({ params }: Pick<PageProps<'/business-cases/[caseId]/offer'>, 'params'>) {
  const { caseId } = await params;
  // The layout reads the case for the signed-in person; a signed-out visit is sent to sign in from here too.
  await requireOwner(caseTabPath(caseId, 'offer'));
  return <OfferTab />;
}
