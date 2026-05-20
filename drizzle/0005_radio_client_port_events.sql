CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text,
	`device_mac` text,
	`device_id` text,
	`client_mac` text,
	`ssid` text,
	`payload_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_fingerprint_unique` ON `events` (`controller_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `events_ts_idx` ON `events` (`ts`);--> statement-breakpoint
CREATE INDEX `events_severity_ts` ON `events` (`severity`,`ts`);--> statement-breakpoint
CREATE INDEX `events_device_ts` ON `events` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `events_type_ts` ON `events` (`event_type`,`ts`);--> statement-breakpoint
CREATE INDEX `events_controller_ts` ON `events` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_client_1h` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ap_device_id` text DEFAULT '' NOT NULL,
	`client_mac` text NOT NULL,
	`essid` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`channel` integer,
	`signal` real,
	`noise` real,
	`tx_rate_kbps` integer,
	`rx_rate_kbps` integer,
	`idle_time` integer,
	`roam_count` integer,
	`is_guest` integer,
	`is_wired` integer,
	`uptime_sec` integer,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`tx_retries` integer,
	`rx_retries` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_client_1h_dim_unique` ON `metrics_client_1h` (`ts`,`controller_id`,`site_id`,`client_mac`);--> statement-breakpoint
CREATE INDEX `metrics_client_1h_controller_ts` ON `metrics_client_1h` (`controller_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_client_1h_client_ts` ON `metrics_client_1h` (`client_mac`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_client_5m` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ap_device_id` text DEFAULT '' NOT NULL,
	`client_mac` text NOT NULL,
	`essid` text DEFAULT '' NOT NULL,
	`radio` text DEFAULT '' NOT NULL,
	`channel` integer,
	`signal` real,
	`noise` real,
	`tx_rate_kbps` integer,
	`rx_rate_kbps` integer,
	`idle_time` integer,
	`roam_count` integer,
	`is_guest` integer,
	`is_wired` integer,
	`uptime_sec` integer,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`tx_retries` integer,
	`rx_retries` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_client_5m_dim_unique` ON `metrics_client_5m` (`ts`,`controller_id`,`site_id`,`client_mac`);--> statement-breakpoint
CREATE INDEX `metrics_client_5m_ap_ts` ON `metrics_client_5m` (`ap_device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_client_5m_controller_ts` ON `metrics_client_5m` (`controller_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_client_5m_client_ts` ON `metrics_client_5m` (`client_mac`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_port_1d` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`port_idx` integer NOT NULL,
	`name` text,
	`enable` integer,
	`up` integer,
	`speed` integer,
	`full_duplex` integer,
	`poe_enable` integer,
	`poe_power` real,
	`poe_voltage` real,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`tx_packets` integer,
	`rx_packets` integer,
	`tx_errors` integer,
	`rx_errors` integer,
	`tx_dropped` integer,
	`rx_dropped` integer,
	`d_tx_bytes` integer,
	`d_rx_bytes` integer,
	`d_tx_packets` integer,
	`d_rx_packets` integer,
	`d_tx_errors` integer,
	`d_rx_errors` integer,
	`d_tx_dropped` integer,
	`d_rx_dropped` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_port_1d_dim_unique` ON `metrics_port_1d` (`ts`,`controller_id`,`site_id`,`device_id`,`port_idx`);--> statement-breakpoint
CREATE INDEX `metrics_port_1d_device_ts` ON `metrics_port_1d` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_port_1d_controller_ts` ON `metrics_port_1d` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_port_1h` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`port_idx` integer NOT NULL,
	`name` text,
	`enable` integer,
	`up` integer,
	`speed` integer,
	`full_duplex` integer,
	`poe_enable` integer,
	`poe_power` real,
	`poe_voltage` real,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`tx_packets` integer,
	`rx_packets` integer,
	`tx_errors` integer,
	`rx_errors` integer,
	`tx_dropped` integer,
	`rx_dropped` integer,
	`d_tx_bytes` integer,
	`d_rx_bytes` integer,
	`d_tx_packets` integer,
	`d_rx_packets` integer,
	`d_tx_errors` integer,
	`d_rx_errors` integer,
	`d_tx_dropped` integer,
	`d_rx_dropped` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_port_1h_dim_unique` ON `metrics_port_1h` (`ts`,`controller_id`,`site_id`,`device_id`,`port_idx`);--> statement-breakpoint
CREATE INDEX `metrics_port_1h_device_ts` ON `metrics_port_1h` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_port_1h_controller_ts` ON `metrics_port_1h` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_port_5m` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`port_idx` integer NOT NULL,
	`name` text,
	`enable` integer,
	`up` integer,
	`speed` integer,
	`full_duplex` integer,
	`poe_enable` integer,
	`poe_power` real,
	`poe_voltage` real,
	`tx_bytes` integer,
	`rx_bytes` integer,
	`tx_packets` integer,
	`rx_packets` integer,
	`tx_errors` integer,
	`rx_errors` integer,
	`tx_dropped` integer,
	`rx_dropped` integer,
	`d_tx_bytes` integer,
	`d_rx_bytes` integer,
	`d_tx_packets` integer,
	`d_rx_packets` integer,
	`d_tx_errors` integer,
	`d_rx_errors` integer,
	`d_tx_dropped` integer,
	`d_rx_dropped` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_port_5m_dim_unique` ON `metrics_port_5m` (`ts`,`controller_id`,`site_id`,`device_id`,`port_idx`);--> statement-breakpoint
CREATE INDEX `metrics_port_5m_device_ts` ON `metrics_port_5m` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_port_5m_controller_ts` ON `metrics_port_5m` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_radio_1d` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`radio` text NOT NULL,
	`channel` integer,
	`tx_power` integer,
	`state` text,
	`num_sta` integer,
	`user_num_sta` integer,
	`guest_num_sta` integer,
	`cu_total` real,
	`cu_self_tx` real,
	`cu_self_rx` real,
	`satisfaction` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_radio_1d_dim_unique` ON `metrics_radio_1d` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`);--> statement-breakpoint
CREATE INDEX `metrics_radio_1d_device_ts` ON `metrics_radio_1d` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_radio_1d_controller_ts` ON `metrics_radio_1d` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_radio_1h` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`radio` text NOT NULL,
	`channel` integer,
	`tx_power` integer,
	`state` text,
	`num_sta` integer,
	`user_num_sta` integer,
	`guest_num_sta` integer,
	`cu_total` real,
	`cu_self_tx` real,
	`cu_self_rx` real,
	`satisfaction` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_radio_1h_dim_unique` ON `metrics_radio_1h` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`);--> statement-breakpoint
CREATE INDEX `metrics_radio_1h_device_ts` ON `metrics_radio_1h` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_radio_1h_controller_ts` ON `metrics_radio_1h` (`controller_id`,`ts`);--> statement-breakpoint
CREATE TABLE `metrics_radio_5m` (
	`ts` integer NOT NULL,
	`controller_id` text NOT NULL,
	`site_id` text NOT NULL,
	`device_id` text NOT NULL,
	`radio` text NOT NULL,
	`channel` integer,
	`tx_power` integer,
	`state` text,
	`num_sta` integer,
	`user_num_sta` integer,
	`guest_num_sta` integer,
	`cu_total` real,
	`cu_self_tx` real,
	`cu_self_rx` real,
	`satisfaction` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_radio_5m_dim_unique` ON `metrics_radio_5m` (`ts`,`controller_id`,`site_id`,`device_id`,`radio`);--> statement-breakpoint
CREATE INDEX `metrics_radio_5m_device_ts` ON `metrics_radio_5m` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `metrics_radio_5m_controller_ts` ON `metrics_radio_5m` (`controller_id`,`ts`);--> statement-breakpoint
ALTER TABLE `metrics_1d` ADD `temp_cpu` real;--> statement-breakpoint
ALTER TABLE `metrics_1d` ADD `temp_board` real;--> statement-breakpoint
ALTER TABLE `metrics_1h` ADD `temp_cpu` real;--> statement-breakpoint
ALTER TABLE `metrics_1h` ADD `temp_board` real;--> statement-breakpoint
ALTER TABLE `metrics_5m` ADD `temp_cpu` real;--> statement-breakpoint
ALTER TABLE `metrics_5m` ADD `temp_board` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `tx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `rx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `tx_retries` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `tx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `rx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `ccq` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `satisfaction` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `d_tx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `d_rx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `d_tx_retries` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `d_tx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1d` ADD `d_rx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `tx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `rx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `tx_retries` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `tx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `rx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `ccq` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `satisfaction` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `d_tx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `d_rx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `d_tx_retries` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `d_tx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_1h` ADD `d_rx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `tx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `rx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `tx_retries` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `tx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `rx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `ccq` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `satisfaction` real;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `d_tx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `d_rx_packets` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `d_tx_retries` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `d_tx_dropped` integer;--> statement-breakpoint
ALTER TABLE `metrics_vap_5m` ADD `d_rx_dropped` integer;