// clock.js
// ---------
// The "simulated clock" — a single dial that controls what time the whole app
// thinks it is. Every other module must read time from here (via getSimTime())
// and never call `new Date()` directly. That way one preset button ("jump to
// Mon 8:30 AM") re-evaluates every trigger in the app in a consistent way.
//
// The ONE deliberate exception (spec §1) is moiApi's ride-status progression,
// which uses real elapsed seconds so a booked ride visibly progresses during a
// live demo regardless of what the simulated clock says.

(function () {
  'use strict';

  // The current simulated time. Start on a Monday at 8:30 AM so the pattern-
  // detection demo works right after page load without touching anything.
  // (2026-07-06 is a Monday.)
  let simTime = new Date('2026-07-06T08:30:00');

  // Anything that wants to know when the clock jumps registers a callback.
  const listeners = new Set();

  function getSimTime() {
    // Return a fresh Date so callers can't accidentally mutate our internal one.
    return new Date(simTime);
  }

  function setSimTime(input) {
    const next = input instanceof Date ? new Date(input) : new Date(input);
    if (isNaN(next.getTime())) {
      console.warn('[clock] ignoring invalid time:', input);
      return;
    }
    simTime = next;
    // Tell everyone who cares that the clock moved.
    listeners.forEach((fn) => {
      try { fn(getSimTime()); }
      catch (e) { console.error('[clock] listener threw:', e); }
    });
  }

  function onSimTimeChange(fn) {
    listeners.add(fn);
    // Return an "unsubscribe" function so callers can detach cleanly later.
    return () => listeners.delete(fn);
  }

  // Named presets for the demo panel. Values are ISO local strings so what you
  // read is what you get — no timezone surprises.
  // 2026-07-06 = Monday, 2026-07-10 = Friday, 2026-07-11 = Saturday.
  const PRESETS = {
    mon_735am: '2026-07-06T07:35:00',
    mon_830am: '2026-07-06T08:30:00',
    fri_600pm: '2026-07-10T18:00:00',
    sat_730pm: '2026-07-11T19:30:00',
  };

  // Publish on the shared namespace so the console + other modules can find it.
  window.habibi = window.habibi || {};
  window.habibi.clock = { getSimTime, setSimTime, onSimTimeChange, PRESETS };
})();
