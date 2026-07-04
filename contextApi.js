// contextApi.js
// --------------
// A pretend "what's happening in Dubai" feed. The demo control panel flips two
// toggles (surge on/off, rain forecast on/off); everything else is derived from
// the simulated clock passed in from clock.js.
//
// The critical rule (spec §3): `surge.linkedCauseIds` is populated ONLY when
// the simulated time actually overlaps an event window OR is within ±45 min of
// a prayer. If surge is toggled on at a time with no overlap, the array stays
// empty — and the assistant is instructed to say "unusually busy" rather than
// invent a reason. That empty list is the guardrail.

(function () {
  'use strict';

  // Demo panel state. Two booleans, in memory only.
  let surgeOn = false;
  let rainOn = false;

  // ----- Static data ------------------------------------------------------

  // Prayer times for the demo day. Real times shift every day; for a one-day
  // demo one fixed set is enough. Maghrib matches the spec (§3) exactly.
  const PRAYER_TIMES = {
    fajr:    '05:04',
    dhuhr:   '12:29',
    asr:     '15:53',
    maghrib: '18:58',
    isha:    '20:28',
  };

  // The event. `runsDaily: true` means "pretend this is on every night" so the
  // demo works no matter what date the simulated clock lands on.
  const EVENTS = [
    {
      id: 'evt_1',
      name: 'Coldplay concert',
      venue: 'Etihad Park',
      start: '19:00',
      end:   '23:00',
      runsDaily: true,
    },
  ];

  // ----- Time helpers -----------------------------------------------------

  // "HH:MM" → minutes since midnight. Easier than juggling Date objects.
  function hhmmToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  function simTimeToMinutes(dt) {
    return dt.getHours() * 60 + dt.getMinutes();
  }

  // True if `now` is inside the [start, end] window on the same day.
  function isWithinWindow(nowMin, startHHMM, endHHMM) {
    const s = hhmmToMinutes(startHHMM);
    const e = hhmmToMinutes(endHHMM);
    return nowMin >= s && nowMin <= e;
  }

  // Absolute minutes between `now` and a prayer time (both same-day).
  function minutesFromPrayer(nowMin, prayerHHMM) {
    return Math.abs(nowMin - hhmmToMinutes(prayerHHMM));
  }

  // ----- Main function ----------------------------------------------------

  function getCityContext(simTime) {
    const nowMin = simTimeToMinutes(simTime);

    // Figure out which causes actually overlap RIGHT NOW.
    const linkedCauseIds = [];

    for (const ev of EVENTS) {
      if (isWithinWindow(nowMin, ev.start, ev.end)) {
        linkedCauseIds.push(ev.id);
      }
    }

    for (const [name, time] of Object.entries(PRAYER_TIMES)) {
      if (minutesFromPrayer(nowMin, time) <= 45) {
        linkedCauseIds.push(`prayer_${name}`);
      }
    }

    return {
      prayerTimes: { ...PRAYER_TIMES },
      events: EVENTS.map((e) => ({ ...e })),
      weather: {
        now: 'clear',
        // Spec §6 says "keep it simple" — rain is always the same window today.
        forecast: rainOn ? 'rain 08:00–10:00 today' : 'clear',
      },
      surge: {
        active: surgeOn,
        multiplier: 1.6,
        // The heart of the groundedness rule: if the user just flipped surge
        // on at 3pm on a Monday, this list is empty.
        linkedCauseIds,
        expectedEndsBy: '22:00',
      },
    };
  }

  // ----- Demo panel setters ----------------------------------------------

  function setSurge(on)          { surgeOn = !!on; }
  function isSurgeActive()       { return surgeOn; }
  function setRainForecast(on)   { rainOn = !!on; }
  function isRainForecast()      { return rainOn; }

  window.habibi = window.habibi || {};
  window.habibi.contextApi = {
    getCityContext,
    setSurge, isSurgeActive,
    setRainForecast, isRainForecast,
  };
})();
