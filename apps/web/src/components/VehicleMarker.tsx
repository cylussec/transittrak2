import type { RouteInfo } from '../types'

interface Props {
  routeId: string | null
  routeInfo: RouteInfo | null
  bearing: number | null
  onClick: () => void
}

export function VehicleMarker({ routeId, routeInfo, bearing, onClick }: Props) {
  const bgColor = routeInfo?.route_color ? `#${routeInfo.route_color}` : '#6b7280'
  const textColor = routeInfo?.route_text_color ? `#${routeInfo.route_text_color}` : '#ffffff'
  const shortName = routeInfo?.route_short_name ?? routeId ?? '?'

  // Extract display label: use route number for numbered routes, just a dot for named routes (CityLink etc.)
  const isNumberOnly = /^\d{1,3}$/.test(shortName)
  const fullLabel = routeInfo?.route_long_name
    ? `${shortName} — ${routeInfo.route_long_name}`
    : shortName

  return (
    <div
      onClick={onClick}
      className="cursor-pointer hover:scale-125 transition-transform"
      style={{ transform: bearing != null ? `rotate(${bearing}deg)` : undefined }}
      title={`Route ${fullLabel}`}
    >
      {isNumberOnly ? (
        <div
          className="flex items-center justify-center rounded-full border-2 border-white shadow-lg font-bold"
          style={{
            backgroundColor: bgColor,
            color: textColor,
            width: shortName.length <= 2 ? 22 : 28,
            height: shortName.length <= 2 ? 22 : 28,
            fontSize: shortName.length <= 2 ? 10 : 8,
            lineHeight: 1,
          }}
        >
          {shortName}
        </div>
      ) : (
        <div
          className="w-5 h-5 rounded-full border-2 border-white shadow-lg"
          style={{ backgroundColor: bgColor }}
        />
      )}
    </div>
  )
}
