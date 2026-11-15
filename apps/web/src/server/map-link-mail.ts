// The magic link mail (Share's Send link, and a new link asked for). The MAP is read as its owner through `readMap`.
import { readMap, type Actor } from '@partner-desk/commands';
import type { Side } from '@partner-desk/core';
import { magicLinkEmail } from './emails/magic-link';
import type { Mailer } from './mailer';
import type { OwnerOf } from './map-notifications';

/**
 * The person who pressed Send link or Send summary (plan 15): the email names them and replies go to them, and the MAP
 * is read as them. Hosted, the owner themselves; on a company server, the member. A new link someone asked for has none.
 */
export interface MailSender {
  actor: Actor;
  name: string;
  email: string;
}

export interface LinkMailDeps {
  mailer: Mailer | null;
  owner: OwnerOf;
  /** The owner's company name, or null: a colleague on our side edits "{company}’s side". */
  ourName: (ownerUserId: string) => Promise<string | null>;
  /** The link's address on APP_URL. */
  linkUrl: (token: string) => string;
  log: (event: string, ids: Record<string, string>) => void;
}

/**
 * Emails one person their link to a MAP, on the behalf of who sent it (`sender`), else the owner's: replies go to them,
 * and none on a company server without a sender. `email` is where it goes: the
 * person's address in People (Send link), or the address that asked for a new link and matched theirs. True once sent.
 * Logged with ids only.
 */
export async function mailMapLink(
  deps: LinkMailDeps, to: { ownerUserId: string; mapId: string; personId: string; side: Side; email: string }, token: string, sender?: MailSender,
): Promise<boolean> {
  const ids = { mapId: to.mapId };
  if (!deps.mailer) return false;
  const owner = await deps.owner(to.ownerUserId);
  if (!owner) return false;
  const actor: Actor = sender?.actor ?? { kind: 'owner', userId: owner.contact.userId, displayName: owner.contact.name };
  const replyTo = sender ? sender.email : owner.contact.email;
  const read = await readMap(owner.deps, actor, { mapId: to.mapId });
  if (!read.ok) {
    deps.log('map_link_mail_failed', { ...ids, error: read.error });
    return false;
  }
  const person = read.value.value.people.find((p) => p.id === to.personId);
  if (!person) return false;
  const email = await magicLinkEmail({
    ownerName: sender?.name ?? owner.contact.name, partnerName: read.value.info.partnerName, personName: person.name, side: to.side, url: deps.linkUrl(token),
    ourName: await deps.ourName(to.ownerUserId),
  });
  const sent = await deps.mailer.send({ to: to.email, ...email, ...(replyTo ? { replyTo } : {}) }, ids);
  if (!sent.ok) deps.log('map_link_mail_failed', { ...ids, error: 'send' });
  return sent.ok;
}
