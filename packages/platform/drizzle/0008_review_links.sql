CREATE TABLE `review_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`map_id` text NOT NULL,
	`review_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_links_token_hash_unique` ON `review_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `review_links_owner_map_idx` ON `review_links` (`owner_user_id`,`map_id`);