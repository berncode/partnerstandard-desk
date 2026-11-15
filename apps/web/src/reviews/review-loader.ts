// What the review page loads (reviews spec 5.2), through the commands: the review as `readReview` gives it, the MAP as
// the page's editor saves it, and the partner's page to link back to. Server only.
import { readMap, readPartners, readReview, type Actor, type Deps, type ReviewRead } from '@partner-desk/commands';
import { snapshotOf, type MapSnapshot } from '@/maps/remote';
import { partnerHref } from '@/partner/partner-model';

export type ReviewLoad =
  | { kind: 'not_found' }
  | { kind: 'problem'; failure: { error: string; message: string } }
  | { kind: 'ok'; read: ReviewRead; snapshot: MapSnapshot; fileUrl: string | null; partnerHref: string | null };

const NOT_FOUND: ReviewLoad = { kind: 'not_found' };

/**
 * The review page's data. A person with a link never reaches a review (Review Focus 1): not found, before anything is
 * read. A review that isn't there (another MAP's, or deleted) is not found too; a MAP that can't be read is a problem
 * the page shows, as the MAP page does.
 */
export async function loadReview(
  deps: Deps, actor: Actor, input: { mapId: string; reviewId?: string; companyId: string },
): Promise<ReviewLoad> {
  if (actor.kind === 'link') return NOT_FOUND;
  const { mapId, reviewId, companyId } = input;
  const read = await readReview(deps, actor, { mapId, ...(reviewId === undefined ? {} : { reviewId }) });
  if (!read.ok) return read.error === 'not_found' || read.error === 'forbidden' || read.error === 'invalid' ? NOT_FOUND : { kind: 'problem', failure: read };
  const map = await readMap(deps, actor, { mapId });
  if (!map.ok) return { kind: 'problem', failure: map };
  const book = await readPartners(deps, actor, { companyId });
  const partner = book.ok ? book.value.value.partners.find((p) => p.id === map.value.value.info.partnerId) : undefined;
  return {
    kind: 'ok', read: read.value, snapshot: snapshotOf(map.value), fileUrl: map.value.fileUrl,
    partnerHref: partner ? partnerHref(partner.accountId, partner.partnerType) : null,
  };
}
