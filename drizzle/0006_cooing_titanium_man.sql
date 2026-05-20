CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`mac` text NOT NULL,
	`hostname` text,
	`name` text,
	`display_alias` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer,
	FOREIGN KEY (`controller_id`) REFERENCES `controllers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_controller_mac_unique` ON `clients` (`controller_id`,`mac`);--> statement-breakpoint
CREATE INDEX `clients_site_idx` ON `clients` (`site_id`);--> statement-breakpoint
CREATE INDEX `clients_alias_idx` ON `clients` (`display_alias`);