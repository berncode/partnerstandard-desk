/**
 * The roles on a company server (spec 2026-11-07 §7.1, plan 15). An admin may all a partner manager may, plus members,
 * invites and the company's name and time zone; a partner manager does all partner work; a viewer reads.
 */
export const WORKSPACE_ROLES = ['admin', 'partnerManager', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** How long an invited address may ask for its first sign-in link (plan 15). */
export const INVITE_DAYS = 7;
