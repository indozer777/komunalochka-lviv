CREATE TABLE `telegram_bindings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`name` text NOT NULL,
	`connected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_bindings_chat_id_unique` ON `telegram_bindings` (`chat_id`);--> statement-breakpoint
CREATE TABLE `telegram_completed` (
	`reminder_id` text NOT NULL,
	`period` text NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`reminder_id`, `period`),
	FOREIGN KEY (`reminder_id`) REFERENCES `telegram_reminders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telegram_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`reminder_id` text NOT NULL,
	`period` text NOT NULL,
	`chat_id` text NOT NULL,
	`status` text NOT NULL,
	`next_at` integer,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`message_id` integer,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reminder_id`) REFERENCES `telegram_reminders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_delivery_month` ON `telegram_deliveries` (`reminder_id`,`period`);--> statement-breakpoint
CREATE INDEX `telegram_delivery_queue` ON `telegram_deliveries` (`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `telegram_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`chat_id` text,
	`name` text
);
--> statement-breakpoint
CREATE INDEX `telegram_link_user` ON `telegram_links` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`kind` text NOT NULL,
	`day` integer NOT NULL,
	`time` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`next_due` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telegram_due` ON `telegram_reminders` (`enabled`,`deleted`,`next_due`);--> statement-breakpoint
CREATE INDEX `telegram_reminder_user` ON `telegram_reminders` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
