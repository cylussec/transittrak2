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
