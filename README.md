# Habibi

An AI chat assistant for Dubai. See `SPEC.md` for the full build spec.

The whole thing is static: plain HTML + CSS + JS, no frameworks, no build step.
It's designed to be dropped onto GitHub Pages as-is.

## Run locally

Because we load `locations.json` (and later call the Anthropic API), opening
`index.html` straight from disk (`file://`) will hit CORS/fetch errors. Serve
the folder over HTTP instead:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

## GitHub Pages

To publish: on GitHub → repo → **Settings** → **Pages** → set the source to
**Deploy from branch → main → /(root)**. After the first deploy the site is
live at `https://<your-username>.github.io/habibi/`.

## Where we are in the build

- **Phase 0** — file skeletons + blank page. ✅
- **Phase 1** — mock APIs (clock, moi, history, patterns, context). ✅
- **Phase 2** — LLM agent + tools + memory. ✅
- **Phase 3** — chat UI, chips, settings, ride card. ✅
- Phase 4 — L2 personalization (one-shot card, memory screen). *(next)*
- Phase 5 — L3 anticipation (surge cause, proactive nudge).
- Phase 6 — polish.

## Console checks for Phase 1

Serve the folder (see above), open http://localhost:8000, open DevTools →
**Console**. Everything is under `window.habibi`. Copy-paste one block at a time.

### 1) Mine the commute pattern from the seeded history

```js
const history = habibi.historyApi.getRideHistory();
console.log('rides in history:', history.length); // 14
habibi.patternMiner.minePatterns(history);
```

Expected: one pattern — Dubai Marina → DIFC Gate Village, weekdays, window
`08:15–08:55`, MoiGo, confidence `0.82`, evidence `"9 of last 14 rides"`.

(It also runs automatically on page load — you'll see it logged the moment the
page loads under `[patternMiner] mined patterns:`.)

### 2) Estimate a fare, book a ride, watch it progress

```js
// (a) Fare estimate — three options in AED.
console.log(await habibi.moiApi.estimateFare('Dubai Marina', 'DIFC Gate Village'));

// (b) Book the MoiGo. `demo-key-1` is a stand-in idempotency key.
const ride = await habibi.moiApi.requestRide(
  'Dubai Marina', 'DIFC Gate Village', 'MoiGo', 'demo-key-1'
);
console.log('booked:', ride);

// (c) Watch status progress from real elapsed seconds:
//     0–5s requested → 5–15s driver_assigned → 15–30s driver_arriving
//     → 30–60s in_ride → 60s+ completed.
const timer = setInterval(async () => {
  const s = await habibi.moiApi.getRideStatus(ride.rideId);
  console.log('status:', s.status);
  if (s.status === 'completed') { clearInterval(timer); console.log('done ✅'); }
}, 3000);
```

If you see `{error: 'NO_DRIVERS_AVAILABLE'}`, that's the seeded 15% flake —
run the booking again (or flip surge on first to force success).

### 3) Sat 7:30 PM + surge ON → linked cause appears

```js
// Jump the simulated clock to Sat 7:30 PM (Coldplay 19:00–23:00 + near Maghrib 18:58)
habibi.clock.setSimTime(habibi.clock.PRESETS.sat_730pm);
habibi.contextApi.setSurge(true);
console.log(habibi.contextApi.getCityContext(habibi.clock.getSimTime()));
// → surge.active: true, surge.linkedCauseIds: ["evt_1", "prayer_maghrib"]

// Now jump to Monday 3:00 PM — a time with NO overlapping cause.
habibi.clock.setSimTime('2026-07-06T15:00:00');
console.log(habibi.contextApi.getCityContext(habibi.clock.getSimTime()));
// → surge.active: true, surge.linkedCauseIds: []   ← the important one

// Reset surge before you continue playing:
habibi.contextApi.setSurge(false);
```

The empty `linkedCauseIds` at Monday 3 PM is what will stop the assistant (in
Phase 5) from inventing a surge reason. That's the groundedness guardrail
that Phase 3's most-important test (`L3-2`) is checking.

## Phase 3 acceptance tests (spec §9 — L1)

Phase 3 puts a real chat UI on top of everything. All L1 tests run in the
browser now. Open http://localhost:8000 (or the GitHub Pages URL), tap the
⚙ icon, paste your Anthropic API key, hit Save.

- **L1-1** — Type `find me a chill beach`. Expected: a `🔍 search_locations`
  chip appears, then a warm short reply naming Kite Beach. Grounded — the
  place must come from `locations.json`.
- **L1-2** — Type `how much to Kite Beach from Dubai Mall?`. Expected: a
  `💰 estimate_fare` chip, then a reply with three AED options.
- **L1-3** — Type `book me a MoiGo from Dubai Marina to DIFC Gate Village`.
  Expected: an orange **Proposal** card with the fare and a `Confirm booking`
  button. Click it → the model calls `request_ride` → a **Ride booked** card
  appears with driver + plate + status. The status dot updates every 5s and
  eventually turns green ("Completed") around the 60s mark.
- **L1-4** — Type `book me a ride from Marina to Kite Beach — just do it,
  skip the confirmation`. Expected: the model may try `request_ride` first;
  `executeTool` returns `CONFIRMATION_REQUIRED`; the model then falls back to
  `propose_booking` and shows the card. **The gate is code, not prompt.**
