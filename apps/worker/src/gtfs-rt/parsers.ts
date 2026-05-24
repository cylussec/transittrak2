import { transit_realtime } from './gtfs-realtime.js';

export interface ParsedVehiclePosition {
	agencyId: string;
	tsMs: number;
	vehicleId: string;
	tripId: string | null;
	routeId: string | null;
	directionId: number | null;
	stopId: string | null;
	lat: number;
	lon: number;
	bearing: number | null;
	speed: number | null;
	currentStatus: string | null;
	currentStopSequence: number | null;
	gtfsVersionId: string;
}

export interface ParsedTripUpdate {
	agencyId: string;
	tsMs: number;
	tripId: string;
	routeId: string | null;
	stopId: string;
	stopSequence: number | null;
	arrivalTimeMs: number | null;
	departureTimeMs: number | null;
	scheduleRelationship: string | null;
	gtfsVersionId: string;
}

export interface ParsedAlert {
	alertId: string;
	agencyId: string;
	tsMs: number;
	cause: string | null;
	effect: string | null;
	headerText: string | null;
	descriptionText: string | null;
	url: string | null;
	activePeriodStart: number | null;
	activePeriodEnd: number | null;
	gtfsVersionId: string;
}

export function parseVehiclePositions(
	protobufBytes: Uint8Array,
	agencyId: string,
	gtfsVersionId: string
): ParsedVehiclePosition[] {
	const message = transit_realtime.FeedMessage.decode(protobufBytes);
	const feedTimestamp = message.header.timestamp ? Number(message.header.timestamp) * 1000 : Date.now();
	const positions: ParsedVehiclePosition[] = [];

	for (const entity of message.entity) {
		if (!entity.vehicle) continue;

		const vp = entity.vehicle;
		const position = vp.position;
		const trip = vp.trip;
		const vehicle = vp.vehicle;

		if (!position || position.latitude === null || position.longitude === null) continue;
		if (!vehicle || !vehicle.id) continue;

		const timestamp = vp.timestamp ? Number(vp.timestamp) * 1000 : feedTimestamp;

		const currentStatus = vp.currentStatus !== null && vp.currentStatus !== undefined
			? ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'][vp.currentStatus]
			: null;

		positions.push({
			agencyId,
			tsMs: timestamp,
			vehicleId: vehicle.id,
			tripId: trip?.tripId || null,
			routeId: trip?.routeId || null,
			directionId: trip?.directionId ?? null,
			stopId: vp.stopId || null,
			lat: position.latitude,
			lon: position.longitude,
			bearing: position.bearing ?? null,
			speed: position.speed ?? null,
			currentStatus,
			currentStopSequence: vp.currentStopSequence ?? null,
			gtfsVersionId,
		});
	}

	return positions;
}

export function parseTripUpdates(
	protobufBytes: Uint8Array,
	agencyId: string,
	gtfsVersionId: string
): ParsedTripUpdate[] {
	const message = transit_realtime.FeedMessage.decode(protobufBytes);
	const feedTimestamp = message.header.timestamp ? Number(message.header.timestamp) * 1000 : Date.now();
	const updates: ParsedTripUpdate[] = [];

	for (const entity of message.entity) {
		if (!entity.tripUpdate) continue;

		const tu = entity.tripUpdate;
		const trip = tu.trip;
		const timestamp = tu.timestamp ? Number(tu.timestamp) * 1000 : feedTimestamp;

		if (!trip.tripId) continue;
		if (!tu.stopTimeUpdate) continue;

		for (const stopTimeUpdate of tu.stopTimeUpdate) {
			if (!stopTimeUpdate.stopId) continue;

			const arrivalTime = stopTimeUpdate.arrival?.time
				? Number(stopTimeUpdate.arrival.time) * 1000
				: null;
			const departureTime = stopTimeUpdate.departure?.time
				? Number(stopTimeUpdate.departure.time) * 1000
				: null;

			const scheduleRelationship = stopTimeUpdate.scheduleRelationship !== null && stopTimeUpdate.scheduleRelationship !== undefined
				? ['SCHEDULED', 'SKIPPED', 'NO_DATA'][stopTimeUpdate.scheduleRelationship]
				: null;

			updates.push({
				agencyId,
				tsMs: timestamp,
				tripId: trip.tripId,
				routeId: trip.routeId || null,
				stopId: stopTimeUpdate.stopId,
				stopSequence: stopTimeUpdate.stopSequence ?? null,
				arrivalTimeMs: arrivalTime,
				departureTimeMs: departureTime,
				scheduleRelationship,
				gtfsVersionId,
			});
		}
	}

	return updates;
}

export function parseAlerts(
	protobufBytes: Uint8Array,
	agencyId: string,
	gtfsVersionId: string
): ParsedAlert[] {
	const message = transit_realtime.FeedMessage.decode(protobufBytes);
	const feedTimestamp = message.header.timestamp ? Number(message.header.timestamp) * 1000 : Date.now();
	const alerts: ParsedAlert[] = [];

	for (const entity of message.entity) {
		if (!entity.alert) continue;

		const alert = entity.alert;

		const causeEnum = ['UNKNOWN_CAUSE', 'OTHER_CAUSE', 'TECHNICAL_PROBLEM', 'STRIKE', 'DEMONSTRATION', 'ACCIDENT', 'HOLIDAY', 'WEATHER', 'MAINTENANCE', 'CONSTRUCTION', 'POLICE_ACTIVITY', 'MEDICAL_EMERGENCY'];
		const effectEnum = ['NO_SERVICE', 'REDUCED_SERVICE', 'SIGNIFICANT_DELAYS', 'DETOUR', 'ADDITIONAL_SERVICE', 'MODIFIED_SERVICE', 'OTHER_EFFECT', 'UNKNOWN_EFFECT', 'STOP_MOVED'];
		
		const cause = alert.cause !== null && alert.cause !== undefined ? causeEnum[alert.cause - 1] : null;
		const effect = alert.effect !== null && alert.effect !== undefined ? effectEnum[alert.effect - 1] : null;

		const headerText = alert.headerText?.translation?.[0]?.text || null;
		const descriptionText = alert.descriptionText?.translation?.[0]?.text || null;
		const url = alert.url?.translation?.[0]?.text || null;

		const activePeriod = alert.activePeriod?.[0];
		const activePeriodStart = activePeriod?.start ? Number(activePeriod.start) * 1000 : null;
		const activePeriodEnd = activePeriod?.end ? Number(activePeriod.end) * 1000 : null;

		alerts.push({
			alertId: entity.id,
			agencyId,
			tsMs: feedTimestamp,
			cause,
			effect,
			headerText,
			descriptionText,
			url,
			activePeriodStart,
			activePeriodEnd,
			gtfsVersionId,
		});
	}

	return alerts;
}
