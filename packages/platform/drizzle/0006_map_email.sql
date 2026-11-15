CREATE TABLE `email_prefs` (
	`email_hash` text NOT NULL,
	`type` text NOT NULL,
	`unsubscribed_at` text NOT NULL,
	PRIMARY KEY(`email_hash`, `type`)
);
--> statement-breakpoint
CREATE TABLE `map_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`map_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_ref` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `map_events_map_id_idx` ON `map_events` (`map_id`,`id`);--> statement-breakpoint
CREATE TABLE `notification_log` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`map_id` text,
	`recipient_email` text,
	`claimed_at` text NOT NULL,
	`sent_at` text,
	`resend_id` text
);
--> statement-breakpoint
CREATE INDEX `notification_log_map_id_idx` ON `notification_log` (`map_id`);--> statement-breakpoint
ALTER TABLE `companies` ADD `timezone` text;--> statement-breakpoint
ALTER TABLE `maps` ADD `digest_health` text;--> statement-breakpoint
ALTER TABLE `maps` ADD `partner_alerts_through` integer;