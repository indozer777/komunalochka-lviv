CREATE TABLE `premium_access` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expires_at` integer,
	`revoked` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	`granted_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `premium_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `premium_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`label` text NOT NULL,
	`max_uses` integer NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`access_days` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premium_codes_code_hash_unique` ON `premium_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `premium_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `premium_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redeemed_at` integer NOT NULL,
	FOREIGN KEY (`code_id`) REFERENCES `premium_codes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `premium_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premium_redemption_once` ON `premium_redemptions` (`code_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `premium_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`review_id` text,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `premium_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premium_request_pending` ON `premium_requests` (`user_id`) WHERE "premium_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `premium_request_queue` ON `premium_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `premium_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
