// The summary email (reviews spec 5.6), in the shape of `mailMapLink` (map-link-mail.ts): the MAP is read as its owner
// through `readMap`, the email goes out on the owner's behalf with replies to the owner, and only ids are logged.
import { readMap, type Actor, type SummarySend } from '@partner-desk/commands';
import type { Mailer } from './mailer';
import type { MailSender } from './map-link-mail';
import type { OwnerOf } from './map-notifications';
import { reviewSummaryEmail } from './emails/review-summary';

export interface SummaryMailDeps {
  mailer: Mailer | null;
  owner: OwnerOf;
  /** The owner's company name, or null until Settings names it. */
  ourName: (ownerUserId: string) => Promise<string | null>;
  /** The summary link's address on APP_URL. */
  summaryUrl: (token: string) => string;
  log: (event: string, ids: Record<string, string>) => void;
}

export type { SummarySend };

/**
 * Emails each partner-side person of a send the link to a held review's summary, on the owner's behalf: replies go to
 * the owner. The MAP is read once for the whole send; each person is checked against that read. Answers the ids of the
 * people an email went out to: `shareSummary` stamps the review with their names (it is its `SummaryMail`). Nothing is
 * sent for a review that isn't held, a person no longer on People, or an owner who is gone. Logged with ids only.
 */
export async function mailReviewSummary(deps: SummaryMailDeps, send: SummarySend, token: string, sender?: MailSender): Promise<string[]> {
  const ids = { mapId: send.mapId, reviewId: send.reviewId };
  if (!deps.mailer || send.to.length === 0) return [];
  const owner = await deps.owner(send.ownerUserId);
  if (!owner) return [];
  // In the name of who pressed Send summary (plan 15), else the owner's.
  const actor: Actor = sender?.actor ?? { kind: 'owner', userId: owner.contact.userId, displayName: owner.contact.name };
  const replyTo = sender ? sender.email : owner.contact.email;
  const read = await readMap(owner.deps, actor, { mapId: send.mapId });
  if (!read.ok) {
    deps.log('review_summary_mail_failed', { ...ids, error: read.error });
    return [];
  }
  const review = read.value.value.reviews.find((r) => r.id === send.reviewId);
  if (!review || review.state !== 'held' || review.heldOn === null) return [];
  const ourName = await deps.ourName(send.ownerUserId);
  const sent: string[] = [];
  for (const to of send.to) {
    const person = read.value.value.people.find((p) => p.id === to.personId);
    if (!person) continue;
    const email = await reviewSummaryEmail({
      ownerName: sender?.name ?? owner.contact.name, ourName, personName: person.name, heldOn: review.heldOn, url: deps.summaryUrl(token),
    });
    const out = await deps.mailer.send({ to: to.email, ...email, ...(replyTo ? { replyTo } : {}) }, ids);
    if (out.ok) sent.push(to.personId);
    else deps.log('review_summary_mail_failed', { ...ids, error: 'send' });
  }
  return sent;
}
