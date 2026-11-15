CREATE TABLE `webhook_deliveries` (
	`id` text NOT NULL,
	`webhook_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`occurred_at` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_try_at` integer,
	`last_status` integer,
	`done_at` text,
	`given_up_at` text,
	PRIMARY KEY(`id`, `webhook_id`)
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_next_try_idx` ON `webhook_deliveries` (`next_try_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_id_idx` ON `webhook_deliveries` (`webhook_id`);--> statement-breakpoint
CREATE TABLE `webhook_marks` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`secret_enc` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`first_failure_at` integer
);
--> statement-breakpoint
CREATE INDEX `webhooks_user_id_idx` ON `webhooks` (`user_id`);