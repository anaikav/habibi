// app.js
// -------
// The UI glue and top-level bootstrap.
//
// Phase 1 job: on page load, fetch locations.json into memory, run the pattern
// miner over the seeded history, and log the mining result to the console —
// per spec §3, the human should SEE the mining result.
//
// The real chat/UI arrives in Phase 3; this file will grow a lot then.

(async function () {
  'use strict';

  window.habibi = window.habibi || {};

  // ----- Load locations.json --------------------------------------------
  //
  // Load once at startup and cache on the namespace. If we're opened via
  // file:// (no HTTP server) the fetch will fail — log a helpful hint.

  try {
    const res = await fetch('locations.json');
    window.habibi.locations = await res.json();
    console.log('[app] loaded', window.habibi.locations.length, 'locations');
  } catch (err) {
    console.warn(
      '[app] could not load locations.json — are you opening index.html directly?\n' +
      'Serve the folder over HTTP (see README): python3 -m http.server 8000'
    );
    window.habibi.locations = [];
  }

  // ----- Run the pattern miner ------------------------------------------
  //
  // Spec §3 says the miner runs on app load AND after each completed ride.
  // We wrap it in a function so future code can call it again cheaply.

  function runMiner() {
    const history = window.habibi.historyApi.getRideHistory();
    const ignoredKeys = window.habibi.historyApi.getIgnoredPatternKeys();
    const patterns = window.habibi.patternMiner.minePatterns(history, { ignoredKeys });
    console.log('[patternMiner] mined patterns:', patterns);
    window.habibi.patterns = patterns; // cached for the console + future UI
    return patterns;
  }

  window.habibi.runMiner = runMiner;
  runMiner();

  console.log('[app] Phase 1 mocks ready. Try `habibi.moiApi`, `habibi.contextApi`, `habibi.clock`, `habibi.historyApi`, `habibi.patternMiner`.');
})();
