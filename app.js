// app.js
// -------
// The UI glue: wires the chat DOM, the demo control panel, the memory screen,
// the one-shot card, and the proactive nudge. Also owns the top-level
// `window.habibi` namespace so the mocks/agent are reachable from the browser
// console for testing.
//
// In Phase 0 it does nothing. In Phase 1 it just publishes the mock modules to
// `window.habibi` so you can experiment from DevTools. The real UI arrives in
// Phase 3.
