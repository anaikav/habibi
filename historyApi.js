// historyApi.js
// --------------
// Pretend past ride history + a preference store. The point of the seeded
// history is that it HIDES a commute habit: nine of the fourteen rides are
// Dubai Marina → DIFC Gate Village on weekday mornings between 08:22 and 08:47.
// The pattern miner is meant to find it.
//
// Preferences are things the user has *told* Habibi directly (e.g. "I prefer
// quiet rides") — different from patterns, which are *inferred* from history.
// Both live only in memory: no localStorage, no server, gone on refresh.

(function () {
  'use strict';

  // ----- Seeded history ---------------------------------------------------
  //
  // Times are local Dubai time. `at` is a full ISO datetime string so the
  // pattern miner can pull the day-of-week and hour/minute out cleanly.
  //
  // Nine weekday-morning commutes to DIFC:
  const COMMUTE_RIDES = [
    { at: '2026-07-03T08:22:00', hh: '08:22' }, // Fri
    { at: '2026-07-02T08:25:00', hh: '08:25' }, // Thu
    { at: '2026-07-01T08:28:00', hh: '08:28' }, // Wed
    { at: '2026-06-30T08:31:00', hh: '08:31' }, // Tue
    { at: '2026-06-29T08:35:00', hh: '08:35' }, // Mon
    { at: '2026-06-26T08:38:00', hh: '08:38' }, // Fri
    { at: '2026-06-25T08:41:00', hh: '08:41' }, // Thu
    { at: '2026-06-24T08:44:00', hh: '08:44' }, // Wed
    { at: '2026-06-23T08:47:00', hh: '08:47' }, // Tue
  ].map((r, i) => ({
    rideId: `ride_seed_${String(i + 1).padStart(2, '0')}`,
    at: r.at,
    pickup: 'Dubai Marina',
    dropoff: 'DIFC Gate Village',
    type: 'MoiGo',
    fareAED: 72,
    status: 'completed',
  }));

  // Five scattered rides — weekends, evenings, an airport run, a restaurant.
  const SCATTERED_RIDES = [
    {
      rideId: 'ride_seed_10',
      at: '2026-07-04T14:15:00', // Sat afternoon
      pickup: 'Palm Jumeirah',
      dropoff: 'Dubai Mall',
      type: 'MoiXL',
      fareAED: 110,
      status: 'completed',
    },
    {
      rideId: 'ride_seed_11',
      at: '2026-07-03T22:30:00', // Fri late night
      pickup: 'JBR Beach',
      dropoff: 'Ravi Restaurant',
      type: 'MoiGo',
      fareAED: 68,
      status: 'completed',
    },
    {
      rideId: 'ride_seed_12',
      at: '2026-06-28T07:20:00', // Sun early morning
      pickup: 'Dubai Marina',
      dropoff: 'Dubai International Airport (DXB)',
      type: 'MoiXL',
      fareAED: 140,
      status: 'completed',
    },
    {
      rideId: 'ride_seed_13',
      at: '2026-06-27T19:00:00', // Sat evening
      pickup: 'Dubai Marina',
      dropoff: 'Kite Beach',
      type: 'MoiGo',
      fareAED: 36,
      status: 'completed',
    },
    {
      rideId: 'ride_seed_14',
      at: '2026-06-18T21:00:00', // Thu evening (touristy detour)
      pickup: 'Dubai Mall',
      dropoff: 'Burj Khalifa',
      type: 'MoiLux',
      fareAED: 60,
      status: 'completed',
    },
  ];

  // The mutable state: seed once, allow addRide to append.
  let history = [...COMMUTE_RIDES, ...SCATTERED_RIDES];

  // Preferences — a small flat object of things the user has stated.
  let preferences = {};

  // Patterns the user has explicitly deleted via the memory screen. The miner
  // will be taught to skip these. For phase 1 we just track the set; phase 4
  // will wire it into the miner.
  let ignoredPatternKeys = new Set();

  // ----- Public API -------------------------------------------------------

  function getRideHistory() {
    // Defensive copy so nothing outside can mutate our list.
    return history.map((r) => ({ ...r }));
  }

  function addRide(ride) {
    if (!ride || !ride.rideId) {
      console.warn('[historyApi] addRide: missing rideId, ignoring');
      return;
    }
    history.push({ ...ride });
  }

  function getPreferences() {
    return { ...preferences };
  }

  function setPreference(key, value) {
    if (typeof key !== 'string' || !key) return;
    preferences[key] = value;
  }

  function deletePreference(key) {
    delete preferences[key];
  }

  function getIgnoredPatternKeys() {
    return new Set(ignoredPatternKeys);
  }

  function ignorePatternKey(key) {
    ignoredPatternKeys.add(key);
  }

  // Reset everything to seed state — the demo panel's "Reset demo data" button
  // will call this.
  function resetAll() {
    history = [...COMMUTE_RIDES, ...SCATTERED_RIDES];
    preferences = {};
    ignoredPatternKeys = new Set();
  }

  window.habibi = window.habibi || {};
  window.habibi.historyApi = {
    getRideHistory,
    addRide,
    getPreferences,
    setPreference,
    deletePreference,
    getIgnoredPatternKeys,
    ignorePatternKey,
    resetAll,
  };
})();
