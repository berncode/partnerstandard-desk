CREATE TABLE `company_facts` (
	`company_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_facts_file_id_unique` ON `company_facts` (`file_id`);--> statement-breakpoint
CREATE TABLE `programmes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`display_name` text NOT NULL,
	`partner_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `programmes_file_id_unique` ON `programmes` (`file_id`);--> statement-breakpoint
CREATE INDEX `programmes_company_id_idx` ON `programmes` (`company_id`);