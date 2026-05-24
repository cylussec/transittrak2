import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Map as MapGL, Marker, Popup, NavigationControl } from 'react-map-gl/maplibre'
import type { MapRef } from 'react-map-gl/maplibre'
import { Bus, RefreshCw, AlertCircle, MapPin, BarChart3, MapIcon } from 'lucide-react'
import { VehicleMarker } from './components/VehicleMarker'
import { AnalysisPanel } from './components/AnalysisPanel'
import { useFetch } from './hooks/useApi'
import type { VehiclePosition, Agency, RouteInfo } from './types'

function formatTime(tsMs: number): string {
  const seconds = Math.floor((Date.now() - tsMs) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

type Tab = 'realtime' | 'analysis'

function App() {
  const [tab, setTab] = useState<Tab>('realtime')
  const [positions, setPositions] = useState<VehiclePosition[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const mapRef = useRef<MapRef>(null)
  const hasFitted = useRef(false)

  const { data: agenciesData } = useFetch<{ agencies: Agency[] }>('/api/metadata/agencies')
  const agencies = agenciesData?.agencies ?? []

  const { data: routesData } = useFetch<{ routes: RouteInfo[] }>('/api/analysis/routes')
  const routeMap = useMemo(() => {
    const m = new Map<string, RouteInfo>()
    for (const r of (routesData?.routes ?? [])) m.set(r.route_id, r)
    return m
  }, [routesData])

  const fetchPositions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/vehicles/positions/latest')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPositions(data.positions ?? [])
      setLastUpdate(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPositions() }, [fetchPositions])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchPositions, 30_000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchPositions])

  useEffect(() => {
    if (hasFitted.current || positions.length === 0 || !mapRef.current) return
    hasFitted.current = true
    const lats = positions.map(p => p.lat)
    const lons = positions.map(p => p.lon)
    mapRef.current.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 60, duration: 1000 }
    )
  }, [positions])

  const uniqueRoutes = useMemo(() =>
    [...new Set(positions.map(p => p.route_id).filter(Boolean))] as string[],
    [positions]
  )

  return (
    <div className="flex flex-col h-full w-full">
      {/* Top nav bar */}
      <header className="bg-gray-900 border-b border-gray-700 flex items-center px-4 py-0 z-20 shrink-0">
        <div className="flex items-center gap-2 mr-6">
          <Bus className="w-5 h-5 text-blue-400" />
          <h1 className="text-base font-bold text-white">TransitTrack</h1>
        </div>
        <nav className="flex gap-0">
          <button
            onClick={() => setTab('realtime')}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${tab === 'realtime' ? 'text-blue-400 border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-200'}`}
          >
            <MapIcon className="w-4 h-4" />
            Real-time
          </button>
          <button
            onClick={() => setTab('analysis')}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${tab === 'analysis' ? 'text-blue-400 border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-200'}`}
          >
            <BarChart3 className="w-4 h-4" />
            Analysis
          </button>
        </nav>
        {tab === 'realtime' && (
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
            {lastUpdate && <span>Updated {formatTime(lastUpdate)}</span>}
            <span className="text-green-400 font-mono font-bold">{positions.length} vehicles</span>
          </div>
        )}
      </header>

      {/* Content area */}
      <div className="flex-1 flex overflow-hidden">
        {tab === 'realtime' ? (
          <>
            {/* Sidebar */}
            <aside className="w-72 bg-gray-900 text-white flex flex-col border-r border-gray-700 z-10 shrink-0">
              {/* Stats */}
              <div className="p-4 border-b border-gray-700 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-300">Routes</span>
                  <span className="text-sm font-mono font-bold text-blue-400">{uniqueRoutes.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-300">Agencies</span>
                  <span className="text-sm font-mono font-bold text-purple-400">{agencies.length}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="p-3 border-b border-gray-700 flex gap-2">
                <button
                  onClick={fetchPositions}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded text-sm font-medium transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`px-3 py-2 rounded text-sm font-medium transition-colors ${autoRefresh ? 'bg-green-700 hover:bg-green-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >
                  {autoRefresh ? 'Auto' : 'Manual'}
                </button>
              </div>

              {error && (
                <div className="p-3 mx-3 mt-3 bg-red-900/50 border border-red-700 rounded flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span className="text-xs text-red-300">{error}</span>
                </div>
              )}

              {/* Routes list */}
              <div className="flex-1 overflow-y-auto p-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Active Routes</h2>
                {uniqueRoutes.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No active routes</p>
                ) : (
                  <ul className="space-y-0.5">
                    {uniqueRoutes.sort().map(routeId => {
                      const count = positions.filter(p => p.route_id === routeId).length
                      const info = routeMap.get(routeId)
                      const bgColor = info?.route_color ? `#${info.route_color}` : '#6b7280'
                      return (
                        <li key={routeId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 transition-colors">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: bgColor }} />
                          <span className="text-sm truncate flex-1 font-medium">
                            {info?.route_short_name ?? routeId}
                          </span>
                          {info?.route_long_name && (
                            <span className="text-xs text-gray-500 truncate max-w-24">{info.route_long_name}</span>
                          )}
                          <span className="text-xs text-gray-500 font-mono">{count}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </aside>

            {/* Map */}
            <main className="flex-1 relative">
              <MapGL
                ref={mapRef}
                initialViewState={{ longitude: -76.61, latitude: 39.29, zoom: 11 }}
                style={{ width: '100%', height: '100%' }}
                mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
              >
                <NavigationControl position="top-right" />

                {positions.map((pos) => (
                  <Marker
                    key={`${pos.vehicle_id}-${pos.ts_ms}`}
                    longitude={pos.lon}
                    latitude={pos.lat}
                    anchor="center"
                    onClick={(e) => {
                      e.originalEvent.stopPropagation()
                      setSelectedVehicle(pos)
                    }}
                  >
                    <VehicleMarker
                      routeId={pos.route_id}
                      routeInfo={routeMap.get(pos.route_id ?? '') ?? null}
                      bearing={pos.bearing}
                      onClick={() => setSelectedVehicle(pos)}
                    />
                  </Marker>
                ))}

                {selectedVehicle && (
                  <Popup
                    longitude={selectedVehicle.lon}
                    latitude={selectedVehicle.lat}
                    anchor="bottom"
                    onClose={() => setSelectedVehicle(null)}
                    closeButton={true}
                    closeOnClick={false}
                  >
                    <div className="p-2 min-w-48">
                      <div className="flex items-center gap-1.5 mb-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        <span className="font-bold text-sm">Vehicle {selectedVehicle.vehicle_id}</span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {selectedVehicle.route_id && (
                          <>
                            <dt className="text-gray-500">Route</dt>
                            <dd className="font-medium">
                              {routeMap.get(selectedVehicle.route_id)?.route_short_name ?? selectedVehicle.route_id}
                            </dd>
                          </>
                        )}
                        {selectedVehicle.trip_id && (
                          <>
                            <dt className="text-gray-500">Trip</dt>
                            <dd className="font-medium truncate">{selectedVehicle.trip_id}</dd>
                          </>
                        )}
                        {selectedVehicle.speed != null && (
                          <>
                            <dt className="text-gray-500">Speed</dt>
                            <dd className="font-medium">{Math.round(selectedVehicle.speed * 2.237)} mph</dd>
                          </>
                        )}
                        {selectedVehicle.current_status && (
                          <>
                            <dt className="text-gray-500">Status</dt>
                            <dd className="font-medium">{selectedVehicle.current_status}</dd>
                          </>
                        )}
                        <dt className="text-gray-500">Updated</dt>
                        <dd className="font-medium">{formatTime(selectedVehicle.ts_ms)}</dd>
                      </dl>
                    </div>
                  </Popup>
                )}
              </MapGL>

              {loading && positions.length === 0 && (
                <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center">
                  <div className="flex items-center gap-3 text-white">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                    <span className="text-lg">Loading vehicles...</span>
                  </div>
                </div>
              )}
            </main>
          </>
        ) : (
          <AnalysisPanel />
        )}
      </div>
    </div>
  )
}

export default App
