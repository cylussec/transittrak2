import { useRef, useEffect } from 'react'
import * as d3 from 'd3'
import type { RouteInfo } from '../types'
import { useFetch } from '../hooks/useApi'

interface StatsResponse {
  group_by: string
  stats: Array<Record<string, unknown>>
}

interface Props {
  routes: RouteInfo[]
  selectedRoute: string | null
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function StatsView({ routes, selectedRoute }: Props) {
  const routeParam = selectedRoute ? `&route_id=${selectedRoute}` : ''

  const { data: byRoute } = useFetch<StatsResponse>(
    `/api/analysis/stats/ontime?group_by=route${routeParam}`
  )
  const { data: byHour } = useFetch<StatsResponse>(
    selectedRoute ? `/api/analysis/stats/ontime?group_by=hour&route_id=${selectedRoute}` : null
  )
  const { data: byDow } = useFetch<StatsResponse>(
    selectedRoute ? `/api/analysis/stats/ontime?group_by=dow&route_id=${selectedRoute}` : null
  )

  return (
    <div className="space-y-6">
      {/* Route summary table */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          Route Summary
        </h3>
        {!byRoute?.stats?.length ? (
          <p className="text-gray-500 text-sm">No stats yet — data accumulates over time.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">Route</th>
                  <th className="text-right py-2 px-3">Total Updates</th>
                  <th className="text-right py-2 px-3">Unique Trips</th>
                  <th className="text-right py-2 px-3">First Seen</th>
                  <th className="text-right py-2 px-3">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {byRoute.stats.map((row, i) => {
                  const route = routes.find(r => r.route_id === row.route_id)
                  const color = route?.route_color ? `#${route.route_color}` : undefined
                  return (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-2">
                          {color && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />}
                          <span className="font-medium text-white">
                            {route?.route_short_name ?? row.route_id as string}
                          </span>
                        </span>
                      </td>
                      <td className="text-right py-2 px-3 text-gray-300 font-mono">
                        {(row.total_updates as number).toLocaleString()}
                      </td>
                      <td className="text-right py-2 px-3 text-gray-300 font-mono">
                        {(row.unique_trips as number).toLocaleString()}
                      </td>
                      <td className="text-right py-2 px-3 text-gray-400 text-xs">
                        {new Date(row.first_update_ms as number).toLocaleString()}
                      </td>
                      <td className="text-right py-2 px-3 text-gray-400 text-xs">
                        {new Date(row.last_update_ms as number).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hour-of-day chart */}
      {selectedRoute && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Updates by Hour — Route {selectedRoute}
          </h3>
          {byHour?.stats?.length ? (
            <BarChart data={byHour.stats} xKey="hour_of_day" yKey="total_updates"
              xLabel="Hour" formatX={(v) => `${v}:00`} />
          ) : (
            <p className="text-gray-500 text-sm">Select a route and accumulate data to see hourly breakdown.</p>
          )}
        </div>
      )}

      {/* Day-of-week chart */}
      {selectedRoute && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Updates by Day of Week — Route {selectedRoute}
          </h3>
          {byDow?.stats?.length ? (
            <BarChart data={byDow.stats} xKey="day_of_week" yKey="total_updates"
              xLabel="Day" formatX={(v) => DOW_NAMES[v as number] ?? String(v)} />
          ) : (
            <p className="text-gray-500 text-sm">Select a route and accumulate data to see daily breakdown.</p>
          )}
        </div>
      )}
    </div>
  )
}

function BarChart({ data, xKey, yKey, xLabel, formatX }: {
  data: Array<Record<string, unknown>>
  xKey: string
  yKey: string
  xLabel: string
  formatX: (v: unknown) => string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data.length) return

    const margin = { top: 10, right: 20, bottom: 40, left: 60 }
    const rect = containerRef.current.getBoundingClientRect()
    const width = rect.width
    const height = 220

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    const x = d3.scaleBand()
      .domain(data.map(d => String(d[xKey])))
      .range([0, innerW])
      .padding(0.3)

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d[yKey] as number) ?? 0])
      .nice()
      .range([innerH, 0])

    g.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', d => x(String(d[xKey])) ?? 0)
      .attr('y', d => y(d[yKey] as number))
      .attr('width', x.bandwidth())
      .attr('height', d => innerH - y(d[yKey] as number))
      .attr('fill', '#3b82f6')
      .attr('rx', 2)

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickFormat(v => formatX(v)))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    g.selectAll('.domain').attr('stroke', '#4b5563')
    g.selectAll('.tick line').attr('stroke', '#4b5563')

    // X label
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b7280')
      .style('font-size', '11px')
      .text(xLabel)

  }, [data, xKey, yKey, xLabel, formatX])

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} />
    </div>
  )
}
