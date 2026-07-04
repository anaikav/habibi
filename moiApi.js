// moiApi.js
// ----------
// The pretend "Moi" ride-hailing backend. In-memory only. Everything is async
// with 400–1200ms of fake latency so the future UI has something realistic to
// wait on. See spec §3 for the exact contract.
//
// Two subtle rules worth calling out:
//
// (1) Ride STATUS is derived from REAL elapsed seconds since booking (not the
//     simulated clock). This is the one deliberate exception in the whole app,
//     so a live demo can watch a ride visibly progress even after the presenter
//     has jumped the simulated clock forward or backward.
//
// (2) `idempotencyKey` guarantees "same key in → same ride out". The LLM never
//     supplies this key; tools.js will generate one per confirmed proposal so
//     even a retried request_ride call never books twice.

(function () {
  'use strict';

  // ----- Fake latency -----------------------------------------------------

  function fakeLatency() {
    const ms = 400 + Math.random() * 800; // 400–1200 ms
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ----- Distance table --------------------------------------------------
  //
  // Distances in km. Keys use the exact place NAMES (not ids) so callers can
  // stay in plain English. Lookup is direction-independent: we try "A|B" then
  // "B|A", then fall back to 12 km — never throw on an unknown pair.

  const DISTANCE_KM = {
    // From DXB
    'Dubai International Airport (DXB)|Dubai Marina': 32,
    'Dubai International Airport (DXB)|DIFC Gate Village': 12,
    'Dubai International Airport (DXB)|Dubai Mall': 15,
    'Dubai International Airport (DXB)|Kite Beach': 22,
    'Dubai International Airport (DXB)|Burj Khalifa': 15,
    'Dubai International Airport (DXB)|Palm Jumeirah': 30,
    'Dubai International Airport (DXB)|JBR Beach': 32,
    'Dubai International Airport (DXB)|Global Village': 25,
    'Dubai International Airport (DXB)|Al Fahidi Historical District': 10,
    'Dubai International Airport (DXB)|Etihad Park': 30,
    'Dubai International Airport (DXB)|Ravi Restaurant': 12,

    // From Marina
    'Dubai Marina|DIFC Gate Village': 20,
    'Dubai Marina|Dubai Mall': 22,
    'Dubai Marina|Kite Beach': 12,
    'Dubai Marina|Burj Khalifa': 22,
    'Dubai Marina|Palm Jumeirah': 6,
    'Dubai Marina|JBR Beach': 3,
    'Dubai Marina|Global Village': 32,
    'Dubai Marina|Al Fahidi Historical District': 25,
    'Dubai Marina|Etihad Park': 10,
    'Dubai Marina|Ravi Restaurant': 22,

    // From DIFC
    'DIFC Gate Village|Dubai Mall': 3,
    'DIFC Gate Village|Kite Beach': 12,
    'DIFC Gate Village|Burj Khalifa': 3,
    'DIFC Gate Village|Palm Jumeirah': 20,
    'DIFC Gate Village|JBR Beach': 22,
    'DIFC Gate Village|Global Village': 22,
    'DIFC Gate Village|Al Fahidi Historical District': 8,
    'DIFC Gate Village|Etihad Park': 20,
    'DIFC Gate Village|Ravi Restaurant': 8,

    // From Mall
    'Dubai Mall|Kite Beach': 15,
    'Dubai Mall|Burj Khalifa': 1,
    'Dubai Mall|Palm Jumeirah': 22,
    'Dubai Mall|JBR Beach': 22,
    'Dubai Mall|Global Village': 20,
    'Dubai Mall|Al Fahidi Historical District': 10,
    'Dubai Mall|Etihad Park': 22,
    'Dubai Mall|Ravi Restaurant': 12,

    // From Kite Beach
    'Kite Beach|Burj Khalifa': 12,
    'Kite Beach|Palm Jumeirah': 10,
    'Kite Beach|JBR Beach': 10,
    'Kite Beach|Global Village': 25,
    'Kite Beach|Al Fahidi Historical District': 15,
    'Kite Beach|Etihad Park': 15,
    'Kite Beach|Ravi Restaurant': 12,

    // From Burj Khalifa
    'Burj Khalifa|Palm Jumeirah': 25,
    'Burj Khalifa|JBR Beach': 22,
    'Burj Khalifa|Global Village': 22,
    'Burj Khalifa|Al Fahidi Historical District': 8,
    'Burj Khalifa|Etihad Park': 22,
    'Burj Khalifa|Ravi Restaurant': 10,

    // From Palm Jumeirah
    'Palm Jumeirah|JBR Beach': 5,
    'Palm Jumeirah|Global Village': 32,
    'Palm Jumeirah|Al Fahidi Historical District': 22,
    'Palm Jumeirah|Etihad Park': 12,
    'Palm Jumeirah|Ravi Restaurant': 22,

    // From JBR
    'JBR Beach|Global Village': 32,
    'JBR Beach|Al Fahidi Historical District': 25,
    'JBR Beach|Etihad Park': 10,
    'JBR Beach|Ravi Restaurant': 22,

    // From Global Village
    'Global Village|Al Fahidi Historical District': 22,
    'Global Village|Etihad Park': 32,
    'Global Village|Ravi Restaurant': 25,

    // From Al Fahidi
    'Al Fahidi Historical District|Etihad Park': 25,
    'Al Fahidi Historical District|Ravi Restaurant': 8,

    // From Etihad Park
    'Etihad Park|Ravi Restaurant': 25,
  };

  const DEFAULT_KM = 12;

  function distanceKm(a, b) {
    return DISTANCE_KM[`${a}|${b}`] ?? DISTANCE_KM[`${b}|${a}`] ?? DEFAULT_KM;
  }

  // ----- Pricing ----------------------------------------------------------
  //
  // MoiGo is the baseline (fare = 12 base + 3/km). MoiXL is 1.4× the base
  // fare, MoiLux is 2.0×. Surge multiplies all fares by 1.6.

  const TYPE_MULT = { MoiGo: 1.0, MoiXL: 1.4, MoiLux: 2.0 };
  const TYPE_ETA_BASE = { MoiGo: 4, MoiXL: 6, MoiLux: 8 }; // minutes to pickup

  function baseFare(km) {
    return 12 + 3 * km;
  }

  function currentSurgeMultiplier() {
    // moiApi asks contextApi so both stay in sync with the demo toggle.
    const ctx = window.habibi?.contextApi;
    return ctx?.isSurgeActive?.() ? 1.6 : 1.0;
  }

  async function estimateFare(pickup, dropoff) {
    await fakeLatency();
    const km = distanceKm(pickup, dropoff);
    const surge = currentSurgeMultiplier();
    const base = baseFare(km);

    const options = Object.keys(TYPE_MULT).map((type) => ({
      type,
      fareAED: Math.round(base * TYPE_MULT[type] * surge),
      etaMin: TYPE_ETA_BASE[type] + (surge > 1 ? 2 : 0),
    }));

    return { options, surgeMultiplier: surge };
  }

  // ----- Rides state ------------------------------------------------------

  const rides = new Map();         // rideId → ride object
  const byIdempotency = new Map(); // idempotencyKey → rideId

  const DRIVER_POOL = [
    { name: 'Rashid',  rating: 4.9, car: 'Toyota Camry',   plate: 'D 12345' },
    { name: 'Anwar',   rating: 4.8, car: 'Nissan Sunny',   plate: 'F 67890' },
    { name: 'Karim',   rating: 4.9, car: 'Hyundai Sonata', plate: 'K 24680' },
    { name: 'Salim',   rating: 4.7, car: 'Kia Optima',     plate: 'B 13579' },
    { name: 'Fatima',  rating: 5.0, car: 'Toyota Prius',   plate: 'N 99887' },
  ];

  function pickDriver() {
    return { ...DRIVER_POOL[Math.floor(Math.random() * DRIVER_POOL.length)] };
  }

  function newRideId() {
    return 'ride_' + Math.random().toString(36).slice(2, 10);
  }

  function fmtISO(dt) {
    // Local ISO without timezone suffix — matches how we seeded history.
    const p = (n) => String(n).padStart(2, '0');
    return (
      dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
      'T' + p(dt.getHours()) + ':' + p(dt.getMinutes()) + ':' + p(dt.getSeconds())
    );
  }

  async function requestRide(pickup, dropoff, type, idempotencyKey) {
    await fakeLatency();

    // Idempotency: same key returns the same ride, no matter how many times
    // the caller retries. Prevents double-bookings on flaky networks.
    if (idempotencyKey && byIdempotency.has(idempotencyKey)) {
      const existingId = byIdempotency.get(idempotencyKey);
      return { ...rides.get(existingId) };
    }

    // Rain-check: 15% "no drivers", but 0% when surge is on (surge means
    // drivers exist, they just cost more).
    const surgeOn = currentSurgeMultiplier() > 1;
    if (!surgeOn && Math.random() < 0.15) {
      return { error: 'NO_DRIVERS_AVAILABLE' };
    }

    const km = distanceKm(pickup, dropoff);
    const surge = currentSurgeMultiplier();
    const mult = TYPE_MULT[type] ?? 1.0;
    const fareAED = Math.round(baseFare(km) * mult * surge);

    const simTime = window.habibi?.clock?.getSimTime?.() ?? new Date();

    const ride = {
      rideId: newRideId(),
      status: 'requested',
      pickup,
      dropoff,
      type,
      fareAED,
      driver: pickDriver(),
      bookedAtSimTime: fmtISO(simTime),

      // Internal: real epoch ms used for status derivation. Not part of the
      // documented contract but callers can ignore it.
      _bookedAtRealMs: Date.now(),
    };

    rides.set(ride.rideId, ride);
    if (idempotencyKey) byIdempotency.set(idempotencyKey, ride.rideId);
    return { ...ride };
  }

  // Status is derived, not stored — so it always reflects real elapsed time.
  // If the ride was cancelled, that wins over the time-based progression.
  function deriveStatus(ride) {
    if (ride._cancelled) return 'cancelled';
    const elapsedSec = (Date.now() - ride._bookedAtRealMs) / 1000;
    if (elapsedSec < 5)   return 'requested';
    if (elapsedSec < 15)  return 'driver_assigned';
    if (elapsedSec < 30)  return 'driver_arriving';
    if (elapsedSec < 60)  return 'in_ride';
    return 'completed';
  }

  async function getRideStatus(rideId) {
    await fakeLatency();
    const ride = rides.get(rideId);
    if (!ride) return { error: 'RIDE_NOT_FOUND' };
    return { ...ride, status: deriveStatus(ride) };
  }

  async function cancelRide(rideId) {
    await fakeLatency();
    const ride = rides.get(rideId);
    if (!ride) return { error: 'RIDE_NOT_FOUND' };

    // Free before driver arrives; AED 10 fee after.
    const statusBefore = deriveStatus(ride);
    const feeAED = (statusBefore === 'requested' || statusBefore === 'driver_assigned') ? 0 : 10;

    ride._cancelled = true;
    ride.cancellationFeeAED = feeAED;

    return { rideId, status: 'cancelled', cancellationFeeAED: feeAED };
  }

  // Wipe every ride we've booked and every idempotency mapping. The demo
  // panel's Reset button calls this so the next booking starts from clean.
  function resetRides() {
    rides.clear();
    byIdempotency.clear();
  }

  window.habibi = window.habibi || {};
  window.habibi.moiApi = {
    estimateFare,
    requestRide,
    getRideStatus,
    cancelRide,
    resetRides,
    // exposed for debugging from the console
    _distanceKm: distanceKm,
  };
})();
