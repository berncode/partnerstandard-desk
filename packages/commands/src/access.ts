import type { MarketChange, PartnerChange, WorkspaceRole } from '@partner-desk/core';
import { levelAtLeast, type Actor } from './actor';

export const COMMAND_NAMES = [
  'partners.read', 'partners.change', 'partners.import', 'partners.remove', 'partners.recreate',
  'markets.read', 'markets.create', 'markets.change', 'markets.copy', 'markets.list', 'markets.archive',
  'company.read', 'company.rename', 'company.timezone',
  'companyFacts.read', 'companyFacts.save',
  'programs.list', 'programs.read', 'programs.create', 'programs.save', 'programs.delete', 'programs.refreshOutputs',
  'cases.list', 'cases.read', 'cases.create', 'cases.save', 'cases.copy', 'cases.recalculate', 'cases.delete',
  'cases.share', 'cases.unshare',
  'maps.list', 'maps.read', 'maps.start', 'maps.change', 'maps.delete', 'maps.share', 'maps.revoke', 'maps.shiftDates',
  'maps.notify', 'maps.notifyRead',
  'reviews.list', 'reviews.read', 'reviews.open', 'reviews.close', 'reviews.share', 'reviews.revoke',
  'week.read',
  'webhooks.list', 'webhooks.create', 'webhooks.delete', 'webhooks.test', 'webhooks.deliveries', 'webhooks.turnOff', 'webhooks.turnOn',
  'webhooks.resend',
  'proposals.create', 'proposals.list', 'proposals.withdraw', 'proposals.accept', 'proposals.reject',
  'files.export',
  'members.list', 'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel',
  'trash.list', 'trash.restore',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export const READ_COMMANDS: readonly CommandName[] = [
  'partners.read', 'markets.read', 'markets.list', 'companyFacts.read', 'programs.list', 'programs.read', 'cases.list', 'cases.read',
  'maps.list', 'maps.read', 'reviews.list', 'reviews.read', 'week.read', 'webhooks.list', 'webhooks.deliveries', 'proposals.list',
  'members.list', 'company.read', 'maps.notifyRead',
];

/**
 * Never for an agent, at any level. Moving a MAP's open dates goes with signing, a person's decision (ruling R4). The
 * timezone and a MAP's email settings decide what goes out by email in the person's name [builder's call]. Sending a
 * webhook delivery again is Settings' button only, no tool (question 28) [builder's call]. Accepting or rejecting a
 * proposal is the person's answer (agent proposals spec 5.2).
 */
export const OWNER_ONLY_COMMANDS: readonly CommandName[] = [
  'partners.recreate', 'markets.archive', 'company.rename', 'company.timezone', 'maps.shiftDates', 'maps.notify', 'webhooks.resend',
  // A database file's spreadsheet download: the person's button in the browser; agents read through their own tools.
  'files.export',
  'proposals.accept', 'proposals.reject',
  // Reading the company's time zone and a MAP's email settings: the person's Settings and dialog, as their changes are.
  'company.read', 'maps.notifyRead',
  // A company server's members and invites (plan 15): a person's own decision; the list names people, so no agent reads it.
  'members.list', 'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel',
  // The trash (plan 16): what a person deleted, brought back by a person.
  'trash.list', 'trash.restore',
];

/**
 * A company server's admin only (spec 2026-11-07 §7.1, plan 15): the members, the invites, and the company's name and
 * time zone. Hosted, the owner is the admin of a workspace of one.
 */
export const ADMIN_COMMANDS: readonly CommandName[] = [
  'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel', 'company.rename', 'company.timezone',
  'trash.list', 'trash.restore',
];

/**
 * All a company server's viewer may run: the reads, a database file's download, which is reading too, and turning off or
 * deleting their own webhooks, made when they had another role [builder's call]. No change, no decision, no link, no
 * import, no new webhook (spec 2026-11-07 §7.1).
 */
export const VIEWER_COMMANDS: readonly CommandName[] = [...READ_COMMANDS, 'files.export', 'webhooks.turnOff', 'webhooks.delete'];

/** A company server's members and invites: only a member runs them, within their role. */
const MEMBER_COMMANDS: readonly CommandName[] = ['members.list', 'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel'];

/** The role rule, before every other (spec 2026-11-07 §7.2): an agent acts within its member's role too. */
function roleAllows(role: WorkspaceRole, command: CommandName, kind: Actor['kind']): boolean {
  if (role === 'admin') return true;
  if (role === 'partnerManager') return !ADMIN_COMMANDS.includes(command);
  // A viewer's agent reads, and nothing else (spec 2026-11-07 §7.1).
  return kind === 'agent' ? READ_COMMANDS.includes(command) : VIEWER_COMMANDS.includes(command);
}

/** Only an agent at level propose: a person doesn't propose, they act (agent proposals spec 5.2). */
const PROPOSE_COMMANDS: readonly CommandName[] = ['proposals.create', 'proposals.withdraw'];

/** Commands whose change is a `MarketChange`: a new market's info is judged as an `updateInfo` of it. */
const MARKET_CHANGE_COMMANDS: readonly CommandName[] = ['markets.change', 'markets.create'];

/** Commands judged change by change: without the change, `can` refuses them (it fails closed). */
const CHANGE_COMMANDS: readonly CommandName[] = ['partners.change', 'partners.import', 'partners.remove', 'markets.change'];

/** Changes that move a partner through a decision. An agent may only propose these. */
export const DECISION_CHANGES: readonly PartnerChange['kind'][] = [
  'setStep', 'markSigned', 'setStage', 'close', 'reopen', 'markExited', 'undoSigned', 'correctExit',
];

/**
 * Commands that are a decision as a whole. An agent may only propose these; the proposal flow comes later. Sharing a
 * case shows it outside (spec 8), and deleting one moves its file to the trash [builder's call]. The same for a MAP:
 * sending a link is a proposal (MAP spec 8), and deleting one trashes its file and turns its links off. Closing a review
 * starts the next horizon, and sharing its summary sends it to the partner (reviews spec 8).
 */
export const DECISION_COMMANDS: readonly CommandName[] = [
  'programs.delete', 'cases.share', 'cases.delete', 'maps.share', 'maps.delete', 'reviews.close', 'reviews.share',
];

/** All a person with a link may do, on their own MAP only (spec 4). Never a review: they see none (reviews spec 8). */
const LINK_COMMANDS: readonly CommandName[] = ['maps.read', 'maps.change'];

const has = (fields: Record<string, unknown>, key: string): boolean => Object.hasOwn(fields, key);

/**
 * A decision: moves a partner through the method, removes one, sets a 4C score (desk or confirmed), or adds a partner
 * or an account. Agents only propose these (agent proposals spec 5.2). Adding a partner or an account one at a time
 * would be the import an agent must propose [builder's call]. Any write of a Proposals row is one too: only the
 * proposals commands write those rows, directly to the store, after their own `can` [builder's call].
 */
export const isDecision = (change: PartnerChange): boolean => {
  if (DECISION_CHANGES.includes(change.kind)) return true;
  switch (change.kind) {
    case 'delete':
      return change.entity === 'partner' || change.entity === 'proposalItem';
    case 'add':
      return change.entity === 'partner' || change.entity === 'account' || change.entity === 'proposalItem';
    case 'update':
      return change.entity === 'proposalItem'
        || (change.entity === 'partner' && (has(change.patch, 'desk') || has(change.patch, 'confirmed')));
    default:
      return false;
  }
};

/**
 * A market decision: a market's status and its status note (spec 4, `propose_market_status`), a partner
 * hypothesis's status (agent proposals spec 5.2), or deleting a hypothesis. Agents only propose these.
 */
export const isMarketDecision = (change: MarketChange): boolean => {
  switch (change.kind) {
    case 'updateInfo':
      return has(change.patch, 'status') || has(change.patch, 'statusNote');
    case 'add':
      return change.entity === 'hypothesis' && has(change.values, 'status');
    case 'update':
      return change.entity === 'hypothesis' && has(change.patch, 'status');
    case 'delete':
      // Deleting a hypothesis would get around "Dropped", the person's decision (question 34, builder's call 2026-11-12).
      return change.entity === 'hypothesis';
    default:
      return false;
  }
};

/**
 * The resource's owner only; on a company server, within the member's role first (`roleAllows`). An agent acts with that person's access: reads always, changes at level `change` or
 * `propose`, proposals at `propose`, never a decision. A person with a link reads and changes the one MAP it is for
 * (`resource.mapId`), and nothing else; which side they may change is the MAP's own rule (`canChangeMap`).
 *
 * `change` is a `MarketChange` for `markets.change` and `markets.create` (the new market's info as an `updateInfo`),
 * and a `PartnerChange` for the partner commands.
 */
export function can(
  actor: Actor, command: CommandName, resource: { ownerUserId: string; mapId?: string }, change?: PartnerChange | MarketChange,
): boolean {
  if (actor.userId !== resource.ownerUserId) return false;
  if (actor.kind !== 'link' && actor.member && !roleAllows(actor.member.role, command, actor.kind)) return false;
  // Members and invites are a company server's: without a member (hosted, a test user) there is nothing to manage.
  if (MEMBER_COMMANDS.includes(command) && (actor.kind === 'link' || !actor.member)) return false;
  if (actor.kind === 'link') return LINK_COMMANDS.includes(command) && resource.mapId !== undefined && resource.mapId === actor.mapId;
  if (PROPOSE_COMMANDS.includes(command)) return actor.kind === 'agent' && actor.level === 'propose';
  // Fails closed: a partner change, import or removal, and a market change, are judged change by change, so they need
  // the change. A removal passes the partner type's delete, a decision: only a person removes a partner type.
  if (!change && CHANGE_COMMANDS.includes(command)) return false;
  if (actor.kind === 'owner') return true;
  if (OWNER_ONLY_COMMANDS.includes(command) || DECISION_COMMANDS.includes(command)) return false;
  if (READ_COMMANDS.includes(command)) return true;
  // An import adds partners: an agent proposes them instead (spec 5.2).
  if (command === 'partners.import') return false;
  if (!levelAtLeast(actor.level, 'change')) return false;
  if (!change) return true;
  return MARKET_CHANGE_COMMANDS.includes(command) ? !isMarketDecision(change as MarketChange) : !isDecision(change as PartnerChange);
}
