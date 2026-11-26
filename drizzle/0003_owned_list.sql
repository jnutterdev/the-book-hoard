CREATE TABLE `app_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_meta_key_unique` ON `app_meta` (`key`);--> statement-breakpoint
ALTER TABLE `lists` ADD `slug` text;