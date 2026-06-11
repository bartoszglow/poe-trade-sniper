PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`item_name` text NOT NULL,
	`price` text,
	`seller` text NOT NULL,
	`item` text,
	`detected_at` text NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_hits`("id", "search_id", "listing_id", "item_name", "price", "seller", "item", "detected_at") SELECT "id", "search_id", "listing_id", "item_name", "price", "seller", "item", "detected_at" FROM `hits`;--> statement-breakpoint
DROP TABLE `hits`;--> statement-breakpoint
ALTER TABLE `__new_hits` RENAME TO `hits`;--> statement-breakpoint
PRAGMA foreign_keys=ON;