INSERT INTO agencies (agency_id, display_name, timezone, gtfs_static_url, swiftly_agency_key, enabled)
VALUES
  ('mta-maryland-marc', 'MTA Maryland - MARC Train', 'America/New_York', 'https://feeds.mta.maryland.gov/gtfs/marc', NULL, 1),
  ('mta-maryland', 'MTA Maryland - Local Bus', 'America/New_York', 'https://feeds.mta.maryland.gov/gtfs/local-bus', 'mta-maryland', 1);

INSERT INTO feeds (feed_id, agency_id, feed_type, url, enabled)
VALUES
  ('mta-maryland-marc-vehicle-positions', 'mta-maryland-marc', 'vehicle-positions', 'https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/marc-vp.pb', 1),
  ('mta-maryland-marc-trip-updates', 'mta-maryland-marc', 'trip-updates', 'https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/marc-tu.pb', 1),
  ('mta-maryland-vehicle-positions', 'mta-maryland', 'vehicle-positions', 'https://api.goswift.ly/real-time/mta-maryland/gtfs-rt-vehicle-positions', 1),
  ('mta-maryland-trip-updates', 'mta-maryland', 'trip-updates', 'https://api.goswift.ly/real-time/mta-maryland/gtfs-rt-trip-updates', 1);

INSERT INTO gtfs_versions (gtfs_version_id, agency_id, fetched_at_ms, r2_key)
VALUES
  ('demo-gtfs-version-marc', 'mta-maryland-marc', 1735689600000, 'gtfs-static/mta-maryland-marc/hash=demo/fetched_at=1735689600000.zip'),
  ('demo-gtfs-version-bus', 'mta-maryland', 1735689600000, 'gtfs-static/mta-maryland/hash=demo/fetched_at=1735689600000.zip');

INSERT INTO gtfs_version_effective (agency_id, effective_from_ms, gtfs_version_id)
VALUES
  ('mta-maryland-marc', 1735689600000, 'demo-gtfs-version-marc'),
  ('mta-maryland', 1735689600000, 'demo-gtfs-version-bus');
