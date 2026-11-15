CREATE TABLE `workspace` (
	`slot` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "workspace_one_row" CHECK("workspace"."slot" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_id_unique` ON `workspace` (`id`);--> statement-breakpoint
CREATE TABLE `workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "workspace_invites_role" CHECK("workspace_invites"."role" IN ('admin', 'partnerManager', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_email_unique` ON `workspace_invites` (`email`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`person_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`added_by` text,
	`added_at` text NOT NULL,
	CONSTRAINT "workspace_members_role" CHECK("workspace_members"."role" IN ('admin', 'partnerManager', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX `workspace_members_role_idx` ON `workspace_members` (`role`);