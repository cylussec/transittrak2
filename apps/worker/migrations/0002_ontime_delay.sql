ALTER TABLE tu_stop_time_updates ADD COLUMN delay_seconds INTEGER;--> statement-breakpoint
ALTER TABLE tu_stop_time_updates ADD COLUMN start_date TEXT;--> statement-breakpoint
CREATE INDEX idx_tu_updates_agency_route_ts_delay
  ON tu_stop_time_updates (agency_id, route_id, ts_ms);--> statement-breakpoint
ALTER TABLE agencies ADD COLUMN on_time_lower_s INTEGER NOT NULL DEFAULT -60;--> statement-breakpoint
ALTER TABLE agencies ADD COLUMN on_time_upper_s INTEGER NOT NULL DEFAULT 300;
