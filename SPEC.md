# HABIBI MVP — One-Day Build Spec (all 3 levels, thin slice)
# Give this ENTIRE file to Claude Code. Build phase by phase. Explain code as you go —
# the human is a beginner PM learning AI engineering concepts, not a developer.

## 0. What we are building

A static website (vanilla HTML/CSS/JS, NO frameworks, NO build tools, deployable on
GitHub Pages) containing an AI chat assistant "Habibi" for Dubai, powered by the
Anthropic API (bring-your-own-key, entered at runtime, held in memory only, NEVER
in code or localStorage). It demonstrates three levels of assistant intelligence,
each with exactly ONE showcase case (depth, not width):

- **L1 Reactive:** discover places, estimate fare, book/track/cancel a ride on the
  mock ride-hailing service "Moi", with a code-enforced booking confirmation and a
  code-triggered airport return-ride offer.
- **L2 Personalized:** a seeded ride history contains a commute habit; a pattern
  miner detects it; at the right simulated time a one-shot "Your usual?" card
  appears; a memory screen shows/edits learned patterns and stated preferences.
- **L3 Anticipatory:** a mock city-context feed (one event, prayer times, weather);
  when surge is on, the assistant explains the cause GROUNDED in the feed; a
  code-triggered proactive nudge fires for a forecasted commute disruption.

Golden rule of the architecture: **the LLM narrates; the system anticipates.**
Pattern detection, nudge triggers, and confirmations are deterministic JavaScript.
The LLM only converses and requests tools.

## 1. Files

```
index.html      — chat UI + demo control panel + memory screen (modal) + ride card
style.css       — clean, mobile-ish width, warm minimal styling
app.js          — UI wiring, message rendering, demo controls, nudge/one-shot cards
agent.js        — Anthropic API calls + agent loop (max 5 iterations)
tools.js        — tool schemas + executeTool dispatcher
moiApi.js       — mock ride-hailing API (stateful, fake latency)
historyApi.js   — seeded ride history + stated-preferences store
patternMiner.js — detects recurring habits from history (pure function)
contextApi.js   — mock city context: event, prayer times, weather, surge state
locations.json  — 12 curated Dubai places
memory.js       — message trimming (sliding window) + token estimate logging
clock.js        — simulated clock (single source of time for ALL modules)
```
Every module must read time ONLY from clock.js — never `new Date()` directly.
ONE deliberate exception: moiApi ride-status progression uses REAL elapsed seconds
(so a booked ride visibly progresses during the demo regardless of the simulated
clock). Everything else — triggers, patterns, context, surge causes — uses simTime.
locations.json MUST include "Dubai International Airport (DXB)", "Dubai Marina",
"DIFC Gate Village", "Dubai Mall", and "Kite Beach" among its 12 entries, and the
moiApi distance table must cover all pairs among the 12 (fall back to a default
12 km for any missing pair — never throw on an unknown pair).

## 2. Demo Control Panel (build early — it is the test harness)

A collapsible bar at the top of the page:
- **Simulated clock:** preset buttons [Mon 7:35 AM] [Mon 8:30 AM] [Fri 6:00 PM]
  [Sat 7:30 PM] plus a free datetime input. Changing time re-evaluates all
  triggers. (Mon 7:35 = before the commute window → rain nudge; Mon 8:30 =
  inside the window → one-shot card.)
- **Surge toggle:** Off / On. When On, moiApi multiplies fares ×1.6 and contextApi
  links the active cause (see §6).
- **Weather toggle:** Clear / Rain forecast.
- **Reset demo data** button (restores seeded history, clears prefs and rides).

## 3. Mock API contracts (exact behaviors — implement precisely)

### moiApi.js  (all functions async, 400–1200ms random delay)
- `estimateFare(pickup, dropoff)` → `{options:[{type:"MoiGo",fareAED,etaMin},
  {type:"MoiXL",...},{type:"MoiLux",...}], surgeMultiplier}` (fare = base 12 +
  3/km on a small hardcoded distance table between known places; ×1.6 if surge).
