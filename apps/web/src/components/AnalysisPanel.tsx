import { useState, useMemo } from 'react'
import { BarChart3, GitBranch, ChevronDown, Bus } from 'lucide-react'
import { StringlineChart } from './StringlineChart'
import { StatsView } from './StatsView'
import { useFetch } from '../hooks/useApi'
import type { RouteInfo, StringlineData } from '../types'

interface RoutesResponse { routes: RouteInfo[] }
interface VehicleInfo { vehicle_id: string; route_id: string | null; direction_id: number | null }
interface VehiclesResponse { vehicles: VehicleInfo[] }

type RouteMode = '0' | '1' | 'all'
const ROUTE_MODES: { value: RouteMode; label: string }[] = [
  { value: '0', label: 'Outbound' },
  { value: '1', label: 'Inbound' },
  { value: 'all', label: 'Combined' },
]

export function AnalysisPanel() {
  const [subTab, setSubTab] = useState<'route' | 'vehicle' | 'stats'>('route')
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null)
  const [routeMode, setRouteMode] = useState<RouteMode>('0')
  const [hoursBack, setHoursBack] = useState(2)

  const { data: routesData } = useFetch<RoutesResponse>('/api/analysis/routes')
  const routes = routesData?.routes ?? []

  const { data: vehiclesData } = useFetch<VehiclesResponse>(
    subTab === 'vehicle' ? `/api/analysis/vehicles?since_ms=${Date.now() - 2 * 60 * 60 * 1000}` : null
  )
  const vehicles = vehiclesData?.vehicles ?? []

  const sinceMs = useMemo(() => Date.now() - hoursBack * 60 * 60 * 1000, [hoursBack])
  const stringlineUrl = useMemo(() =>
    selectedRoute && subTab === 'route'
      ? `/api/analysis/routes/${selectedRoute}/stringline?direction_id=${routeMode}&since_ms=${sinceMs}`
      : null,
    [selectedRoute, routeMode, sinceMs, subTab]
  )
  const { data: stringlineData, loading: slLoading } = useFetch<StringlineData>(stringlineUrl)

  // Vehicle stringline
  const vehicleStringlineUrl = useMemo(() =>
    selectedVehicle && subTab === 'vehicle'
      ? `/api/analysis/vehicles/${selectedVehicle}/stringline?since_ms=${sinceMs}`
      : null,
    [selectedVehicle, sinceMs, subTab]
  )
  const { data: vehicleSlData, loading: vSlLoading } = useFetch<StringlineData>(vehicleStringlineUrl)

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-72 bg-gray-900 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Analysis</h2>
          <p className="text-xs text-gray-400 mt-1">Route performance & visualization</p>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setSubTab('route')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${subTab === 'route' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Route
          </button>
          <button
            onClick={() => setSubTab('vehicle')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${subTab === 'vehicle' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <Bus className="w-3.5 h-3.5" />
            Vehicle
          </button>
          <button
            onClick={() => setSubTab('stats')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${subTab === 'stats' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Stats
          </button>
        </div>

        {subTab === 'route' && (
          <>
            {/* Route selector */}
            <div className="p-3 border-b border-gray-700 space-y-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Route</label>
              <div className="relative">
                <select
                  value={selectedRoute ?? ''}
                  onChange={(e) => setSelectedRoute(e.target.value || null)}
                  className="w-full bg-gray-800 text-white text-sm rounded px-3 py-2 border border-gray-600 appearance-none focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a route...</option>
                  {routes.map(r => (
                    <option key={r.route_id} value={r.route_id}>
                      {r.route_short_name ?? r.route_id} — {r.route_long_name ?? r.route_id}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Mode selector */}
            <div className="p-3 border-b border-gray-700 space-y-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Mode</label>
              <div className="flex gap-1.5">
                {ROUTE_MODES.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setRouteMode(m.value)}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors
                      ${routeMode === m.value ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {subTab === 'vehicle' && (
          <>
            {/* Vehicle selector */}
            <div className="p-3 border-b border-gray-700 space-y-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Vehicle</label>
              <div className="relative">
                <select
                  value={selectedVehicle ?? ''}
                  onChange={(e) => setSelectedVehicle(e.target.value || null)}
                  className="w-full bg-gray-800 text-white text-sm rounded px-3 py-2 border border-gray-600 appearance-none focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a vehicle...</option>
                  {vehicles.map(v => (
                    <option key={v.vehicle_id} value={v.vehicle_id}>
                      {v.vehicle_id} {v.route_id ? `— ${v.route_id}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </>
        )}

        {/* Time range for stringline */}
        {(subTab === 'route' || subTab === 'vehicle') && (
          <div className="p-3 border-b border-gray-700 space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">Time Range</label>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 4, 8, 12, 24].map(h => (
                <button
                  key={h}
                  onClick={() => setHoursBack(h)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors
                    ${hoursBack === h ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        {subTab === 'route' && (
          <div className="p-3 text-xs text-gray-500 leading-relaxed">
            <p><strong className="text-gray-400">Route stringline</strong> shows vehicle progress along a route over time.</p>
            <p className="mt-1">Each line is a vehicle. Lines converging = bunching. Steeper slope = faster travel.</p>
          </div>
        )}
        {subTab === 'vehicle' && (
          <div className="p-3 text-xs text-gray-500 leading-relaxed">
            <p><strong className="text-gray-400">Vehicle stringline</strong> shows a single vehicle's journey across all trips and directions.</p>
            <p className="mt-1">See the full round-trip lifecycle of a bus over time.</p>
          </div>
        )}
      </aside>

      {/* Content */}
      <main className="flex-1 bg-gray-950 overflow-y-auto p-6">
        {subTab === 'route' ? (
          selectedRoute ? (
            <StringlineChart
              data={stringlineData}
              stops={[]}
              loading={slLoading}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a route from the sidebar to view its stringline chart.
            </div>
          )
        ) : subTab === 'vehicle' ? (
          selectedVehicle ? (
            <StringlineChart
              data={vehicleSlData}
              stops={vehicleSlData?.stops ?? []}
              loading={vSlLoading}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a vehicle from the sidebar to view its stringline chart.
            </div>
          )
        ) : (
          <StatsView routes={routes} selectedRoute={selectedRoute} />
        )}
      </main>
    </div>
  )
}
