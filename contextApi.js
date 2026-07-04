// contextApi.js
// --------------
// A pretend "what's happening in Dubai right now" feed: prayer times, one event
// (Coldplay at Etihad Park), the weather forecast, and whether surge pricing is
// active. The demo panel toggles surge/rain; everything else is derived from the
// simulated clock.
//
// Critical rule (spec §3): the LLM must only cite a surge cause when the
// simulated time actually overlaps an event or is within ±45 min of a prayer.
// If surge is on with no overlap, linkedCauseIds is EMPTY. This is what stops
// the model from inventing a reason.
//
// Filled in during Phase 1.
