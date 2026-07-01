CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`position` integer,
	`added_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `searches` ADD `room_id` text;