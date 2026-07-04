// memory.js
// ----------
// Conversation memory helpers.
//
// LLMs charge by token and have a hard context limit, so we don't send the
// entire chat history every turn — we trim the oldest messages first. The one
// rule we must never break is that a `tool_use` block (assistant asks for a
// tool) and its matching `tool_result` block (user replies with the tool
// output) are a pair. If we drop one without the other, the Anthropic API
// rejects the request. So this file's whole job is: trim by rough token
// budget, but keep pairs together.
//
// The "tokens" here are estimated from character count (~4 chars per token),
// which is close enough for budgeting. Real usage is logged from the API
// response later.

(function () {
  'use strict';

  // Rough character-length of a single message (for budgeting).
  function charLen(msg) {
    if (typeof msg.content === 'string') return msg.content.length;
    if (Array.isArray(msg.content)) {
      let n = 0;
      for (const block of msg.content) {
        if (block.type === 'text') {
          n += (block.text || '').length;
        } else if (block.type === 'tool_use') {
          n += (block.name || '').length + JSON.stringify(block.input || {}).length + 40;
        } else if (block.type === 'tool_result') {
          const c = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          n += (c || '').length + 40;
        }
      }
      return n;
    }
    return 0;
  }

  function hasToolUse(msg) {
    return Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_use');
  }
  function hasToolResult(msg) {
    return Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_result');
  }

  // Very rough: chars / 4 ≈ tokens. Good enough for budgeting decisions.
  function estimateTokens(messages) {
    const chars = messages.reduce((sum, m) => sum + charLen(m), 0);
    return Math.round(chars / 4);
  }

  // Drop oldest messages until we're under the char budget. When we drop an
  // assistant message that contained a tool_use, also drop the following
  // user message (its tool_result). Then eat any orphan tool_results at the
  // new front, since they'd point to a tool_use we no longer have.
  function trimMessages(messages, maxCharBudget) {
    if (!Number.isFinite(maxCharBudget)) maxCharBudget = 40000; // ~10k tokens
    const trimmed = messages.slice();
    let total = trimmed.reduce((sum, m) => sum + charLen(m), 0);
    if (total <= maxCharBudget) return trimmed;

    while (total > maxCharBudget && trimmed.length > 2) {
      const dropped = trimmed.shift();
      total -= charLen(dropped);

      // If we just dropped an assistant tool_use, drop the paired tool_result.
      if (dropped.role === 'assistant' && hasToolUse(dropped)) {
        const next = trimmed[0];
        if (next && next.role === 'user' && hasToolResult(next)) {
          trimmed.shift();
          total -= charLen(next);
        }
      }
      // Eat any orphan tool_results at the new front — they'd fail validation.
      while (trimmed.length && trimmed[0].role === 'user' && hasToolResult(trimmed[0])) {
        const orphan = trimmed.shift();
        total -= charLen(orphan);
      }
    }
    return trimmed;
  }

  window.habibi = window.habibi || {};
  window.habibi.memory = { estimateTokens, trimMessages };
})();
