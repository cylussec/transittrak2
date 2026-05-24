CREATE TABLE `gtfs_routes` (
	`route_id` text NOT NULL,
	`agency_id` text NOT NULL,
	`gtfs_version_id` text NOT NULL,
	`route_short_name` text,
	`route_long_name` text,
	`route_desc` text,
	`route_type` integer NOT NULL,
	`route_url` text,
	`route_color` text,
	`route_text_color` text,
	`route_sort_order` integer,
	PRIMARY KEY(`route_id`, `agency_id`, `gtfs_version_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_gtfs_routes_agency_version` ON `gtfs_routes` (`agency_id`,`gtfs_version_id`);--> statement-breakpoint
CREATE TABLE `gtfs_shapes` (
	`shape_id` text NOT NULL,
	`agency_id` text NOT NULL,
	`gtfs_version_id` text NOT NULL,
	`shape_pt_lat` real NOT NULL,
	`shape_pt_lon` real NOT NULL,
	`shape_pt_sequence` integer NOT NULL,
	`shape_dist_traveled` real,
	PRIMARY KEY(`shape_id`, `agency_id`, `gtfs_version_id`, `shape_pt_sequence`)
);
--> statement-breakpoint
CREATE INDEX `idx_gtfs_shapes_agency_version_shape` ON `gtfs_shapes` (`agency_id`,`gtfs_version_id`,`shape_id`);--> statement-breakpoint
CREATE TABLE `gtfs_stop_times` (
	`trip_id` text NOT NULL,
	`agency_id` text NOT NULL,
	`gtfs_version_id` text NOT NULL,
	`arrival_time` text,
	`departure_time` text,
	`stop_id` text NOT NULL,
	`stop_sequence` integer NOT NULL,
	`stop_headsign` text,
	`pickup_type` integer,
	`drop_off_type` integer,
	`shape_dist_traveled` real,
	`timepoint` integer,
	PRIMARY KEY(`trip_id`, `agency_id`, `gtfs_version_id`, `stop_sequence`)
);
--> statement-breakpoint
CREATE INDEX `idx_gtfs_stop_times_agency_version_trip` ON `gtfs_stop_times` (`agency_id`,`gtfs_version_id`,`trip_id`);--> statement-breakpoint
CREATE TABLE `gtfs_stops` (
	`stop_id` text NOT NULL,
	`agency_id` text NOT NULL,
	`gtfs_version_id` text NOT NULL,
	`stop_code` text,
	`stop_name` text NOT NULL,
	`stop_desc` text,
	`stop_lat` real NOT NULL,
	`stop_lon` real NOT NULL,
	`zone_id` text,
	`stop_url` text,
	`location_type` integer,
	`parent_station` text,
	`stop_timezone` text,
	`wheelchair_boarding` integer,
	PRIMARY KEY(`stop_id`, `agency_id`, `gtfs_version_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_gtfs_stops_agency_version` ON `gtfs_stops` (`agency_id`,`gtfs_version_id`);--> statement-breakpoint
CREATE TABLE `gtfs_trips` (
	`trip_id` text NOT NULL,
	`agency_id` text NOT NULL,
	`gtfs_version_id` text NOT NULL,
	`route_id` text NOT NULL,
	`service_id` text NOT NULL,
	`trip_headsign` text,
	`trip_short_name` text,
	`direction_id` integer,
	`block_id` text,
	`shape_id` text,
	`wheelchair_accessible` integer,
	`bikes_allowed` integer,
	PRIMARY KEY(`trip_id`, `agency_id`, `gtfs_version_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_gtfs_trips_agency_version_route` ON `gtfs_trips` (`agency_id`,`gtfs_version_id`,`route_id`);