ALTER TABLE `library_entries` ADD `added_at` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `trigger` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `stats` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `error_detail` text;--> statement-breakpoint
CREATE INDEX `sync_runs_started_idx` ON `sync_runs` (`started_at`);