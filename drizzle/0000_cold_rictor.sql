CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"target" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"mac" text NOT NULL,
	"hostname" text,
	"name" text,
	"display_alias" text,
	"first_seen" bigint NOT NULL,
	"last_seen" bigint
);
--> statement-breakpoint
CREATE TABLE "controllers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"variant" text,
	"auth_mode" text NOT NULL,
	"username" text,
	"password_enc" "bytea",
	"api_key_enc" "bytea",
	"insecure_tls" boolean DEFAULT false NOT NULL,
	"poll_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" bigint,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counter_state" (
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"radio" text DEFAULT '' NOT NULL,
	"client_mac" text DEFAULT '' NOT NULL,
	"ssid" text DEFAULT '' NOT NULL,
	"metric" text NOT NULL,
	"last_value" bigint NOT NULL,
	"last_ts" bigint NOT NULL,
	CONSTRAINT "counter_state_pk" PRIMARY KEY("controller_id","site_id","device_id","radio","client_mac","ssid","metric")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"mac" text NOT NULL,
	"name" text,
	"display_alias" text,
	"model" text,
	"type" text NOT NULL,
	"first_seen" bigint NOT NULL,
	"last_seen" bigint,
	"version" text,
	"serial" text,
	"state" integer
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text,
	"device_mac" text,
	"device_id" text,
	"client_mac" text,
	"ssid" text,
	"payload_json" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload_json" text,
	"run_at" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" bigint,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics_1d" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"radio" text DEFAULT '' NOT NULL,
	"client_mac" text DEFAULT '' NOT NULL,
	"client_count" integer,
	"tx_bytes" bigint,
	"tx_packets" bigint,
	"tx_dropped" bigint,
	"tx_errors" bigint,
	"tx_retries" bigint,
	"rx_bytes" bigint,
	"rx_packets" bigint,
	"rx_dropped" bigint,
	"rx_errors" bigint,
	"d_tx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_tx_dropped" bigint,
	"d_tx_errors" bigint,
	"d_tx_retries" bigint,
	"d_rx_bytes" bigint,
	"d_rx_packets" bigint,
	"d_rx_dropped" bigint,
	"d_rx_errors" bigint,
	"wifi_tx_attempts" bigint,
	"wifi_tx_dropped" bigint,
	"rx_crypts" bigint,
	"mac_filter_rejections" bigint,
	"num_roam_events" bigint,
	"d_wifi_tx_attempts" bigint,
	"d_wifi_tx_dropped" bigint,
	"d_rx_crypts" bigint,
	"d_mac_filter_rejections" bigint,
	"d_num_roam_events" bigint,
	"cpu_pct" double precision,
	"mem_pct" double precision,
	"uptime_sec" bigint,
	"temp_cpu" double precision,
	"temp_board" double precision,
	"retry_rate" double precision,
	"error_rate" double precision,
	"drop_rate" double precision
);
--> statement-breakpoint
CREATE TABLE "metrics_1h" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"radio" text DEFAULT '' NOT NULL,
	"client_mac" text DEFAULT '' NOT NULL,
	"client_count" integer,
	"tx_bytes" bigint,
	"tx_packets" bigint,
	"tx_dropped" bigint,
	"tx_errors" bigint,
	"tx_retries" bigint,
	"rx_bytes" bigint,
	"rx_packets" bigint,
	"rx_dropped" bigint,
	"rx_errors" bigint,
	"d_tx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_tx_dropped" bigint,
	"d_tx_errors" bigint,
	"d_tx_retries" bigint,
	"d_rx_bytes" bigint,
	"d_rx_packets" bigint,
	"d_rx_dropped" bigint,
	"d_rx_errors" bigint,
	"wifi_tx_attempts" bigint,
	"wifi_tx_dropped" bigint,
	"rx_crypts" bigint,
	"mac_filter_rejections" bigint,
	"num_roam_events" bigint,
	"d_wifi_tx_attempts" bigint,
	"d_wifi_tx_dropped" bigint,
	"d_rx_crypts" bigint,
	"d_mac_filter_rejections" bigint,
	"d_num_roam_events" bigint,
	"cpu_pct" double precision,
	"mem_pct" double precision,
	"uptime_sec" bigint,
	"temp_cpu" double precision,
	"temp_board" double precision,
	"retry_rate" double precision,
	"error_rate" double precision,
	"drop_rate" double precision
);
--> statement-breakpoint
CREATE TABLE "metrics_5m" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"radio" text DEFAULT '' NOT NULL,
	"client_mac" text DEFAULT '' NOT NULL,
	"client_count" integer,
	"tx_bytes" bigint,
	"tx_packets" bigint,
	"tx_dropped" bigint,
	"tx_errors" bigint,
	"tx_retries" bigint,
	"rx_bytes" bigint,
	"rx_packets" bigint,
	"rx_dropped" bigint,
	"rx_errors" bigint,
	"d_tx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_tx_dropped" bigint,
	"d_tx_errors" bigint,
	"d_tx_retries" bigint,
	"d_rx_bytes" bigint,
	"d_rx_packets" bigint,
	"d_rx_dropped" bigint,
	"d_rx_errors" bigint,
	"wifi_tx_attempts" bigint,
	"wifi_tx_dropped" bigint,
	"rx_crypts" bigint,
	"mac_filter_rejections" bigint,
	"num_roam_events" bigint,
	"d_wifi_tx_attempts" bigint,
	"d_wifi_tx_dropped" bigint,
	"d_rx_crypts" bigint,
	"d_mac_filter_rejections" bigint,
	"d_num_roam_events" bigint,
	"cpu_pct" double precision,
	"mem_pct" double precision,
	"uptime_sec" bigint,
	"temp_cpu" double precision,
	"temp_board" double precision,
	"retry_rate" double precision,
	"error_rate" double precision,
	"drop_rate" double precision
);
--> statement-breakpoint
CREATE TABLE "metrics_client_1h" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"ap_device_id" text DEFAULT '' NOT NULL,
	"client_mac" text NOT NULL,
	"essid" text DEFAULT '' NOT NULL,
	"radio" text DEFAULT '' NOT NULL,
	"channel" integer,
	"signal" double precision,
	"noise" double precision,
	"tx_rate_kbps" bigint,
	"rx_rate_kbps" bigint,
	"idle_time" bigint,
	"roam_count" integer,
	"is_guest" boolean,
	"is_wired" boolean,
	"uptime_sec" bigint,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_retries" bigint,
	"rx_retries" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_client_5m" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"ap_device_id" text DEFAULT '' NOT NULL,
	"client_mac" text NOT NULL,
	"essid" text DEFAULT '' NOT NULL,
	"radio" text DEFAULT '' NOT NULL,
	"channel" integer,
	"signal" double precision,
	"noise" double precision,
	"tx_rate_kbps" bigint,
	"rx_rate_kbps" bigint,
	"idle_time" bigint,
	"roam_count" integer,
	"is_guest" boolean,
	"is_wired" boolean,
	"uptime_sec" bigint,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_retries" bigint,
	"rx_retries" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_port_1d" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"port_idx" integer NOT NULL,
	"name" text,
	"enable" boolean,
	"up" boolean,
	"speed" integer,
	"full_duplex" boolean,
	"poe_enable" boolean,
	"poe_power" double precision,
	"poe_voltage" double precision,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_packets" bigint,
	"rx_packets" bigint,
	"tx_errors" bigint,
	"rx_errors" bigint,
	"tx_dropped" bigint,
	"rx_dropped" bigint,
	"d_tx_bytes" bigint,
	"d_rx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_rx_packets" bigint,
	"d_tx_errors" bigint,
	"d_rx_errors" bigint,
	"d_tx_dropped" bigint,
	"d_rx_dropped" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_port_1h" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"port_idx" integer NOT NULL,
	"name" text,
	"enable" boolean,
	"up" boolean,
	"speed" integer,
	"full_duplex" boolean,
	"poe_enable" boolean,
	"poe_power" double precision,
	"poe_voltage" double precision,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_packets" bigint,
	"rx_packets" bigint,
	"tx_errors" bigint,
	"rx_errors" bigint,
	"tx_dropped" bigint,
	"rx_dropped" bigint,
	"d_tx_bytes" bigint,
	"d_rx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_rx_packets" bigint,
	"d_tx_errors" bigint,
	"d_rx_errors" bigint,
	"d_tx_dropped" bigint,
	"d_rx_dropped" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_port_5m" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"port_idx" integer NOT NULL,
	"name" text,
	"enable" boolean,
	"up" boolean,
	"speed" integer,
	"full_duplex" boolean,
	"poe_enable" boolean,
	"poe_power" double precision,
	"poe_voltage" double precision,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_packets" bigint,
	"rx_packets" bigint,
	"tx_errors" bigint,
	"rx_errors" bigint,
	"tx_dropped" bigint,
	"rx_dropped" bigint,
	"d_tx_bytes" bigint,
	"d_rx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_rx_packets" bigint,
	"d_tx_errors" bigint,
	"d_rx_errors" bigint,
	"d_tx_dropped" bigint,
	"d_rx_dropped" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_radio_1d" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"radio" text NOT NULL,
	"channel" integer,
	"tx_power" integer,
	"state" text,
	"num_sta" integer,
	"user_num_sta" integer,
	"guest_num_sta" integer,
	"cu_total" double precision,
	"cu_self_tx" double precision,
	"cu_self_rx" double precision,
	"satisfaction" double precision
);
--> statement-breakpoint
CREATE TABLE "metrics_radio_1h" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"radio" text NOT NULL,
	"channel" integer,
	"tx_power" integer,
	"state" text,
	"num_sta" integer,
	"user_num_sta" integer,
	"guest_num_sta" integer,
	"cu_total" double precision,
	"cu_self_tx" double precision,
	"cu_self_rx" double precision,
	"satisfaction" double precision
);
--> statement-breakpoint
CREATE TABLE "metrics_radio_5m" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"radio" text NOT NULL,
	"channel" integer,
	"tx_power" integer,
	"state" text,
	"num_sta" integer,
	"user_num_sta" integer,
	"guest_num_sta" integer,
	"cu_total" double precision,
	"cu_self_tx" double precision,
	"cu_self_rx" double precision,
	"satisfaction" double precision
);
--> statement-breakpoint
CREATE TABLE "metrics_vap_1d" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"radio" text NOT NULL,
	"ssid" text NOT NULL,
	"num_sta" integer,
	"is_guest" boolean,
	"avg_client_signal" double precision,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_packets" bigint,
	"rx_packets" bigint,
	"tx_retries" bigint,
	"tx_dropped" bigint,
	"rx_dropped" bigint,
	"mac_filter_rejections" bigint,
	"ccq" double precision,
	"satisfaction" double precision,
	"d_tx_bytes" bigint,
	"d_rx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_rx_packets" bigint,
	"d_tx_retries" bigint,
	"d_tx_dropped" bigint,
	"d_rx_dropped" bigint,
	"d_mac_filter_rejections" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_vap_1h" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"radio" text NOT NULL,
	"ssid" text NOT NULL,
	"num_sta" integer,
	"is_guest" boolean,
	"avg_client_signal" double precision,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_packets" bigint,
	"rx_packets" bigint,
	"tx_retries" bigint,
	"tx_dropped" bigint,
	"rx_dropped" bigint,
	"mac_filter_rejections" bigint,
	"ccq" double precision,
	"satisfaction" double precision,
	"d_tx_bytes" bigint,
	"d_rx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_rx_packets" bigint,
	"d_tx_retries" bigint,
	"d_tx_dropped" bigint,
	"d_rx_dropped" bigint,
	"d_mac_filter_rejections" bigint
);
--> statement-breakpoint
CREATE TABLE "metrics_vap_5m" (
	"ts" bigint NOT NULL,
	"controller_id" text NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"radio" text NOT NULL,
	"ssid" text NOT NULL,
	"num_sta" integer,
	"is_guest" boolean,
	"avg_client_signal" double precision,
	"tx_bytes" bigint,
	"rx_bytes" bigint,
	"tx_packets" bigint,
	"rx_packets" bigint,
	"tx_retries" bigint,
	"tx_dropped" bigint,
	"rx_dropped" bigint,
	"mac_filter_rejections" bigint,
	"ccq" double precision,
	"satisfaction" double precision,
	"d_tx_bytes" bigint,
	"d_rx_bytes" bigint,
	"d_tx_packets" bigint,
	"d_rx_packets" bigint,
	"d_tx_retries" bigint,
	"d_tx_dropped" bigint,
	"d_rx_dropped" bigint,
	"d_mac_filter_rejections" bigint
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"unifi_id" text NOT NULL,
	"unifi_name" text NOT NULL,
	"display_name" text NOT NULL,
	"city" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_ts_idx" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_controller_mac_unique" ON "clients" USING btree ("controller_id","mac");--> statement-breakpoint
CREATE INDEX "clients_site_idx" ON "clients" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "clients_alias_idx" ON "clients" USING btree ("display_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "controllers_name_unique" ON "controllers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_controller_mac_unique" ON "devices" USING btree ("controller_id","mac");--> statement-breakpoint
CREATE INDEX "devices_site_idx" ON "devices" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "devices_alias_idx" ON "devices" USING btree ("display_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "events_fingerprint_unique" ON "events" USING btree ("controller_id","fingerprint");--> statement-breakpoint
CREATE INDEX "events_ts_idx" ON "events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "events_severity_ts" ON "events" USING btree ("severity","ts");--> statement-breakpoint
CREATE INDEX "events_device_ts" ON "events" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "events_type_ts" ON "events" USING btree ("event_type","ts");--> statement-breakpoint
CREATE INDEX "events_controller_ts" ON "events" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_1d_dim_unique" ON "metrics_1d" USING btree ("ts","controller_id","site_id","device_id","radio","client_mac");--> statement-breakpoint
CREATE INDEX "metrics_1d_device_ts" ON "metrics_1d" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_1d_site_ts" ON "metrics_1d" USING btree ("site_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_1d_controller_ts" ON "metrics_1d" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_1h_dim_unique" ON "metrics_1h" USING btree ("ts","controller_id","site_id","device_id","radio","client_mac");--> statement-breakpoint
CREATE INDEX "metrics_1h_device_ts" ON "metrics_1h" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_1h_site_ts" ON "metrics_1h" USING btree ("site_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_1h_controller_ts" ON "metrics_1h" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_5m_dim_unique" ON "metrics_5m" USING btree ("ts","controller_id","site_id","device_id","radio","client_mac");--> statement-breakpoint
CREATE INDEX "metrics_5m_device_ts" ON "metrics_5m" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_5m_site_ts" ON "metrics_5m" USING btree ("site_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_5m_client_ts" ON "metrics_5m" USING btree ("client_mac","ts");--> statement-breakpoint
CREATE INDEX "metrics_5m_controller_ts" ON "metrics_5m" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_client_1h_dim_unique" ON "metrics_client_1h" USING btree ("ts","controller_id","site_id","client_mac");--> statement-breakpoint
CREATE INDEX "metrics_client_1h_controller_ts" ON "metrics_client_1h" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_client_1h_client_ts" ON "metrics_client_1h" USING btree ("client_mac","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_client_5m_dim_unique" ON "metrics_client_5m" USING btree ("ts","controller_id","site_id","client_mac");--> statement-breakpoint
CREATE INDEX "metrics_client_5m_ap_ts" ON "metrics_client_5m" USING btree ("ap_device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_client_5m_controller_ts" ON "metrics_client_5m" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_client_5m_client_ts" ON "metrics_client_5m" USING btree ("client_mac","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_port_1d_dim_unique" ON "metrics_port_1d" USING btree ("ts","controller_id","site_id","device_id","port_idx");--> statement-breakpoint
CREATE INDEX "metrics_port_1d_device_ts" ON "metrics_port_1d" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_port_1d_controller_ts" ON "metrics_port_1d" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_port_1h_dim_unique" ON "metrics_port_1h" USING btree ("ts","controller_id","site_id","device_id","port_idx");--> statement-breakpoint
CREATE INDEX "metrics_port_1h_device_ts" ON "metrics_port_1h" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_port_1h_controller_ts" ON "metrics_port_1h" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_port_5m_dim_unique" ON "metrics_port_5m" USING btree ("ts","controller_id","site_id","device_id","port_idx");--> statement-breakpoint
CREATE INDEX "metrics_port_5m_device_ts" ON "metrics_port_5m" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_port_5m_controller_ts" ON "metrics_port_5m" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_radio_1d_dim_unique" ON "metrics_radio_1d" USING btree ("ts","controller_id","site_id","device_id","radio");--> statement-breakpoint
CREATE INDEX "metrics_radio_1d_device_ts" ON "metrics_radio_1d" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_radio_1d_controller_ts" ON "metrics_radio_1d" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_radio_1h_dim_unique" ON "metrics_radio_1h" USING btree ("ts","controller_id","site_id","device_id","radio");--> statement-breakpoint
CREATE INDEX "metrics_radio_1h_device_ts" ON "metrics_radio_1h" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_radio_1h_controller_ts" ON "metrics_radio_1h" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_radio_5m_dim_unique" ON "metrics_radio_5m" USING btree ("ts","controller_id","site_id","device_id","radio");--> statement-breakpoint
CREATE INDEX "metrics_radio_5m_device_ts" ON "metrics_radio_5m" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_radio_5m_controller_ts" ON "metrics_radio_5m" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_vap_1d_dim_unique" ON "metrics_vap_1d" USING btree ("ts","controller_id","site_id","device_id","radio","ssid");--> statement-breakpoint
CREATE INDEX "metrics_vap_1d_device_ts" ON "metrics_vap_1d" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_vap_1d_ssid_ts" ON "metrics_vap_1d" USING btree ("ssid","ts");--> statement-breakpoint
CREATE INDEX "metrics_vap_1d_controller_ts" ON "metrics_vap_1d" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_vap_1h_dim_unique" ON "metrics_vap_1h" USING btree ("ts","controller_id","site_id","device_id","radio","ssid");--> statement-breakpoint
CREATE INDEX "metrics_vap_1h_device_ts" ON "metrics_vap_1h" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_vap_1h_ssid_ts" ON "metrics_vap_1h" USING btree ("ssid","ts");--> statement-breakpoint
CREATE INDEX "metrics_vap_1h_controller_ts" ON "metrics_vap_1h" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_vap_5m_dim_unique" ON "metrics_vap_5m" USING btree ("ts","controller_id","site_id","device_id","radio","ssid");--> statement-breakpoint
CREATE INDEX "metrics_vap_5m_device_ts" ON "metrics_vap_5m" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "metrics_vap_5m_ssid_ts" ON "metrics_vap_5m" USING btree ("ssid","ts");--> statement-breakpoint
CREATE INDEX "metrics_vap_5m_controller_ts" ON "metrics_vap_5m" USING btree ("controller_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_controller_name_unique" ON "sites" USING btree ("controller_id","unifi_name");--> statement-breakpoint
CREATE INDEX "sites_controller_idx" ON "sites" USING btree ("controller_id");