import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LinkFrame } from '@/app/c/link-frame';
import { PlanSkeleton } from '@/maps/components/plan-skeleton';
import { LinkMapLoader } from './link-loader';

export const metadata: Metadata = { title: COPY.MAP_TITLE, robots: { index: false, follow: false } };

/**
 * A MAP for a person with a link (spec 4): a partner contact or a colleague. The whole plan, only their side editable,
 * plan info read-only, no Share, no sheet link, outside PartnerStandard Desk's frame, with a Sign out. No owner's session is
 * read: who they are comes from their link's cookie, checked on every request.
 */
export default function LinkMapRoute({ params }: PageProps<'/m/[mapId]'>) {
  return (
    <LinkFrame wide>
      <Suspense fallback={<PlanSkeleton />}>
        <LinkMapLoader params={params} />
      </Suspense>
    </LinkFrame>
  );
}
