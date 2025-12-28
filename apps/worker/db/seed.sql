INSERT INTO agencies (agency_id, display_name, timezone, gtfs_static_url, swiftly_agency_key, enabled)
VALUES
  ('mta-maryland-local-bus', 'MTA Maryland - Local Bus', 'America/New_York', 'https://static.mta.maryland.gov/gtfs.zip', NULL, 1),
  ('sfmta', 'San Francisco Muni', 'America/Los_Angeles', 'https://transitfeeds.com/p/sfmta/60/latest/download', NULL, 1);

INSERT INTO feeds (feed_id, agency_id, feed_type, url, enabled)
VALUES
  ('mta-maryland-local-bus-vehicle-positions', 'mta-maryland-local-bus', 'vehicle-positions', 'https://swiftly.app/api/vehicle-positions', 1),
  ('mta-maryland-local-bus-trip-updates', 'mta-maryland-local-bus', 'trip-updates', 'https://swiftly.app/api/trip-updates', 1),
  ('mta-maryland-local-bus-alerts', 'mta-maryland-local-bus', 'alerts', 'https://swiftly.app/api/alerts', 1),
  ('sfmta-vehicle-positions', 'sfmta', 'vehicle-positions', 'https://swiftly.app/api/sfmta/vehicle-positions', 1);

INSERT INTO gtfs_versions (gtfs_version_id, agency_id, fetched_at_ms, r2_key)
VALUES
  ('demo-gtfs-version-id', 'mta-maryland-local-bus', 1735689600000, 'gtfs-static/mta-maryland-local-bus/hash=demo/fetched_at=1735689600000.zip');

INSERT INTO gtfs_version_effective (agency_id, effective_from_ms, gtfs_version_id)
VALUES
  ('mta-maryland-local-bus', 1735689600000, 'demo-gtfs-version-id');
