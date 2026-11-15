CREATE TABLE `map_links` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`person_id` text NOT NULL,
	`side` text NOT NULL,
	`email_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_links_token_hash_unique` ON `map_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `map_links_map_id_idx` ON `map_links` (`map_id`);--> statement-breakpoint
CREATE INDEX `map_links_owner_user_id_idx` ON `map_links` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `map_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`map_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_sessions_token_hash_unique` ON `map_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `map_sessions_link_id_idx` ON `map_sessions` (`link_id`);--> statement-breakpoint
CREATE INDEX `map_sessions_map_id_idx` ON `map_sessions` (`map_id`);--> statement-breakpoint
CREATE TABLE `maps` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`partner_type` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`notify_settings` text DEFAULT '{}' NOT NULL,
	`momentum_state` text,
	`paused_reason` text,
	`dates_moved_for` text,
	`dates_move_failed_for` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maps_file_id_unique` ON `maps` (`file_id`);--> statement-breakpoint
CREATE INDEX `maps_company_id_idx` ON `maps` (`company_id`);--> statement-breakpoint
CREATE INDEX `maps_owner_user_id_idx` ON `maps` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `maps_company_partner_unique` ON `maps` (`company_id`,`partner_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
