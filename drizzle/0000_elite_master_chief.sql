CREATE TABLE `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`actor` text,
	`action` text NOT NULL,
	`target` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_ts_idx` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE TABLE `controllers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`variant` text,
	`auth_mode` text NOT NULL,
	`username` text,
	`password_enc` blob,
	`api_key_enc` blob,
	`insecure_tls` integer DEFAULT 0 NOT NULL,
	`poll_seconds` integer DEFAULT 300 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_seen_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `controllers_name_unique` ON `controllers` (`name`);--> statement-breakpoint
CREATE TABLE `counter_state` (
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`client_mac` text DEFAULT '' NOT NULL,
	`metric` text NOT NULL,
	`last_value` integer NOT NULL,
	`last_ts` integer NOT NULL,
	PRIMARY KEY(`controller_id`, `site_id`, `device_id`, `radio`, `client_mac`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`mac` text NOT NULL,
	`name` text,
	`model` text,
	`type` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer,
	FOREIGN KEY (`controller_id`) REFERENCES `controllers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_controller_mac_unique` ON `devices` (`controller_id`,`mac`);--> statement-breakpoint
CREATE INDEX `devices_site_idx` ON `devices` (`site_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text,
	`run_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`run_at`,`locked_until`);--> statement-breakpoint
CREATE TABLE `metrics_1d` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`client_mac` text DEFAULT '' NOT NULL,
	`client_count` integer,
	`tx_bytes` integer,
	`tx_packets` integer,
	`tx_dropped` integer,
	`tx_errors` integer,
	`tx_retries` integer,
	`d_tx_bytes` integer,
	`d_tx_packets` integer,
	`d_tx_dropped` integer,
	`d_tx_errors` integer,
	`d_tx_retries` integer,
	`retry_rate` real,
	`error_rate` real,
	`drop_rate` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_1d_dim_unique` ON `metrics_1d` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`,`client_mac`);--> statement-breakpoint
CREATE INDEX `metrics_1d_device_ts` ON `metrics_1d` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_1d_site_ts` ON `metrics_1d` (`site_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_1h` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`client_mac` text DEFAULT '' NOT NULL,
	`client_count` integer,
	`tx_bytes` integer,
	`tx_packets` integer,
	`tx_dropped` integer,
	`tx_errors` integer,
	`tx_retries` integer,
	`d_tx_bytes` integer,
	`d_tx_packets` integer,
	`d_tx_dropped` integer,
	`d_tx_errors` integer,
	`d_tx_retries` integer,
	`retry_rate` real,
	`error_rate` real,
	`drop_rate` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_1h_dim_unique` ON `metrics_1h` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`,`client_mac`);--> statement-breakpoint
CREATE INDEX `metrics_1h_device_ts` ON `metrics_1h` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_1h_site_ts` ON `metrics_1h` (`site_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_5m` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`client_mac` text DEFAULT '' NOT NULL,
	`client_count` integer,
	`tx_bytes` integer,
	`tx_packets` integer,
	`tx_dropped` integer,
	`tx_errors` integer,
	`tx_retries` integer,
	`d_tx_bytes` integer,
	`d_tx_packets` integer,
	`d_tx_dropped` integer,
	`d_tx_errors` integer,
	`d_tx_retries` integer,
	`retry_rate` real,
	`error_rate` real,
	`drop_rate` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_5m_dim_unique` ON `metrics_5m` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`,`client_mac`);--> statement-breakpoint
CREATE INDEX `metrics_5m_device_ts` ON `metrics_5m` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_5m_site_ts` ON `metrics_5m` (`site_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_5m_client_ts` ON `metrics_5m` (`client_mac`,`ts`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`controller_id` text NOT NULL,
	`unifi_id` text NOT NULL,
	`unifi_name` text NOT NULL,
	`display_name` text NOT NULL,
	`city` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`controller_id`) REFERENCES `controllers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_controller_name_unique` ON `sites` (`controller_id`,`unifi_name`);--> statement-breakpoint
CREATE INDEX `sites_controller_idx` ON `sites` (`controller_id`);