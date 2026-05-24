export interface VehiclePosition {
  agency_id: string
  ts_ms: number
  vehicle_id: string
  trip_id: string | null
  route_id: string | null
  direction_id: number | null
  stop_id: string | null
  lat: number
  lon: number
  bearing: number | null
  speed: number | null
  current_status: string | null
  current_stop_sequence: number | null
}

export interface Agency {
  agency_id: string
  display_name: string
  timezone: string
  enabled: number
}

export interface RouteInfo {
  route_id: string
  route_short_name: string | null
  route_long_name: string | null
  route_color: string | null
  route_text_color: string | null
  route_type: number
}

export interface RouteStop {
  stop_id: string
  stop_name: string
  stop_lat?: number
  stop_lon?: number
  stop_sequence: number
}

export interface StringlineData {
  route_id?: string
  direction_id?: number
  vehicle_id?: string
  since_ms: number
  until_ms: number
  stops?: RouteStop[]
  vehicles: Record<string, Array<{
    vehicle_id: string
    ts_ms: number
    stop_id: string | null
    current_stop_sequence: number | null
    lat: number
    lon: number
    current_status: string | null
    route_id?: string | null
    direction_id?: number | null
  }>>
}

export interface OnTimeStats {
  group_by: string
  stats: Array<Record<string, unknown>>
}
