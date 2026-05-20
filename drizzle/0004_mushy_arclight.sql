CREATE TABLE `metrics_vap_1d` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`radio` text NOT NULL,
	`ssid` text NOT NULL,
	`num_sta` integer,
	`is_guest` integer,
	`avg_client_signal` real,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`mac_filter_rejections` integer,
	`d_tx_bytes` integer,
	`d_rx_bytes` integer,
	`d_mac_filter_rejections` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_vap_1d_dim_unique` ON `metrics_vap_1d` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`,`ssid`);--> statement-breakpoint
CREATE INDEX `metrics_vap_1d_device_ts` ON `metrics_vap_1d` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_vap_1d_ssid_ts` ON `metrics_vap_1d` (`ssid`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_vap_1d_controller_ts` ON `metrics_vap_1d` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_vap_1h` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`radio` text NOT NULL,
	`ssid` text NOT NULL,
	`num_sta` integer,
	`is_guest` integer,
	`avg_client_signal` real,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`mac_filter_rejections` integer,
	`d_tx_bytes` integer,
	`d_rx_bytes` integer,
	`d_mac_filter_rejections` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_vap_1h_dim_unique` ON `metrics_vap_1h` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`,`ssid`);--> statement-breakpoint
CREATE INDEX `metrics_vap_1h_device_ts` ON `metrics_vap_1h` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_vap_1h_ssid_ts` ON `metrics_vap_1h` (`ssid`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_vap_1h_controller_ts` ON `metrics_vap_1h` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_vap_5m` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`radio` text NOT NULL,
	`ssid` text NOT NULL,
	`num_sta` integer,
	`is_guest` integer,
	`avg_client_signal` real,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`mac_filter_rejections` integer,
	`d_tx_bytes` integer,
	`d_rx_bytes` integer,
	`d_mac_filter_rejections` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_vap_5m_dim_unique` ON `metrics_vap_5m` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`,`ssid`);--> statement-breakpoint
CREATE INDEX `metrics_vap_5m_device_ts` ON `metrics_vap_5m` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_vap_5m_ssid_ts` ON `metrics_vap_5m` (`ssid`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_vap_5m_controller_ts` ON `metrics_vap_5m` (`controller_id`,`ts`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_counter_state` (
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`client_mac` text DEFAULT '' NOT NULL,
	`ssid` text DEFAULT '' NOT NULL,
	`metric` text NOT NULL,
	`last_value` integer NOT NULL,
	`last_ts` integer NOT NULL,
	PRIMARY KEY(`controller_id`, `site_id`, `device_id`, `radio`, `client_mac`, `ssid`, `metric`)
);
--> statement-breakpoint
INSERT INTO `__new_counter_state`("controller_id", "site_id", "device_id", "radio", "client_mac", "ssid", "metric", "last_value", "last_ts") SELECT "controller_id", "site_id", "device_id", "radio", "client_mac", '' AS "ssid", "metric", "last_value", "last_ts" FROM `counter_state`;--> statement-breakpoint
DROP TABLE `counter_state`;--> statement-breakpoint
ALTER TABLE `__new_counter_state` RENAME TO `counter_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;