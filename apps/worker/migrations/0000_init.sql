CREATE TABLE `agencies` (
	`agency_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`timezone` text NOT NULL,
	`gtfs_static_url` text NOT NULL,
	`swiftly_agency_key` text,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feeds` (
	`feed_id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`feed_type` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feeds_agency_feed_type` ON `feeds` (`agency_id`,`feed_type`);--> statement-breakpoint
CREATE TABLE `gtfs_version_effective` (
	`agency_id` text NOT NULL,
	`effective_from_ms` integer NOT NULL,
	`gtfs_version_id` text NOT NULL,
	PRIMARY KEY(`agency_id`, `effective_from_ms`)
);
--> statement-breakpoint
CREATE TABLE `gtfs_versions` (
	`gtfs_version_id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`fetched_at_ms` integer NOT NULL,
	`r2_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gtfs_versions_agency_fetched_at` ON `gtfs_versions` (`agency_id`,`fetched_at_ms`);--> statement-breakpoint
CREATE TABLE `gtfsrt_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`feed_type` text NOT NULL,
	`ts_ms` integer NOT NULL,
	`gtfs_version_id` text,
	`r2_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`http_etag` text,
	`http_last_modified` text
);
--> statement-breakpoint
CREATE INDEX `idx_gtfsrt_snapshots_agency_feed_ts` ON `gtfsrt_snapshots` (`agency_id`,`feed_type`,`ts_ms`);--> statement-breakpoint
CREATE TABLE `tu_stop_time_updates` (
	`agency_id` text NOT NULL,
	`ts_ms` integer NOT NULL,
	`trip_id` text NOT NULL,
	`route_id` text,
	`stop_id` text NOT NULL,
	`stop_sequence` integer,
	`arrival_time_ms` integer,
	`departure_time_ms` integer,
	`schedule_relationship` text,
	`gtfs_version_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tu_updates_agency_route_ts` ON `tu_stop_time_updates` (`agency_id`,`route_id`,`ts_ms`);--> statement-breakpoint
CREATE INDEX `idx_tu_updates_agency_trip_ts` ON `tu_stop_time_updates` (`agency_id`,`trip_id`,`ts_ms`);--> statement-breakpoint
CREATE TABLE `vp_points` (
	`agency_id` text NOT NULL,
	`ts_ms` integer NOT NULL,
	`vehicle_id` text NOT NULL,
	`trip_id` text,
	`route_id` text,
	`direction_id` integer,
	`stop_id` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`bearing` real,
	`speed` real,
	`current_status` text,
	`current_stop_sequence` integer,
	`gtfs_version_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vp_points_agency_route_ts` ON `vp_points` (`agency_id`,`route_id`,`ts_ms`);--> statement-breakpoint
CREATE INDEX `idx_vp_points_agency_vehicle_ts` ON `vp_points` (`agency_id`,`vehicle_id`,`ts_ms`);