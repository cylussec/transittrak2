import { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'
import type { RouteInfo } from '../types'
import { useFetch } from '../hooks/useApi'

interface OnTimeGroup {
  group_key: string | number | null
  route_id: string | null
  samples: number
  on_time_pct: number | null
  early_pct: number | null
  late_pct: number | null
  avg_delay_s: number | null
  std_delay_s: number | null
  p50_delay_s: number | null
  p90_delay_s: number | null
}

interface OnTimeResponse {
  filters: Record<string, unknown>
  precision: 'exact' | 'rollup'
  groups: OnTimeGroup[]
}

interface Props {
  routes: RouteInfo[]
  selectedRoute: string | null
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_VALUES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const THIRTY_DAYS = 30 * 24 * 3600 * 1000

function fmt(n: number | null, unit = ''): string {
  if (n === null) return '—'
  return `${n}${unit}`
}

export function StatsView({ routes, selectedRoute }: Props) {
  // Filter state
  const [dowFilter, setDowFilter] = useState<Set<number>>(new Set())
  const [hourStart, setHourStart] = useState(0)
  const [hourEnd, setHourEnd] = useState(24)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - THIRTY_DAYS)
    return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [groupBy, setGroupBy] = useState<'route' | 'hour' | 'dow'>('route')

  const toggleDow = useCallback((idx: number) => {
    setDowFilter(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const setPreset = useCallback((preset: 'all' | 'weekdays' | 'weekends') => {
    if (preset === 'all') setDowFilter(new Set())
    else if (preset === 'weekdays') setDowFilter(new Set([1, 2, 3, 4, 5]))
    else setDowFilter(new Set([0, 6]))
  }, [])

  // Build query string
  const buildQuery = useCallback((gb: string) => {
    const params = new URLSearchParams()
    params.set('agency_id', 'mta-maryland')
    if (selectedRoute) params.append('route_id', selectedRoute)
    params.set('start_ms', String(new Date(startDate + 'T00:00:00').getTime()))
    params.set('end_ms', String(new Date(endDate + 'T23:59:59').getTime()))
    params.set('group_by', gb)
    if (dowFilter.size > 0 && dowFilter.size < 7) {
      params.set('dow', [...dowFilter].map(i => DOW_VALUES[i]).join(','))
    }
    if (hourStart > 0 || hourEnd < 24) {
      params.set('hour_range', `${hourStart}-${hourEnd}`)
    }
    return `/api/analysis/stats/ontime?${params.toString()}`
  }, [selectedRoute, startDate, endDate, dowFilter, hourStart, hourEnd])

  const { data: byRoute } = useFetch<OnTimeResponse>(buildQuery('route'))
  const { data: byHour } = useFetch<OnTimeResponse>(
    selectedRoute ? buildQuery('hour') : null
  )
  const { data: byDow } = useFetch<OnTimeResponse>(
    selectedRoute ? buildQuery('dow') : null
  )

  const activeData = groupBy === 'route' ? byRoute : groupBy === 'hour' ? byHour : byDow

  // Build a human-readable filter label for chart titles
  const filterLabel = [
    dowFilter.size > 0 && dowFilter.size < 7
      ? [...dowFilter].map(i => DOW_LABELS[i]).join('/') + 's'
      : null,
    (hourStart > 0 || hourEnd < 24) ? `${hourStart}:00–${hourEnd}:00` : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-gray-800 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Filters</h3>

        {/* Date range */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-gray-400 whitespace-nowrap">Date range</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white"
          />
          <span className="text-gray-500 text-xs">to</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white"
          />
        </div>

        {/* Day-of-week pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400 whitespace-nowrap">Day of week</span>
          <button
            onClick={() => setPreset('all')}
            className={`px-2 py-0.5 rounded text-xs font-medium ${dowFilter.size === 0 ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >All</button>
          <button
            onClick={() => setPreset('weekdays')}
            className={`px-2 py-0.5 rounded text-xs font-medium ${dowFilter.size === 5 && !dowFilter.has(0) && !dowFilter.has(6) ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >Weekdays</button>
          <button
            onClick={() => setPreset('weekends')}
            className={`px-2 py-0.5 rounded text-xs font-medium ${dowFilter.size === 2 && dowFilter.has(0) && dowFilter.has(6) ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >Weekends</button>
          {DOW_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => toggleDow(i)}
              className={`px-2 py-0.5 rounded text-xs font-medium ${dowFilter.has(i) ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >{label}</button>
          ))}
        </div>

        {/* Hour range slider */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-400 whitespace-nowrap">Hour of day</span>
          <span className="text-xs text-blue-400 font-mono w-20">{hourStart}:00 – {hourEnd}:00</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">From</span>
            <input type="range" min={0} max={23} value={hourStart}
              onChange={e => setHourStart(Math.min(Number(e.target.value), hourEnd - 1))}
              className="w-28 accent-blue-500" />
            <span className="text-xs text-gray-500">To</span>
            <input type="range" min={1} max={24} value={hourEnd}
              onChange={e => setHourEnd(Math.max(Number(e.target.value), hourStart + 1))}
              className="w-28 accent-blue-500" />
          </div>
          {(hourStart > 0 || hourEnd < 24) && (
            <button onClick={() => { setHourStart(0); setHourEnd(24) }}
              className="text-xs text-gray-400 hover:text-white underline">Reset</button>
          )}
        </div>

        {/* Group by */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Group by</span>
          {(['route', 'hour', 'dow'] as const).map(g => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`px-2 py-0.5 rounded text-xs font-medium ${groupBy === g ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
              {g === 'dow' ? 'Day of Week' : g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* On-time summary table */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">
          On-Time Performance
          {filterLabel && <span className="ml-2 text-blue-400 normal-case font-normal text-xs">— {filterLabel}</span>}
        </h3>
        {activeData?.precision && (
          <p className="text-xs text-gray-500 mb-3">
            Precision: <span className="text-gray-400">{activeData.precision}</span>
            {activeData.precision === 'rollup' && ' (percentiles unavailable for ranges &gt;30 days)'}
          </p>
        )}
        {!activeData?.groups?.length ? (
          <p className="text-gray-500 text-sm">No delay data yet — rows accumulate as trips are parsed with GTFS static loaded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700 text-xs">
                  <th className="text-left py-2 px-3">
                    {groupBy === 'route' ? 'Route' : groupBy === 'hour' ? 'Hour' : 'Day'}
                  </th>
                  <th className="text-right py-2 px-3">Samples</th>
                  <th className="text-right py-2 px-3">On-Time %</th>
                  <th className="text-right py-2 px-3">Early %</th>
                  <th className="text-right py-2 px-3">Late %</th>
                  <th className="text-right py-2 px-3">Avg Delay</th>
                  <th className="text-right py-2 px-3">Std Dev</th>
                  <th className="text-right py-2 px-3">p50</th>
                  <th className="text-right py-2 px-3">p90</th>
                </tr>
              </thead>
              <tbody>
                {activeData.groups.map((row, i) => {
                  const route = routes.find(r => r.route_id === row.route_id)
                  const color = route?.route_color ? `#${route.route_color}` : undefined
                  const label = groupBy === 'route'
                    ? (route?.route_short_name ?? row.route_id ?? String(row.group_key))
                    : groupBy === 'hour'
                      ? `${row.group_key}:00`
                      : DOW_LABELS[Number(row.group_key)] ?? String(row.group_key)
                  const onTimePct = row.on_time_pct
                  const pctColor = onTimePct === null ? 'text-gray-500'
                    : onTimePct >= 80 ? 'text-green-400'
                    : onTimePct >= 60 ? 'text-yellow-400'
                    : 'text-red-400'
                  return (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-2">
                          {color && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                          <span className="font-medium text-white">{label}</span>
                        </span>
                      </td>
                      <td className="text-right py-2 px-3 text-gray-300 font-mono text-xs">{row.samples.toLocaleString()}</td>
                      <td className={`text-right py-2 px-3 font-mono font-semibold text-xs ${pctColor}`}>
                        {fmt(row.on_time_pct, '%')}
                      </td>
                      <td className="text-right py-2 px-3 text-gray-300 font-mono text-xs">{fmt(row.early_pct, '%')}</td>
                      <td className="text-right py-2 px-3 text-gray-300 font-mono text-xs">{fmt(row.late_pct, '%')}</td>
                      <td className="text-right py-2 px-3 text-gray-300 font-mono text-xs">{fmt(row.avg_delay_s, 's')}</td>
                      <td className="text-right py-2 px-3 text-gray-400 font-mono text-xs">{fmt(row.std_delay_s, 's')}</td>
                      <td className="text-right py-2 px-3 text-gray-400 font-mono text-xs">{fmt(row.p50_delay_s, 's')}</td>
                      <td className="text-right py-2 px-3 text-gray-400 font-mono text-xs">{fmt(row.p90_delay_s, 's')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* On-time % bar chart */}
      {activeData?.groups && activeData.groups.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            On-Time % by {groupBy === 'route' ? 'Route' : groupBy === 'hour' ? 'Hour' : 'Day of Week'}
            {filterLabel && <span className="ml-2 text-blue-400 normal-case font-normal text-xs">— {filterLabel}</span>}
          </h3>
          <BarChart
            data={activeData.groups.map(g => ({
              label: groupBy === 'route'
                ? (routes.find(r => r.route_id === g.route_id)?.route_short_name ?? g.route_id ?? String(g.group_key))
                : groupBy === 'hour'
                  ? `${g.group_key}:00`
                  : DOW_LABELS[Number(g.group_key)] ?? String(g.group_key),
              value: g.on_time_pct,
              color: routes.find(r => r.route_id === g.route_id)?.route_color,
            }))}
            yLabel="On-Time %"
            yDomain={[0, 100]}
          />
        </div>
      )}

      {/* Avg delay bar chart */}
      {activeData?.groups && activeData.groups.some(g => g.avg_delay_s !== null) && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Avg Delay (seconds) by {groupBy === 'route' ? 'Route' : groupBy === 'hour' ? 'Hour' : 'Day of Week'}
            {filterLabel && <span className="ml-2 text-blue-400 normal-case font-normal text-xs">— {filterLabel}</span>}
          </h3>
          <BarChart
            data={activeData.groups.map(g => ({
              label: groupBy === 'route'
                ? (routes.find(r => r.route_id === g.route_id)?.route_short_name ?? g.route_id ?? String(g.group_key))
                : groupBy === 'hour'
                  ? `${g.group_key}:00`
                  : DOW_LABELS[Number(g.group_key)] ?? String(g.group_key),
              value: g.avg_delay_s,
              color: undefined,
            }))}
            yLabel="Avg Delay (s)"
          />
        </div>
      )}
    </div>
  )
}

interface BarDatum { label: string; value: number | null; color?: string | null }

function BarChart({ data, yLabel, yDomain }: {
  data: BarDatum[]
  yLabel: string
  yDomain?: [number, number]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const validData = data.filter(d => d.value !== null) as Array<BarDatum & { value: number }>
    if (!svgRef.current || !containerRef.current || !validData.length) return

    const margin = { top: 10, right: 20, bottom: 48, left: 60 }
    const rect = containerRef.current.getBoundingClientRect()
    const width = Math.max(rect.width, 100)
    const height = 220

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    const x = d3.scaleBand()
      .domain(validData.map(d => d.label))
      .range([0, innerW])
      .padding(0.3)

    const extent: [number, number] = yDomain ?? [
      Math.min(0, d3.min(validData, d => d.value) ?? 0),
      d3.max(validData, d => d.value) ?? 0,
    ]

    const y = d3.scaleLinear()
      .domain(extent)
      .nice()
      .range([innerH, 0])

    const zero = y(0)

    g.selectAll('rect')
      .data(validData)
      .join('rect')
      .attr('x', d => x(d.label) ?? 0)
      .attr('y', d => d.value >= 0 ? y(d.value) : zero)
      .attr('width', x.bandwidth())
      .attr('height', d => Math.abs(y(d.value) - zero))
      .attr('fill', d => d.color ? `#${d.color}` : d.value < 0 ? '#f87171' : '#3b82f6')
      .attr('rx', 2)

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '9px')
      .attr('text-anchor', 'end')
      .attr('dx', '-0.4em')
      .attr('dy', '0.6em')
      .attr('transform', 'rotate(-35)')

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    g.selectAll('.domain').attr('stroke', '#4b5563')
    g.selectAll('.tick line').attr('stroke', '#4b5563')

    if (extent[0] < 0 && extent[1] > 0) {
      g.append('line')
        .attr('x1', 0).attr('x2', innerW)
        .attr('y1', zero).attr('y2', zero)
        .attr('stroke', '#6b7280').attr('stroke-dasharray', '3,3')
    }

    svg.append('text')
      .attr('x', margin.left / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b7280')
      .style('font-size', '10px')
      .attr('transform', `rotate(-90, ${margin.left / 2}, ${height / 2})`)
      .text(yLabel)

  }, [data, yLabel, yDomain])

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} />
    </div>
  )
}
