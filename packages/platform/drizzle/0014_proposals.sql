CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`partner_id` text,
	`market_id` text,
	`hypothesis_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`answered_at` text,
	`expires_at` text NOT NULL,
	`maker_kind` text NOT NULL,
	`maker_name` text,
	`client_id` text,
	`key_id` text,
	`file_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proposals_user_status_idx` ON `proposals` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `proposals_status_expires_idx` ON `proposals` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `events` ADD `proposal_id` text;