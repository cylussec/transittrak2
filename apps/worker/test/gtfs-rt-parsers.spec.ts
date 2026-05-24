import { describe, it, expect } from 'vitest';
import { parseVehiclePositions, parseTripUpdates, parseAlerts } from '../src/gtfs-rt/parsers';
import { transit_realtime } from '../src/gtfs-rt/gtfs-realtime.js';

describe('GTFS-RT Parsers', () => {
	describe('parseVehiclePositions', () => {
		it('should parse vehicle positions from protobuf', () => {
			const feedMessage = transit_realtime.FeedMessage.create({
				header: {
					gtfsRealtimeVersion: '2.0',
					timestamp: 1000,
				},
				entity: [
					{
						id: 'vehicle-1',
						vehicle: {
							trip: {
								tripId: 'trip-123',
								routeId: 'route-1',
								directionId: 0,
							},
							vehicle: {
								id: 'bus-001',
							},
							position: {
								latitude: 39.2904,
								longitude: -76.6122,
								bearing: 90,
								speed: 15.5,
							},
							timestamp: 1001,
							currentStatus: 2,
							currentStopSequence: 5,
						},
					},
				],
			});

			const bytes = transit_realtime.FeedMessage.encode(feedMessage).finish();
			const positions = parseVehiclePositions(bytes, 'test-agency', 'test-version');

			expect(positions).toHaveLength(1);
			expect(positions[0].agencyId).toBe('test-agency');
			expect(positions[0].tsMs).toBe(1001000);
			expect(positions[0].vehicleId).toBe('bus-001');
			expect(positions[0].tripId).toBe('trip-123');
			expect(positions[0].routeId).toBe('route-1');
			expect(positions[0].directionId).toBe(0);
			expect(positions[0].lat).toBeCloseTo(39.2904, 2);
			expect(positions[0].lon).toBeCloseTo(-76.6122, 2);
			expect(positions[0].bearing).toBe(90);
			expect(positions[0].speed).toBe(15.5);
			expect(positions[0].currentStatus).toBe('IN_TRANSIT_TO');
			expect(positions[0].currentStopSequence).toBe(5);
			expect(positions[0].gtfsVersionId).toBe('test-version');
		});

		it('should skip entities without valid position', () => {
			const feedMessage = transit_realtime.FeedMessage.create({
				header: {
					gtfsRealtimeVersion: '2.0',
					timestamp: 1000,
				},
				entity: [
					{
						id: 'vehicle-1',
						vehicle: {
							vehicle: { id: 'bus-001' },
						},
					},
				],
			});

			const bytes = transit_realtime.FeedMessage.encode(feedMessage).finish();
			const positions = parseVehiclePositions(bytes, 'test-agency', 'test-version');

			expect(positions).toHaveLength(0);
		});
	});

	describe('parseTripUpdates', () => {
		it('should parse trip updates from protobuf', () => {
			const feedMessage = transit_realtime.FeedMessage.create({
				header: {
					gtfsRealtimeVersion: '2.0',
					timestamp: 2000,
				},
				entity: [
					{
						id: 'trip-update-1',
						tripUpdate: {
							trip: {
								tripId: 'trip-456',
								routeId: 'route-2',
							},
							timestamp: 2001,
							stopTimeUpdate: [
								{
									stopSequence: 1,
									stopId: 'stop-A',
									arrival: { time: 3000 },
									departure: { time: 3010 },
									scheduleRelationship: 0,
								},
							],
						},
					},
				],
			});

			const bytes = transit_realtime.FeedMessage.encode(feedMessage).finish();
			const updates = parseTripUpdates(bytes, 'test-agency', 'test-version');

			expect(updates).toHaveLength(1);
			expect(updates[0]).toMatchObject({
				agencyId: 'test-agency',
				tsMs: 2001000,
				tripId: 'trip-456',
				routeId: 'route-2',
				stopId: 'stop-A',
				stopSequence: 1,
				arrivalTimeMs: 3000000,
				departureTimeMs: 3010000,
				scheduleRelationship: 'SCHEDULED',
				gtfsVersionId: 'test-version',
			});
		});
	});

	describe('parseAlerts', () => {
		it('should parse alerts from protobuf', () => {
			const feedMessage = transit_realtime.FeedMessage.create({
				header: {
					gtfsRealtimeVersion: '2.0',
					timestamp: 4000,
				},
				entity: [
					{
						id: 'alert-1',
						alert: {
							activePeriod: [
								{
									start: 5000,
									end: 6000,
								},
							],
							cause: 3,
							effect: 3,
							headerText: {
								translation: [
									{
										text: 'Service Alert',
										language: 'en',
									},
								],
							},
							descriptionText: {
								translation: [
									{
										text: 'Delays expected',
										language: 'en',
									},
								],
							},
						},
					},
				],
			});

			const bytes = transit_realtime.FeedMessage.encode(feedMessage).finish();
			const alerts = parseAlerts(bytes, 'test-agency', 'test-version');

			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				alertId: 'alert-1',
				agencyId: 'test-agency',
				tsMs: 4000000,
				cause: 'TECHNICAL_PROBLEM',
				effect: 'SIGNIFICANT_DELAYS',
				headerText: 'Service Alert',
				descriptionText: 'Delays expected',
				activePeriodStart: 5000000,
				activePeriodEnd: 6000000,
				gtfsVersionId: 'test-version',
			});
		});
	});
});
