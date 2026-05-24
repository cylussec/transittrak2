import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const agencies = sqliteTable('agencies', {
	agencyId: text('agency_id').primaryKey(),
	displayName: text('display_name').notNull(),
	timezone: text('timezone').notNull(),
	gtfsStaticUrl: text('gtfs_static_url').notNull(),
	swiftlyAgencyKey: text('swiftly_agency_key'),
	enabled: integer('enabled').notNull().default(1),
});

export const feeds = sqliteTable(
	'feeds',
	{
		feedId: text('feed_id').primaryKey(),
		agencyId: text('agency_id').notNull(),
		feedType: text('feed_type').notNull(),
		url: text('url').notNull(),
		enabled: integer('enabled').notNull().default(1),
	},
	(table) => ({
		agencyFeedTypeIdx: index('idx_feeds_agency_feed_type').on(table.agencyId, table.feedType),
	})
);

export const gtfsVersions = sqliteTable(
	'gtfs_versions',
	{
		gtfsVersionId: text('gtfs_version_id').primaryKey(),
		agencyId: text('agency_id').notNull(),
		fetchedAtMs: integer('fetched_at_ms').notNull(),
		r2Key: text('r2_key').notNull(),
	},
	(table) => ({
		agencyFetchedAtIdx: index('idx_gtfs_versions_agency_fetched_at').on(table.agencyId, table.fetchedAtMs),
	})
);

export const gtfsVersionEffective = sqliteTable(
	'gtfs_version_effective',
	{
		agencyId: text('agency_id').notNull(),
		effectiveFromMs: integer('effective_from_ms').notNull(),
		gtfsVersionId: text('gtfs_version_id').notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.agencyId, table.effectiveFromMs] }),
	})
);

export const gtfsrtSnapshots = sqliteTable(
	'gtfsrt_snapshots',
	{
		snapshotId: text('snapshot_id').primaryKey(),
		agencyId: text('agency_id').notNull(),
		feedType: text('feed_type').notNull(),
		tsMs: integer('ts_ms').notNull(),
		gtfsVersionId: text('gtfs_version_id'),
		r2Key: text('r2_key').notNull(),
		byteSize: integer('byte_size').notNull(),
		httpEtag: text('http_etag'),
		httpLastModified: text('http_last_modified'),
	},
	(table) => ({
		agencyFeedTsIdx: index('idx_gtfsrt_snapshots_agency_feed_ts').on(table.agencyId, table.feedType, table.tsMs),
	})
);

export const vpPoints = sqliteTable(
	'vp_points',
	{
		agencyId: text('agency_id').notNull(),
		tsMs: integer('ts_ms').notNull(),
		vehicleId: text('vehicle_id').notNull(),
		tripId: text('trip_id'),
		routeId: text('route_id'),
		directionId: integer('direction_id'),
		stopId: text('stop_id'),
		lat: real('lat').notNull(),
		lon: real('lon').notNull(),
		bearing: real('bearing'),
		speed: real('speed'),
		currentStatus: text('current_status'),
		currentStopSequence: integer('current_stop_sequence'),
		gtfsVersionId: text('gtfs_version_id').notNull(),
	},
	(table) => ({
		agencyRouteTsIdx: index('idx_vp_points_agency_route_ts').on(table.agencyId, table.routeId, table.tsMs),
		agencyVehicleTsIdx: index('idx_vp_points_agency_vehicle_ts').on(table.agencyId, table.vehicleId, table.tsMs),
	})
);

export const tuStopTimeUpdates = sqliteTable(
	'tu_stop_time_updates',
	{
		agencyId: text('agency_id').notNull(),
		tsMs: integer('ts_ms').notNull(),
		tripId: text('trip_id').notNull(),
		routeId: text('route_id'),
		stopId: text('stop_id').notNull(),
		stopSequence: integer('stop_sequence'),
		arrivalTimeMs: integer('arrival_time_ms'),
		departureTimeMs: integer('departure_time_ms'),
		scheduleRelationship: text('schedule_relationship'),
		gtfsVersionId: text('gtfs_version_id').notNull(),
	},
	(table) => ({
		agencyRouteTsIdx: index('idx_tu_updates_agency_route_ts').on(table.agencyId, table.routeId, table.tsMs),
		agencyTripTsIdx: index('idx_tu_updates_agency_trip_ts').on(table.agencyId, table.tripId, table.tsMs),
	})
);

