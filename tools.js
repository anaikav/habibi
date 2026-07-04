// tools.js
// ---------
// The catalogue of tools the LLM can call and the dispatcher that actually
// runs them. Also home of two very deliberate pieces of *deterministic* code:
//
//   (1) The confirmation gate. The model calls `propose_booking` first;
//       nothing is booked until the user has clicked Confirm. The gate is
//       enforced by plain JS — even if the model calls `request_ride`
//       directly (or is told to "skip the confirmation"), it gets
//       CONFIRMATION_REQUIRED back and has to try again the right way.
//
//   (2) The airport code hook. Immediately after a *successful* `request_ride`
//       to Dubai International Airport (DXB), we fire an internal event that
//       agent.js will translate into an invisible [SYSTEM EVENT: ...] line
//       appended to the next API call. The model then naturally offers to
//       schedule a return pickup — but the *trigger* is code, not vibes.
//
// The LLM never sees or supplies idempotency keys; we mint one per approved
// proposal so retries can't book twice.

(function () {
  'use strict';

  // ----- Tool schemas -------------------------------------------------
  //
  // Anthropic tool schemas are JSONSchema for `input_schema`. Descriptions
  // are how we teach the model what each tool is for; they matter almost as
  // much as the system prompt.

  const TOOL_SCHEMAS = [
    {
      name: 'search_locations',
      description:
        'Search among the 12 curated Dubai places (Dubai Marina, DIFC Gate Village, Dubai Mall, Kite Beach, Burj Khalifa, Palm Jumeirah, JBR Beach, Global Village, Al Fahidi Historical District, Etihad Park, Ravi Restaurant, Dubai International Airport (DXB)). Provide a query, a category, or both.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'free-text search over name, tags, and description' },
          category: {
            type: 'string',
            description: 'one of: transport, neighborhood, business, shopping, beach, landmark, entertainment, culture, venue, restaurant',
          },
        },
      },
    },
    {
      name: 'get_location_details',
      description: 'Get full details for a single location by its id (e.g. "loc_kite").',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'estimate_fare',
      description:
        'Estimate MoiGo / MoiXL / MoiLux fares in AED between two Dubai places. Use the EXACT names returned by search_locations (e.g. "Dubai Marina", not "Marina").',
      input_schema: {
        type: 'object',
        properties: {
          pickup: { type: 'string' },
          dropoff: { type: 'string' },
        },
        required: ['pickup', 'dropoff'],
      },
    },
    {
      name: 'propose_booking',
      description:
        'Propose a specific ride to the user with pickup, dropoff, ride type, and fare. This SHOWS a native Confirm button. You MUST call this before request_ride and then STOP — wait for the user to click Confirm (you will see "[USER CLICKED CONFIRM]"). Do not call request_ride in the same turn.',
      input_schema: {
        type: 'object',
        properties: {
          pickup: { type: 'string' },
          dropoff: { type: 'string' },
          type: { type: 'string', enum: ['MoiGo', 'MoiXL', 'MoiLux'] },
          fareAED: { type: 'number' },
        },
        required: ['pickup', 'dropoff', 'type', 'fareAED'],
      },
    },
    {
      name: 'request_ride',
      description:
        'Actually book the ride. Only call this AFTER the user has clicked Confirm. Pickup, dropoff, and type MUST match the propose_booking the user approved.',
      input_schema: {
        type: 'object',
        properties: {
          pickup: { type: 'string' },
          dropoff: { type: 'string' },
          type: { type: 'string', enum: ['MoiGo', 'MoiXL', 'MoiLux'] },
        },
        required: ['pickup', 'dropoff', 'type'],
      },
    },
    {
      name: 'get_ride_status',
      description: 'Check the current status of a ride by rideId.',
      input_schema: {
        type: 'object',
        properties: { rideId: { type: 'string' } },
        required: ['rideId'],
      },
    },
    {
      name: 'cancel_ride',
      description: 'Cancel a ride by rideId. Free before the driver arrives; small fee otherwise.',
      input_schema: {
        type: 'object',
        properties: { rideId: { type: 'string' } },
        required: ['rideId'],
      },
    },
    {
      name: 'get_saved_patterns',
      description: 'Get the current inferred ride patterns for the user (e.g., a weekday commute).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'update_preference',
      description: 'Save a stated preference the user has told you (e.g. update_preference("ride_style", "quiet")).',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'delete_preference',
      description: 'Forget a previously stated preference by key.',
      input_schema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
    {
      name: 'get_city_context',
      description:
        'Get the current Dubai context: prayer times, events, weather forecast, and whether surge pricing is active. IMPORTANT: if surge.active is true but linkedCauseIds is EMPTY, you must say prices are "unusually busy" — do NOT invent an event or reason.',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  // ----- Confirmation gate state -------------------------------------

  let pendingProposal = null;   // most recent propose_booking, waiting on user
  let approvedProposal = null;  // user has clicked Confirm; request_ride may run

  // Small event bus. app.js / agent.js register listeners; tools fire them.
  const listeners = { proposal: new Set(), chip: new Set(), systemEvent: new Set() };
  function on(name, fn) {
    if (!listeners[name]) return () => {};
    listeners[name].add(fn);
    return () => listeners[name].delete(fn);
  }
  function fire(name, payload) {
    for (const fn of listeners[name] || []) {
      try { fn(payload); } catch (e) { console.error('[tools] listener threw:', e); }
    }
  }

  function getPendingProposal()  { return pendingProposal ? { ...pendingProposal } : null; }
  function getApprovedProposal() { return approvedProposal ? { ...approvedProposal } : null; }

  // "The user clicked Confirm" — flips pending → approved. Called by app.js
  // when the button is tapped, or from the console for testing.
  function confirmPendingProposal() {
    if (!pendingProposal) return null;
    approvedProposal = { ...pendingProposal };
    pendingProposal = null;
    return { ...approvedProposal };
  }
  function clearProposals() { pendingProposal = null; approvedProposal = null; }

  // ----- Helpers ------------------------------------------------------

  function makeIdempotencyKey() {
    return 'idem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ----- Tool handlers ------------------------------------------------

  async function tool_search_locations({ query, category }) {
    const locs = window.habibi.locations || [];
    const q = (query || '').toLowerCase().trim();
    const c = (category || '').toLowerCase().trim();
    let out = locs;
    if (c) out = out.filter((l) => l.category.toLowerCase() === c);
    if (q) {
      out = out.filter((l) => {
        const hay = (l.name + ' ' + l.description + ' ' + (l.tags || []).join(' ')).toLowerCase();
        return hay.includes(q);
      });
    }
    // Keep the payload small — full details are available via get_location_details.
    return out.map((l) => ({ id: l.id, name: l.name, category: l.category, tags: l.tags }));
  }

  async function tool_get_location_details({ id }) {
    const loc = (window.habibi.locations || []).find((l) => l.id === id);
    return loc ? { ...loc } : { error: 'LOCATION_NOT_FOUND', id };
  }

  async function tool_estimate_fare({ pickup, dropoff }) {
    return await window.habibi.moiApi.estimateFare(pickup, dropoff);
  }

  async function tool_propose_booking({ pickup, dropoff, type, fareAED }) {
    pendingProposal = { pickup, dropoff, type, fareAED, at: Date.now() };
    // Tell app.js to render the Confirm button.
    fire('proposal', { ...pendingProposal });
    return {
      status: 'awaiting_user_confirmation',
      pickup, dropoff, type, fareAED,
      note: "STOP — do not call request_ride until you see '[USER CLICKED CONFIRM]'. A native Confirm button has been shown to the user.",
    };
  }

  async function tool_request_ride({ pickup, dropoff, type }) {
    // Gate (a): no approved proposal → reject.
    if (!approvedProposal) {
      return {
        error: 'CONFIRMATION_REQUIRED',
        message: 'You must call propose_booking first and wait for the user to click Confirm.',
      };
    }
    // Gate (b): parameters must match the approved proposal (no bait-and-switch).
    const ap = approvedProposal;
    if (ap.pickup !== pickup || ap.dropoff !== dropoff || ap.type !== type) {
      approvedProposal = null; // burn the approval regardless
      return {
        error: 'MISMATCH_WITH_PROPOSAL',
        message: 'The pickup, dropoff, or type does not match the approved proposal.',
        approved: { pickup: ap.pickup, dropoff: ap.dropoff, type: ap.type },
        attempted: { pickup, dropoff, type },
      };
    }
    // Gate (c): mint the idempotency key ourselves, then call moi.
    const key = makeIdempotencyKey();
    const result = await window.habibi.moiApi.requestRide(pickup, dropoff, type, key);
    approvedProposal = null; // always burn approval, whether success or failure

    // Airport hook — only on success, only to DXB, fires once per ride.
    if (!result.error && dropoff === 'Dubai International Airport (DXB)') {
      fire(
        'systemEvent',
        '[SYSTEM EVENT: user booked an airport ride. Offer to schedule a return pickup for their arrival back.]'
      );
    }
    return result;
  }

  async function tool_get_ride_status({ rideId }) {
    return await window.habibi.moiApi.getRideStatus(rideId);
  }

  async function tool_cancel_ride({ rideId }) {
    return await window.habibi.moiApi.cancelRide(rideId);
  }

  async function tool_get_saved_patterns() {
    const history = window.habibi.historyApi.getRideHistory();
    const ignoredKeys = window.habibi.historyApi.getIgnoredPatternKeys();
    return window.habibi.patternMiner.minePatterns(history, { ignoredKeys });
  }

  async function tool_update_preference({ key, value }) {
    window.habibi.historyApi.setPreference(key, value);
    return { ok: true, preferences: window.habibi.historyApi.getPreferences() };
  }

  async function tool_delete_preference({ key }) {
    window.habibi.historyApi.deletePreference(key);
    return { ok: true, preferences: window.habibi.historyApi.getPreferences() };
  }

  async function tool_get_city_context() {
    const simTime = window.habibi.clock.getSimTime();
    return window.habibi.contextApi.getCityContext(simTime);
  }

  const HANDLERS = {
    search_locations:    tool_search_locations,
    get_location_details: tool_get_location_details,
    estimate_fare:       tool_estimate_fare,
    propose_booking:     tool_propose_booking,
    request_ride:        tool_request_ride,
    get_ride_status:     tool_get_ride_status,
    cancel_ride:         tool_cancel_ride,
    get_saved_patterns:  tool_get_saved_patterns,
    update_preference:   tool_update_preference,
    delete_preference:   tool_delete_preference,
    get_city_context:    tool_get_city_context,
  };

  async function executeTool(name, input) {
    const handler = HANDLERS[name];
    if (!handler) {
      const result = { error: 'UNKNOWN_TOOL', tool: name };
      fire('chip', { name, input, result });
      return result;
    }
    try {
      const result = await handler(input || {});
      fire('chip', { name, input, result });
      return result;
    } catch (e) {
      console.error('[tools] executeTool threw for', name, e);
      const result = { error: 'TOOL_EXECUTION_ERROR', message: String(e && e.message || e) };
      fire('chip', { name, input, result });
      return result;
    }
  }

  window.habibi = window.habibi || {};
  window.habibi.tools = {
    TOOL_SCHEMAS,
    executeTool,
    getPendingProposal,
    getApprovedProposal,
    confirmPendingProposal,
    clearProposals,
    onProposal:   (fn) => on('proposal', fn),
    onChip:       (fn) => on('chip', fn),
    onSystemEvent:(fn) => on('systemEvent', fn),
  };
})();
