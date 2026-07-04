// memory.js
// ----------
// Conversation memory helpers. The Anthropic API has a token limit, so we trim
// old messages before sending. The one rule we must never break: never split a
// `tool_use` block from its matching `tool_result` — drop them together or not
// at all, or the API rejects the request.
//
// Also logs a rough token estimate per turn so the human can watch the
// conversation grow.
//
// Filled in during Phase 2.
