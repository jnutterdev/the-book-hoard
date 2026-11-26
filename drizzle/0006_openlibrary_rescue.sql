CREATE TABLE `open_library_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`payload` text,
	`fetched_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `open_library_cache_key_unique` ON `open_library_cache` (`key`);--> statement-breakpoint
ALTER TABLE `import_rows` ADD `open_library` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `open_library_status` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `draft` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `hardcover_prep` text;