ALTER TABLE `events` ADD `change` text;--> statement-breakpoint
CREATE INDEX `events_file_change_idx` ON `events` (`file_id`,`change`);