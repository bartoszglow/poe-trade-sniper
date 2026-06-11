CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`item_name` text NOT NULL,
	`price` text,
	`seller` text NOT NULL,
	`item` text NOT NULL,
	`detected_at` text NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`realm` text NOT NULL,
	`league` text NOT NULL,
	`label` text NOT NULL,
	`auto_travel` integer DEFAULT false NOT NULL,
	`filters` text NOT NULL,
	`added_at` text NOT NULL
);
