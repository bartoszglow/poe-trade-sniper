CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text,
	`listing_id` text,
	`source` text NOT NULL,
	`item_name` text NOT NULL,
	`price` text,
	`seller` text,
	`item` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text NOT NULL,
	`returned_home` integer,
	`steps` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_started_at` ON `activity` (`started_at`);