CREATE TABLE `work_files` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`company_id` text NOT NULL,
	`format_version` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`trashed_at` text
);
--> statement-breakpoint
CREATE INDEX `work_files_company_idx` ON `work_files` (`company_id`);