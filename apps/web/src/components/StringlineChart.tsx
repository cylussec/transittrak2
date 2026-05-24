import { useRef, useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { StringlineData, RouteStop } from '../types'

interface Props {
  data: StringlineData | null
  stops: RouteStop[]
  loading?: boolean
}

const VEHICLE_COLORS = [
  '#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a78bfa',
  '#fb923c', '#2dd4bf', '#f472b6', '#818cf8', '#4ade80',
  '#e879f9', '#38bdf8', '#facc15', '#fb7185', '#22d3ee',
]

export function StringlineChart({ data, stops, loading }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  // Use data.stops if provided (backend-computed), otherwise prop
  const chartStops = data?.stops ?? stops

  // Build a map from stop_id -> sequence index
  const stopIndex = useMemo(() => {
    const map = new Map<string, number>()
    chartStops.forEach((s, i) => map.set(s.stop_id, i))
    return map
  }, [chartStops])

  // Observe container width with ResizeObserver for stable sizing
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const update = (w: number) => setWidth(Math.max(600, Math.floor(w)))
    // Initial read (ResizeObserver may not fire on first observe in all browsers)
    update(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        update(entry.contentRect.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!svgRef.current || !data || chartStops.length === 0) return

    const vehicleIds = Object.keys(data.vehicles)
    if (vehicleIds.length === 0) return

    const margin = { top: 30, right: 30, bottom: 50, left: 160 }
    const height = Math.max(500, chartStops.length * 28 + margin.top + margin.bottom)

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    // X axis: time
    const xScale = d3.scaleTime()
      .domain([new Date(data.since_ms), new Date(data.until_ms)])
      .range([0, innerW])

    // Y axis: stops (ordered by sequence)
    const yScale = d3.scalePoint()
      .domain(chartStops.map(s => s.stop_id))
      .range([0, innerH])
      .padding(0.5)

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(chartStops)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d.stop_id) ?? 0)
      .attr('y2', d => yScale(d.stop_id) ?? 0)
      .attr('stroke', '#374151')
      .attr('stroke-width', 0.5)

    // X axis
    const xAxis = d3.axisBottom(xScale)
      .ticks(d3.timeMinute.every(15))
      .tickFormat(d => d3.timeFormat('%-I:%M %p')(d as Date))
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    // Y axis: stop names
    const yAxis = d3.axisLeft(yScale)
      .tickFormat(stopId => {
        const stop = chartStops.find(s => s.stop_id === stopId)
        const name = stop?.stop_name ?? stopId
        return name.length > 22 ? name.slice(0, 20) + '…' : name
      })
    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', '#d1d5db')
      .style('font-size', '10px')

    // Style axis lines
    g.selectAll('.domain').attr('stroke', '#4b5563')
    g.selectAll('.tick line').attr('stroke', '#4b5563')

    // Draw vehicle lines
    const line = d3.line<{ ts_ms: number; seq: number }>()
      .x(d => xScale(new Date(d.ts_ms)))
      .y(d => {
        // Interpolate between stops based on sequence
        const stopIds = chartStops.map(s => s.stop_id)
        const idx = d.seq
        if (idx >= 0 && idx < stopIds.length) {
          return yScale(stopIds[idx]) ?? 0
        }
        // Clamp
        return idx < 0 ? (yScale(stopIds[0]) ?? 0) : (yScale(stopIds[stopIds.length - 1]) ?? 0)
      })
      .curve(d3.curveMonotoneX)

    vehicleIds.forEach((vid, vi) => {
      const points = data.vehicles[vid]
      const mapped = points
        .map(p => {
          // Use stop_id to find position, falling back to current_stop_sequence
          let seq = -1
          if (p.stop_id && stopIndex.has(p.stop_id)) {
            seq = stopIndex.get(p.stop_id)!
          } else if (typeof p.current_stop_sequence === 'number') {
            // GTFS stop_sequence is typically 1-based; convert to 0-based index
            seq = p.current_stop_sequence > 0 ? p.current_stop_sequence - 1 : p.current_stop_sequence
          }
          return { ts_ms: p.ts_ms, seq }
        })
        .filter(p => p.seq >= 0 && p.seq < chartStops.length)

      if (mapped.length < 2) return

      const color = VEHICLE_COLORS[vi % VEHICLE_COLORS.length]

      g.append('path')
        .datum(mapped)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.8)
        .attr('d', line)

      // Add vehicle label at the start
      const first = mapped[0]
      g.append('text')
        .attr('x', xScale(new Date(first.ts_ms)) + 4)
        .attr('y', (yScale(chartStops[first.seq]?.stop_id ?? '') ?? 0) - 6)
        .attr('fill', color)
        .style('font-size', '9px')
        .style('font-weight', 'bold')
        .text(vid)
    })

    // Title
    const dirLabel = data.direction_id === 0 ? 'Outbound'
      : data.direction_id === 1 ? 'Inbound'
      : 'Combined'
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e5e7eb')
      .style('font-size', '13px')
      .style('font-weight', 'bold')
      .text(data.vehicle_id
        ? `Stringline — Vehicle ${data.vehicle_id}`
        : `Stringline — Route ${data.route_id} (${dirLabel})`)

  }, [width, data, chartStops, stopIndex])

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-gray-400">Loading stringline data...</div>
  }

  if (!data || Object.keys(data.vehicles).length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        No vehicle data for this period. Data accumulates over time — check back in a few hours.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full overflow-x-auto bg-gray-900 rounded-lg">
      <svg ref={svgRef} className="min-w-[600px] block" />
    </div>
  )
}
