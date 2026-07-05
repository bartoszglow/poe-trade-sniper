CREATE TABLE `deal_baseline_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`watch_id` text NOT NULL,
	`amount_exalted` real NOT NULL,
	`raw_lowest_exalted` real NOT NULL,
	`sample_size` integer NOT NULL,
	`rederived` integer DEFAULT false NOT NULL,
	`computed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deal_baseline_history_watch_computed` ON `deal_baseline_history` (`watch_id`,`computed_at`);