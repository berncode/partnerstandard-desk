CREATE TABLE `business_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`partner_type` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_cases_file_id_unique` ON `business_cases` (`file_id`);--> statement-breakpoint
CREATE INDEX `business_cases_company_id_idx` ON `business_cases` (`company_id`);--> statement-breakpoint
CREATE INDEX `business_cases_partner_id_idx` ON `business_cases` (`partner_id`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `share_links_owner_case_idx` ON `share_links` (`owner_user_id`,`case_id`);