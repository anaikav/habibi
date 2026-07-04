// tools.js
// ---------
// The catalogue of tools the LLM can call (search_locations, estimate_fare,
// propose_booking, request_ride, etc.) plus the dispatcher `executeTool` that
// actually runs them.
//
// The confirmation gate lives here: request_ride refuses to run unless the
// human has explicitly clicked "Confirm" on a matching propose_booking. This
// is deterministic JS, not a prompt instruction — that's the point (spec §4).
//
// Filled in during Phase 2.
