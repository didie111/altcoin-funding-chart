CREATE TABLE `news_history` (
	`exchange` text PRIMARY KEY NOT NULL,
	`next_page` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`checked_at` integer,
	`message` text
);
--> statement-breakpoint
CREATE TABLE `news_jobs` (
	`key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`checked_at` integer,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`fingerprint` text,
	`message` text
);
--> statement-breakpoint
CREATE TABLE `news_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`exchange` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`published_at` integer,
	`checked_at` integer NOT NULL,
	`date_only` integer DEFAULT 0 NOT NULL,
	`scope` text NOT NULL,
	`symbols` text NOT NULL,
	`changed` integer DEFAULT 0 NOT NULL,
	`effective_at` integer,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `news_by_date` ON `news_notices` (`published_at`,`id`);--> statement-breakpoint
CREATE INDEX `news_by_exchange_date` ON `news_notices` (`exchange`,`published_at`,`id`);
CREATE INDEX `news_job_fingerprint` ON `news_jobs` (`fingerprint`);