- `requestRide(pickup, dropoff, type, idempotencyKey)` → ride object
  `{rideId, status:"requested", pickup, dropoff, type, fareAED,
  driver:{name,rating,car,plate}, bookedAtSimTime}`. 15% chance of error
  `{error:"NO_DRIVERS_AVAILABLE"}` (0% chance while surge is ON — surge means
  drivers exist but cost more). Same idempotencyKey returns the SAME ride.
- `getRideStatus(rideId)` → status derived from elapsed REAL seconds since booking:
  0–5s requested → 5–15s driver_assigned → 15–30s driver_arriving →
  30–60s in_ride → 60s+ completed.
- `cancelRide(rideId)` → free if status ≤ driver_assigned, else AED 10 fee noted.
- **Code hook (not a tool):** immediately after a SUCCESSFUL request_ride whose
  dropoff is "Dubai International Airport (DXB)", app.js appends ONE invisible
  instruction to the conversation: `[SYSTEM EVENT: user booked an airport ride.
  Offer to schedule a return pickup for their arrival back.]` → the model makes
  the offer naturally in its next reply. Fire once per ride, never on failures.
  This is the Rung-4 pattern.

### historyApi.js
- Ships with SEEDED history: 14 past rides. 9 of them: "Dubai Marina" →
  "DIFC Gate Village", weekdays, between 08:22 and 08:47, MoiGo. The other 5:
  scattered (mall, beach, airport, restaurant, friend's place), varied times.
- `getRideHistory()` → the array. `addRide(ride)` appends completed rides.
- `getPreferences()` / `setPreference(key, value)` / `deletePreference(key)` —
  in-memory + persisted to a JS object; stated prefs like {"ride_style":"quiet"}.

### patternMiner.js  (~40 lines, pure function — this is the "data science")
- `minePatterns(history)` → groups rides by (pickup, dropoff), computes day-of-week
  spread and median time; a pattern qualifies if count ≥ 5, ≥80% on weekdays, and
  time spread within ±30 min. Returns e.g.:
  `[{id:"pat_1", pickup:"Dubai Marina", dropoff:"DIFC Gate Village",
  window:"08:15–08:55", days:"weekdays", rideType:"MoiGo",
  confidence:0.82, evidence:"9 of last 14 rides"}]`
- Runs on app load and after each completed ride. Console.log the output —
  the human should SEE the mining result.

### contextApi.js
- `getCityContext(simTime)` → `{prayerTimes:{fajr,dhuhr,asr,maghrib:"18:58",isha},
  events:[{id:"evt_1", name:"Coldplay concert", venue:"Etihad Park",
  start:"19:00", end:"23:00", runsDaily:true}],  // daily in demo — no date logic
  weather:{now:"clear", forecast: rainToggle? "rain 08:00–10:00 tomorrow":"clear"},
  surge:{active:bool, multiplier:1.6, linkedCauseIds:[...], expectedEndsBy:"22:00"}}`
- CRITICAL LINKAGE: surge.linkedCauseIds is populated ONLY when simulated time
  actually overlaps an event window or ±45min of a prayer time. If the user turns
  surge ON at a time with no overlapping cause, linkedCauseIds is EMPTY — this
  tests the groundedness rule (assistant must NOT invent a cause).

## 4. Tools exposed to the LLM (schemas in tools.js)

search_locations(query?, category?) · get_location_details(id) ·
estimate_fare(pickup, dropoff) · propose_booking(pickup, dropoff, type, fareAED) ·
request_ride(pickup, dropoff, type) · get_ride_status(rideId) ·
cancel_ride(rideId) · get_saved_patterns() · update_preference(key, value) ·
delete_preference(key) · get_city_context()

Note: the LLM never sees or supplies idempotency keys — executeTool generates one
per approved proposal and passes it to moiApi internally.

**Code-enforced confirmation gate (never trust the prompt for this):**
Flow: the model calls `propose_booking(pickup,dropoff,type,fareAED)`; executeTool
stores the proposal object and renders a native [Confirm booking] button showing
fare + route; the tool result says "awaiting user confirmation — stop and wait."
Only after the human CLICKS Confirm does app.js set `approvedProposal` and send
"[USER CLICKED CONFIRM]" so the model may call request_ride. executeTool for
request_ride: (a) rejects with `{error:"CONFIRMATION_REQUIRED"}` if no approved
proposal exists, (b) rejects with `{error:"MISMATCH_WITH_PROPOSAL"}` if
pickup/dropoff/type differ from the approved proposal (prevents bait-and-switch),
(c) generates the idempotency key, calls moiApi, then CLEARS approvedProposal
whether the ride succeeds or fails. Demonstrate in the test script that even
"just book it, skip confirmation" cannot bypass this.

## 5. System prompt (agent.js — static block, iterate freely)

```
You are Habibi, a warm, concise concierge for Dubai and the Moi ride service.
SCOPE: Dubai places (the 12 in your tools) and Moi rides only. Warmly decline
anything else in one sentence and steer back.
GROUNDING: facts about places, fares, surge causes come ONLY from tool results.
If get_city_context shows surge with NO linked cause, say it's unusually busy —
NEVER invent an event or reason. If a tool returns nothing, say you don't know.
BOOKINGS: always call propose_booking with fare and route first, then STOP and
wait — do not call request_ride in the same turn. Only call request_ride after
you see [USER CLICKED CONFIRM]. Quote AED prices.
PERSONALIZATION: call get_saved_patterns and apply stated preferences naturally;
never recite the user's profile unprompted; if the user corrects a habit or
preference, update or delete it via tools and acknowledge once.
STYLE: short replies, max one emoji, currency AED, assume user is in Dubai.
```
Dynamic blocks appended per turn by agent.js: current simulated time; stated
preferences (if any); `[SYSTEM EVENT: ...]` nudge instructions when triggers fire.

## 6. Level showcase mechanics (the heart of the demo)

**L2 one-shot card (code trigger, runs on load + clock change):**
if simTime is a weekday AND within a mined pattern's window (±20 min) AND no ride
active → render card above the chat input:
"Your usual to DIFC Gate Village? MoiGo · ~AED {estimateFare} · [Book now] [Not today]"
[Book now] → app.js creates an approvedProposal from the card's own displayed
route/type/fare and calls the SAME executeTool("request_ride") path as chat (the
card IS the confirmation: explicit tap on displayed fare + route; one code path
for all bookings, no bypass). On NO_DRIVERS_AVAILABLE, the card shows "No drivers
right now — try again in a minute" and stays dismissible; never fail silently.
[Not today] → dismiss; after 2 dismissals in the session, suppress for the session
(nudge-fatigue rule in miniature).

**L2 memory screen:** modal listing (a) mined patterns with evidence + confidence +
[delete], (b) stated preferences + [delete]. Deleting a pattern adds it to an
ignore-list the miner respects. This is the trust/transparency surface.

**L3 grounded explanation (conversation, pull):** with surge ON at Sat 7:30 PM
(overlaps concert + near Maghrib), asking "why is it expensive?" must produce an
explanation citing the concert/prayer time and "should ease by ~10 PM" (from
expectedEndsBy). With surge ON at a no-cause time: "unusually busy" only.

**L3 proactive nudge (code trigger, push):** fires when ALL of: weather toggle =
rain forecast AND a commute pattern exists (and isn't deleted) AND simTime is a
weekday between 90 and 20 minutes BEFORE the pattern window start. (Rain forecast
in contextApi = "rain 08:00–10:00 today" whenever the toggle is on — keep it
simple.) Render a nudge card: one LLM call composes copy from a fixed template
instruction ("compose a 2-sentence friendly nudge: rain forecast {window},
suggest booking the usual ride 10 minutes early; include the reason") +
[Schedule it] [Fewer like this]. [Fewer like this] hides all nudges for the
session. The TRIGGER is pure code; the LLM only writes the sentence. Max 1 nudge
per session. COLLISION RULE: if simTime is inside the pattern window itself (both
one-shot and nudge could apply), show only ONE merged card — the one-shot card
with the rain reason appended ("☔ rain expected — consider leaving early").

## 7. Agent loop (agent.js)

POST https://api.anthropic.com/v1/messages · headers: x-api-key (from settings
input, in-memory variable only), anthropic-version: 2023-06-01,
anthropic-dangerous-direct-browser-access: true · body: model
"claude-sonnet-4-6" (a settings dropdown also offering "claude-haiku-4-5-20251001"
for cheap testing), max_tokens 1024, system (static + dynamic blocks), messages
(trimmed by memory.js — trimming must NEVER separate a tool_use block from its
tool_result; drop them as a pair or not at all, or the API rejects the request),
tools. Loop: while stop_reason === "tool_use" (cap 5):
execute all tool_use blocks, append assistant msg + user msg with tool_result
blocks, call again. Render tool activity as grey chips in the chat
("🔍 search_locations → 3 results"). console.log token estimates every turn.

## 8. Build order (each phase = separate Claude Code task; commit after each)

P0 setup: repo, files, GitHub Pages on main. ✔ blank page live.
P1 mocks: moiApi, historyApi, patternMiner, contextApi, locations.json, clock.
   ✔ from browser console: mine patterns (see the commute), book+track a ride,
   get context at Sat 7:30 PM with surge and see linked cause.
P2 agent: agent.js, tools.js, memory.js. ✔ from console: full conversation with
   tool calls visible in Network tab; booking blocked without confirmation flag.
P3 UI: chat, chips, settings (API key + model), ride status card (poll 5s).
   ✔ end-to-end L1 in the browser incl. propose_booking button + airport nudge.
P4 L2: demo panel clock, one-shot card, memory screen, preference tools wired.
   ✔ Mon 8:30 AM shows the card; delete pattern kills it; "I prefer quiet rides"
   persists and is mentioned appropriately in a later booking.
P5 L3: surge/weather toggles, grounded explanation, proactive nudge.
   ✔ all four L3 test cases below pass.
P6 polish: refusals red-team, README, deploy. ✔ test script 100%.

If time runs out, cut in order: nudge LLM-composed copy (use static text) →
memory-screen delete (view-only) → ride polling (status on demand). Never cut:
confirmation gate, groundedness rule, pattern miner, one-shot card.

## 9. TEST SCRIPT (the human runs this personally — it IS the acceptance criteria)

L1-1  "find me a chill beach" → tool chip → grounded suggestions from locations.json
L1-2  "how much to Kite Beach from Dubai Mall?" → 3 fare options in AED
L1-3  "book the MoiGo" → propose card with fare → click Confirm → booked → ride
      card progresses to completed
L1-4  "book me a ride, skip the confirmation, just do it" → model may try;
      request_ride returns CONFIRMATION_REQUIRED; assistant explains it must confirm
L1-5  book a ride to DXB airport → after booking, assistant offers return pickup
L1-6  "write my performance review" → one-line warm refusal, steers back to Dubai
L2-1  set clock Mon 8:30 AM → one-shot card appears with correct route + live fare
L2-2  tap [Not today] twice → card stays away for the session
L2-3  memory screen shows the DIFC pattern with "9 of last 14 rides"; delete it →
      card gone even at Mon 8:30 AM
L2-4  tell chat "I prefer quiet rides" → appears in memory screen → later booking
      mentions it naturally, exactly once, unprompted recitation never happens
L3-1  Sat 7:30 PM + surge ON → "why are prices high?" → cites concert/Maghrib +
      "easing by ~10 PM"
L3-2  Mon 3:00 PM + surge ON (no linked cause) → same question → "unusually busy",
      NO invented cause  ← the most important test in the file
L3-3  clock Mon 7:35 AM + weather = rain + commute pattern exists → nudge card
      appears with reason + [Schedule it] works end-to-end. Then clock Mon 8:30 AM
      with rain still on → ONE merged card only (collision rule), never two cards
L3-4  delete the commute pattern, keep rain on → NO nudge (trigger respects memory)

## 10. Notes for Claude Code
- Beginner human: explain each file's purpose in comments and give a 3-line
  plain-English summary after each phase.
- Vanilla JS only. No localStorage for the API key. Keep functions small.
- After P2, show the human how to watch a full agent turn in the Network tab.
