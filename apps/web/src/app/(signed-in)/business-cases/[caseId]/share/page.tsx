import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { caseShare, caseUnshare } from '@/app/(signed-in)/actions/cases';
import { shareHref, sideOf } from '@/cases/case-nav';
import { ShareTab } from '@/cases/share-content';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

type Props = PageProps<'/business-cases/[caseId]/share'>;

// Sharing saves to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** The browser tab's title names the PDF the browser saves, so each side has its own. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { show } = await searchParams;
  return { title: sideOf(show) === 'ours' ? COPY.CASE_SHARE_OURS_TITLE : COPY.CASE_SHARE_TITLE };
}

/** Tab 4 of a case, Share: the two one-pagers and the share link (spec 4). The layout holds the case. */
export default function CaseSharePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <ShareScreen params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ShareScreen({ params, searchParams }: Props) {
  const [{ caseId }, { show }] = await Promise.all([params, searchParams]);
  const side = sideOf(show);
  // The layout reads the case for the signed-in person; a signed-out visit is sent to sign in from here too.
  await requireOwner(shareHref(caseId, side));
  return <ShareTab side={side} share={caseShare} unshare={caseUnshare} />;
}
