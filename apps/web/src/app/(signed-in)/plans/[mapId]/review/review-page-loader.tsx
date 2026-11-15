import { reviewPath } from '@/reviews/review-model';
import { ReviewScreen } from '@/reviews/review-screen';
import { requireOwner } from '@/server/runtime';

/** The current horizon's review, for the signed-in owner. */
export async function ReviewPageLoader({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const { session, deps } = await requireOwner(reviewPath(mapId));
  return <ReviewScreen mapId={mapId} session={session} deps={deps} />;
}
