CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`scryfall_id` text NOT NULL,
	`name` text NOT NULL,
	`set_code` text NOT NULL,
	`set_name` text NOT NULL,
	`collector_number` text NOT NULL,
	`rarity` text NOT NULL,
	`colors` text DEFAULT '[]' NOT NULL,
	`is_foil` integer DEFAULT false NOT NULL,
	`condition` text DEFAULT 'NM' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`price_usd` real,
	`price_usd_foil` real,
	`price_fetched_at` integer,
	`image_uri` text,
	`scryfall_uri` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cards_session` ON `cards` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_cards_rarity` ON `cards` (`rarity`);--> statement-breakpoint
CREATE INDEX `idx_cards_set` ON `cards` (`set_code`);--> statement-breakpoint
CREATE INDEX `idx_cards_foil` ON `cards` (`is_foil`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`set_code` text,
	`cost_paid` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
