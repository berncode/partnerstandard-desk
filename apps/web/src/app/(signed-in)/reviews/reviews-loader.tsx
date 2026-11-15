import { listReviews, ownerToday } from '@partner-desk/commands';
import { connection } from 'next/server';
import { LoadProblem } from '@/markets/load-problem';
import { ReviewList } from '@/reviews/review-list';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';

const PATH = '/reviews';

/** The company's reviews through `listReviews` (one Partners read, each MAP read through the read cache). */
export async function ReviewsLoader() {
  const { session, deps } = await requireOwner(PATH);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const listed = await listReviews(deps, actor, { companyId });
  if (!listed.ok) return <LoadProblem failure={listed} partnersFile next={PATH} storage={session.storage} />;
  // Before the clock: a request-time API, so "today" is the request's.
  await connection();
  return <ReviewList lines={listed.value} today={await ownerToday(deps, actor.userId)} />;
}
