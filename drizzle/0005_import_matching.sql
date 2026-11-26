ALTER TABLE `import_rows` ADD `parsed` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `match_source` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `match` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `candidates` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `choices` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `note` text;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `committed_at` text;--> statement-breakpoint
ALTER TABLE `list_items` ADD `edition_id` text REFERENCES editions(id);