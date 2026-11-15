-- US English (owner, 2026-10-30): the table and its indexes are renamed; the rows stay.
ALTER TABLE `programmes` RENAME TO `programs`;--> statement-breakpoint
DROP INDEX `programmes_file_id_unique`;--> statement-breakpoint
DROP INDEX `programmes_company_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `programs_file_id_unique` ON `programs` (`file_id`);--> statement-breakpoint
CREATE INDEX `programs_company_id_idx` ON `programs` (`company_id`);
