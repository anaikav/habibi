// patternMiner.js
// ----------------
// The "data science" of the app. Given a ride history, it looks for recurring
// habits (e.g. "you take Marina → DIFC on weekday mornings, around 8:35 AM").
//
// PURE FUNCTION: same input in → same output out. No network, no clock, no
// randomness. That means it's trivial to test — feed it a list of rides,
// compare the output. This module is what makes the L2 "Your usual?" card
// possible without any AI.
//
// Qualification rules (spec §3):
//   1. Same (pickup, dropoff) pair appears ≥ 5 times.
//   2. ≥ 80% of those rides fall on weekdays (Mon–Fri).
//   3. Ride times spread within ±30 min of the group's median.
//
// Confidence formula (chosen to yield 0.82 for the seeded commute):
//   confidence = 0.5 · (group_count / total_history) + 0.5 · weekday_fraction

(function () {
  'use strict';

  // "515" → "08:35". Small helper used to format the window.
  function fmtHHMM(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Round to the nearest 5-minute mark — makes the "window" read cleanly.
  const roundTo5 = (m) => Math.round(m / 5) * 5;

  function minePatterns(history, opts) {
    const ignoredKeys = (opts && opts.ignoredKeys instanceof Set) ? opts.ignoredKeys : new Set();
    const total = history.length;
    if (total === 0) return [];

    // 1. Group rides by pickup+dropoff.
    const groups = new Map();
    for (const r of history) {
      const key = r.pickup + ' → ' + r.dropoff;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    const patterns = [];
    let idx = 1;

    for (const [key, rides] of groups) {
      if (ignoredKeys.has(key)) continue;
      if (rides.length < 5) continue;

      // 2. Weekday fraction. In JS, getDay() returns 0=Sun…6=Sat, so 1..5 = Mon–Fri.
      const weekdayCount = rides.filter((r) => {
        const dow = new Date(r.at).getDay();
        return dow >= 1 && dow <= 5;
      }).length;
      const weekdayFrac = weekdayCount / rides.length;
      if (weekdayFrac < 0.8) continue;

      // 3. Time spread. Convert to minutes-since-midnight, sort, take the
      //    middle value as the median; require every ride within ±30 min.
      const minutes = rides
        .map((r) => { const d = new Date(r.at); return d.getHours() * 60 + d.getMinutes(); })
        .sort((a, b) => a - b);
      const median = minutes[Math.floor(minutes.length / 2)];
      const maxDeviation = Math.max(...minutes.map((m) => Math.abs(m - median)));
      if (maxDeviation > 30) continue;

      // Most common ride type in the group wins.
      const typeCounts = {};
      for (const r of rides) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
      const rideType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];

      const windowStart = roundTo5(median - 20);
      const windowEnd = roundTo5(median + 20);

      const confidence =
        Math.round((0.5 * rides.length / total + 0.5 * weekdayFrac) * 100) / 100;

      patterns.push({
        id: 'pat_' + idx++,
        key,                                    // used to match against the ignore list
        pickup: rides[0].pickup,
        dropoff: rides[0].dropoff,
        window: fmtHHMM(windowStart) + '–' + fmtHHMM(windowEnd),
        windowStartMin: windowStart,            // handy for the L2 trigger check
        windowEndMin: windowEnd,
        days: 'weekdays',
        rideType,
        confidence,
        evidence: rides.length + ' of last ' + total + ' rides',
      });
    }

    return patterns;
  }

  window.habibi = window.habibi || {};
  window.habibi.patternMiner = { minePatterns };
})();