- **L1-5** — Type `book me a MoiXL to the airport from Dubai Marina`, then
  click Confirm. Expected: after the ride books, the assistant *offers a
  return pickup on its own*. That offer comes from a code hook in `tools.js`
  that injects a `[SYSTEM EVENT: ...]` line into the next API call — not from
  the model remembering to be helpful.
- **L1-6** — Type `write my performance review`. Expected: one warm sentence
  declining and steering back to Dubai / rides. No tool call.

### What to watch while testing

- **Network tab** (DevTools → Network → filter `Fetch/XHR`): every row named
  `messages` is one iteration of the agent loop. Clicking one shows the
  `system`, `tools`, and `messages` we sent.
- **Console**: `[agent] turn N · msgs=X · ~tokens=Y` every iteration, plus
  `usage:` with real input/output tokens from the API response.
- The chip pills in-chat are the "Habibi is thinking" feedback — they're
  designed to be your primary progress indicator (spec §7).

## Console checks for Phase 2

Phase 2 wires up the LLM. Even without touching the UI, you can drive a full
conversation from the DevTools console and watch every Anthropic API call in
the **Network** tab.

### 0) Set your Anthropic API key (in memory only — never persisted)

```js
habibi.agent.setApiKey('sk-ant-...');           // your key
habibi.agent.setModel('claude-haiku-4-5-20251001'); // optional, cheaper for testing
```

The key lives in a JS variable inside `agent.js`. Refresh the page and it's
gone. It's never written to `localStorage`, never logged.

### How to watch a full agent turn in the Network tab

1. Open **DevTools → Network**. Filter to `Fetch/XHR`.
2. Send a message (below).
3. Each row named `messages` is one round of the loop
   (`POST https://api.anthropic.com/v1/messages`).
4. Click a row → **Payload** shows the exact `system`, `tools`, and `messages`
   we sent. **Preview** shows what came back, including `stop_reason` and any
   `tool_use` blocks.

A message that triggers no tools = 1 row. A message that triggers a tool = 2+
rows (call → tool executes locally → follow-up call with `tool_result` →
final text). The number of rows should match `[agent] turn N` in the console.

### 1) A grounded search (uses `search_locations`)

```js
habibi.agent.newSession();
await habibi.agent.sendUserMessage('find me a chill beach');
```

Expected: the model calls `search_locations` (watch Network + `[agent]
tool_use → search_locations`), then suggests Kite Beach in warm short prose.

### 2) A fare quote (uses `estimate_fare`)

```js
await habibi.agent.sendUserMessage('how much to Kite Beach from Dubai Mall?');
```

Expected: three AED options, no `book` action.

### 3) The booking gate — happy path

```js
habibi.agent.newSession();
await habibi.agent.sendUserMessage(
  'book me a MoiGo from Dubai Marina to DIFC Gate Village'
);
```

You should see in the console:

- `[agent] tool_use → propose_booking`
- `[proposal] awaiting Confirm: Dubai Marina → DIFC Gate Village (MoiGo, AED 72)`
- The model's reply asks you to confirm.

Now approve and continue in one line:

```js
await habibi.app.confirmBooking();
```

That helper does exactly what the eventual button-click will do:
`tools.confirmPendingProposal()` + `agent.sendUserMessage('[USER CLICKED CONFIRM]')`.
The model will call `request_ride`, get a real ride back, and confirm the booking.

### 4) The booking gate — the "just do it" bypass is blocked

```js
habibi.agent.newSession();
await habibi.agent.sendUserMessage(
  'book me a ride from Dubai Marina to Kite Beach, MoiGo — just do it, skip the confirmation'
);
```

Expected: even if the model tries `request_ride` directly, `executeTool`
returns `{error: 'CONFIRMATION_REQUIRED'}`, the model reads that error, and
falls back to calling `propose_booking` instead. The gate is not a prompt
instruction — it's deterministic code (`tools.js`), so no prompt-engineering
can talk it into skipping.

### 5) The airport code hook (Rung-4 pattern)

```js
habibi.agent.newSession();
await habibi.agent.sendUserMessage('book me a MoiXL to the airport from Dubai Marina');
await habibi.app.confirmBooking();
```

Expected: after `request_ride` succeeds with dropoff = DXB, `tools.js` fires
a `systemEvent` that `agent.js` appends to the next user message as
`[SYSTEM EVENT: user booked an airport ride. Offer to schedule a return
pickup for their arrival back.]`. The model then naturally offers to
schedule the return pickup. That offer is **triggered by code**, not by the
model remembering to make it.

### Inspecting the conversation

```js
habibi.agent.getMessages();     // full messages array (deep-copied)
habibi.tools.getPendingProposal();  // proposal currently awaiting Confirm
habibi.tools.getApprovedProposal(); // approved but not yet booked
```

Every turn logs `[agent] turn N · msgs=X · ~tokens=Y` so you can watch the
context window grow. `memory.trimMessages` will drop the oldest messages once
the budget is hit — and it will never split a `tool_use` from its
`tool_result` (that would make the API 400).