export const gtfsRoutes = sqliteTable(
	'gtfs_routes',
	{
		routeId: text('route_id').notNull(),
		agencyId: text('agency_id').notNull(),
		gtfsVersionId: text('gtfs_version_id').notNull(),
		routeShortName: text('route_short_name'),
		routeLongName: text('route_long_name'),
		routeDesc: text('route_desc'),
		routeType: integer('route_type').notNull(),
		routeUrl: text('route_url'),
		routeColor: text('route_color'),
		routeTextColor: text('route_text_color'),
		routeSortOrder: integer('route_sort_order'),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.routeId, table.agencyId, table.gtfsVersionId] }),
		agencyVersionIdx: index('idx_gtfs_routes_agency_version').on(table.agencyId, table.gtfsVersionId),
	})
);

export const gtfsStops = sqliteTable(
	'gtfs_stops',
	{
		stopId: text('stop_id').notNull(),
		agencyId: text('agency_id').notNull(),
		gtfsVersionId: text('gtfs_version_id').notNull(),
		stopCode: text('stop_code'),
		stopName: text('stop_name').notNull(),
		stopDesc: text('stop_desc'),
		stopLat: real('stop_lat').notNull(),
		stopLon: real('stop_lon').notNull(),
		zoneId: text('zone_id'),
		stopUrl: text('stop_url'),
		locationType: integer('location_type'),
		parentStation: text('parent_station'),
		stopTimezone: text('stop_timezone'),
		wheelchairBoarding: integer('wheelchair_boarding'),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.stopId, table.agencyId, table.gtfsVersionId] }),
		agencyVersionIdx: index('idx_gtfs_stops_agency_version').on(table.agencyId, table.gtfsVersionId),
	})
);

export const gtfsShapes = sqliteTable(
	'gtfs_shapes',
	{
		shapeId: text('shape_id').notNull(),
		agencyId: text('agency_id').notNull(),
		gtfsVersionId: text('gtfs_version_id').notNull(),
		shapePtLat: real('shape_pt_lat').notNull(),
		shapePtLon: real('shape_pt_lon').notNull(),
		shapePtSequence: integer('shape_pt_sequence').notNull(),
		shapeDistTraveled: real('shape_dist_traveled'),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.shapeId, table.agencyId, table.gtfsVersionId, table.shapePtSequence] }),
		agencyVersionShapeIdx: index('idx_gtfs_shapes_agency_version_shape').on(table.agencyId, table.gtfsVersionId, table.shapeId),
	})
);

export const gtfsTrips = sqliteTable(
	'gtfs_trips',
	{
		tripId: text('trip_id').notNull(),
		agencyId: text('agency_id').notNull(),
		gtfsVersionId: text('gtfs_version_id').notNull(),
		routeId: text('route_id').notNull(),
		serviceId: text('service_id').notNull(),
		tripHeadsign: text('trip_headsign'),
		tripShortName: text('trip_short_name'),
		directionId: integer('direction_id'),
		blockId: text('block_id'),
		shapeId: text('shape_id'),
		wheelchairAccessible: integer('wheelchair_accessible'),
		bikesAllowed: integer('bikes_allowed'),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.tripId, table.agencyId, table.gtfsVersionId] }),
		agencyVersionRouteIdx: index('idx_gtfs_trips_agency_version_route').on(table.agencyId, table.gtfsVersionId, table.routeId),
	})
);

export const gtfsStopTimes = sqliteTable(
	'gtfs_stop_times',
	{
		tripId: text('trip_id').notNull(),
		agencyId: text('agency_id').notNull(),
		gtfsVersionId: text('gtfs_version_id').notNull(),
		arrivalTime: text('arrival_time'),
		departureTime: text('departure_time'),
		stopId: text('stop_id').notNull(),
		stopSequence: integer('stop_sequence').notNull(),
		stopHeadsign: text('stop_headsign'),
		pickupType: integer('pickup_type'),
		dropOffType: integer('drop_off_type'),
		shapeDistTraveled: real('shape_dist_traveled'),
		timepoint: integer('timepoint'),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.tripId, table.agencyId, table.gtfsVersionId, table.stopSequence] }),
		agencyVersionTripIdx: index('idx_gtfs_stop_times_agency_version_trip').on(table.agencyId, table.gtfsVersionId, table.tripId),
	})
);
