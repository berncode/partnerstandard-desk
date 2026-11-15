import { reviewPath } from '@/reviews/review-model';
import { ReviewScreen } from '@/reviews/review-screen';
import { requireOwner } from '@/server/runtime';

/** One review by its id, held or in prep, for the signed-in owner. */
export async function HeldReviewLoader({ params }: { params: Promise<{ mapId: string; reviewId: string }> }) {
  const { mapId, reviewId } = await params;
  const { session, deps } = await requireOwner(reviewPath(mapId, reviewId));
  return <ReviewScreen mapId={mapId} reviewId={reviewId} session={session} deps={deps} />;
}
