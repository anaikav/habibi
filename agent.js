// agent.js
// ---------
// Talks to the Anthropic API. Runs the "agent loop": send the conversation +
// tools, if the model asks for a tool call, run it, feed the result back, loop
// (max 5 iterations). This is where Habibi actually "thinks".
//
// The API key is read from an in-memory settings variable — NEVER localStorage,
// NEVER hardcoded.
//
// Contract lives in spec §5 and §7. Filled in during Phase 2.
