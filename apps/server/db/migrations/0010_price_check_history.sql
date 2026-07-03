CREATE TABLE `price_check_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result` text NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_check_history_checked_at` ON `price_check_history` (`checked_at`);