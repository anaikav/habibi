// app.js
// -------
// The UI glue and top-level bootstrap.
//
// Phase 1 job: load locations.json, run the pattern miner on load, and expose
// everything under `window.habibi` for console testing.
//
// Phase 2 additions:
//   - log proposal events (so you can see the [Confirm booking] moment fire
//     even without a UI yet)
//   - `habibi.app.confirmBooking()` — a one-liner that mimics the eventual
//     button click: it flips the gate to approved AND sends the literal
//     "[USER CLICKED CONFIRM]" user message so the model may book.
//
// The real chat/UI arrives in Phase 3; this file will grow a lot then.

(async function () {
  'use strict';

  window.habibi = window.habibi || {};

  // ----- Load locations.json --------------------------------------------

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

  function runMiner() {
    const history = window.habibi.historyApi.getRideHistory();
    const ignoredKeys = window.habibi.historyApi.getIgnoredPatternKeys();
    const patterns = window.habibi.patternMiner.minePatterns(history, { ignoredKeys });
    console.log('[patternMiner] mined patterns:', patterns);
    window.habibi.patterns = patterns;
    return patterns;
  }
  window.habibi.runMiner = runMiner;
  runMiner();

  // ----- Phase 2 hooks --------------------------------------------------
  //
  // In Phase 3 these will render UI. For now we just log so you can watch
  // the confirmation gate fire from the console.

  if (window.habibi.tools && window.habibi.tools.onProposal) {
    window.habibi.tools.onProposal((p) => {
      console.log(
        '%c[proposal] awaiting Confirm: ' + p.pickup + ' → ' + p.dropoff +
        ' (' + p.type + ', AED ' + p.fareAED + ')',
        'color:#b3541e;font-weight:bold'
      );
      console.log('  → run habibi.app.confirmBooking() to approve and continue.');
    });
    window.habibi.tools.onChip((chip) => {
      // Compact summary — full input/result already logged by agent.js.
      const brief = chip.result?.error ? 'error: ' + chip.result.error : 'ok';
      console.log('%c  chip · ' + chip.name + ' → ' + brief, 'color:#888');
    });
  }

  // One-liner "click Confirm" for the console. Phase 3 will replace this
  // path with a real button, but the underlying two steps stay identical:
  // (1) tools.confirmPendingProposal(), (2) agent.sendUserMessage('[USER CLICKED CONFIRM]').
  async function confirmBooking() {
    const approved = window.habibi.tools.confirmPendingProposal();
    if (!approved) {
      console.warn('[app] no pending proposal to confirm');
      return null;
    }
    console.log('[app] approved:', approved);
    return await window.habibi.agent.sendUserMessage('[USER CLICKED CONFIRM]');
  }

  window.habibi.app = { confirmBooking };

  console.log('[app] ready. Set your key with habibi.agent.setApiKey("sk-ant-...") then habibi.agent.sendUserMessage("...")');
})();
