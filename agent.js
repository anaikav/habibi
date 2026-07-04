// agent.js
// ---------
// The bit that actually "thinks". Owns the Anthropic API call, the agent loop
// (up to 5 iterations while the model keeps asking for tools), and the
// static/dynamic system prompt.
//
// API key handling: kept in a plain in-memory variable. Never localStorage,
// never persisted, never sent anywhere except the Authorization header on
// api.anthropic.com. It's gone the moment you refresh.
//
// The loop rule (spec §7): while `stop_reason === "tool_use"`, execute all
// tool_use blocks from the assistant message, append them as tool_result
// blocks in a fresh user message, call the API again. Stop after 5 rounds
// so a runaway model can't burn tokens forever.

(function () {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  const CHEAP_MODEL   = 'claude-haiku-4-5-20251001';
  const MODELS = [DEFAULT_MODEL, CHEAP_MODEL];
  const MAX_TOKENS = 1024;
  const MAX_ITERATIONS = 5;

  // ----- The static system prompt (spec §5, verbatim) -----------------

  const SYSTEM_PROMPT = [
    'You are Habibi, a warm, concise concierge for Dubai and the Moi ride service.',
    'SCOPE: Dubai places (the 12 in your tools) and Moi rides only. Warmly decline anything else in one sentence and steer back.',
    "GROUNDING: facts about places, fares, surge causes come ONLY from tool results. If get_city_context shows surge with NO linked cause, say it's unusually busy — NEVER invent an event or reason. If a tool returns nothing, say you don't know.",
    'BOOKINGS: always call propose_booking with fare and route first, then STOP and wait — do not call request_ride in the same turn. Only call request_ride after you see [USER CLICKED CONFIRM]. Quote AED prices.',
    'PERSONALIZATION: call get_saved_patterns and apply stated preferences naturally; never recite the user\'s profile unprompted; if the user corrects a habit or preference, update or delete it via tools and acknowledge once.',
    'STYLE: short replies, max one emoji, currency AED, assume user is in Dubai.',
  ].join('\n');

  // ----- In-memory settings ------------------------------------------

  let apiKey = '';
  let model = DEFAULT_MODEL;

  // The conversation. Anthropic messages: role = "user" | "assistant";
  // content = string OR array of content blocks (text, tool_use, tool_result).
  let messages = [];

  // Queue of code-triggered system events (e.g., airport return-ride hook)
  // that tools.js has fired. Drained into the next user message.
  const pendingSystemEvents = [];

  // Wire the system-event listener once — this is what turns a tools.js event
  // into a text block appended to the next user message.
  let _wired = false;
  function ensureWired() {
    if (_wired) return;
    const t = window.habibi && window.habibi.tools;
    if (!t || !t.onSystemEvent) return;
    t.onSystemEvent((text) => { pendingSystemEvents.push(text); });
    _wired = true;
  }

  // ----- Public settings API -----------------------------------------

  function setApiKey(k) { apiKey = String(k || ''); }
  function hasApiKey()  { return !!apiKey; }
  function setModel(m) {
    if (!MODELS.includes(m)) { console.warn('[agent] unknown model:', m, '— known:', MODELS); return; }
    model = m;
  }
  function getModel() { return model; }

  function newSession() {
    messages = [];
    pendingSystemEvents.length = 0;
    if (window.habibi?.tools?.clearProposals) window.habibi.tools.clearProposals();
  }
  function getMessages() { return JSON.parse(JSON.stringify(messages)); }

  // ----- Dynamic system block (per-turn) ------------------------------

  function fmtSimTime(dt) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const p = (n) => String(n).padStart(2, '0');
    return (
      days[dt.getDay()] + ' ' +
      dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
      ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes())
    );
  }

  function buildSystemText() {
    const parts = [SYSTEM_PROMPT];
    const simTime = window.habibi.clock.getSimTime();
    parts.push('CURRENT SIMULATED TIME (Dubai): ' + fmtSimTime(simTime) + '.');
    const prefs = window.habibi.historyApi.getPreferences();
    if (Object.keys(prefs).length) {
      parts.push('STATED PREFERENCES: ' + JSON.stringify(prefs));
    }
    return parts.join('\n\n');
  }

  // ----- The API call -------------------------------------------------

  async function callAnthropic(msgsForApi, systemText) {
    if (!apiKey) {
      throw new Error('No Anthropic API key set. Call habibi.agent.setApiKey("sk-ant-...") first.');
    }
    const body = {
      model,
      max_tokens: MAX_TOKENS,
      system: systemText,
      tools: window.habibi.tools.TOOL_SCHEMAS,
      messages: msgsForApi,
    };
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Anthropic API ' + res.status + ': ' + errText);
    }
    return await res.json();
  }

  // ----- Helpers ------------------------------------------------------

  function extractText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('\n')
      .trim();
  }

  // ----- The agent loop ----------------------------------------------

  async function runAgentLoop() {
    ensureWired();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const trimmed = window.habibi.memory.trimMessages(messages);
      const tokens = window.habibi.memory.estimateTokens(trimmed);
      console.log('[agent] turn ' + (i + 1) + ' · msgs=' + trimmed.length + ' · ~tokens=' + tokens);

      const systemText = buildSystemText();
      const response = await callAnthropic(trimmed, systemText);

      // Log the real usage if the API reported it.
      if (response.usage) {
        console.log('[agent] usage:', response.usage);
      }

      // Append the assistant's reply (may contain text + tool_use blocks).
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        const text = extractText(response.content);
        return { text, response };
      }

      // Model asked for tools. Run each, collect tool_result blocks.
      const toolUses = (response.content || []).filter((b) => b.type === 'tool_use');
      const followUpBlocks = [];
      for (const tu of toolUses) {
        console.log('[agent] tool_use → ' + tu.name, tu.input);
        const result = await window.habibi.tools.executeTool(tu.name, tu.input);
        console.log('[agent] tool_result ← ' + tu.name, result);
        followUpBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }

      // Drain any code-triggered system events into the SAME user message as
      // text blocks — the model reads them before its next thought.
      while (pendingSystemEvents.length) {
        followUpBlocks.push({ type: 'text', text: pendingSystemEvents.shift() });
      }

      messages.push({ role: 'user', content: followUpBlocks });
    }

    console.warn('[agent] hit iteration cap of ' + MAX_ITERATIONS);
    return { text: '(agent iteration cap reached)' };
  }

  async function sendUserMessage(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('sendUserMessage requires a non-empty string');
    }
    messages.push({ role: 'user', content: text });
    return await runAgentLoop();
  }

  window.habibi = window.habibi || {};
  window.habibi.agent = {
    setApiKey, hasApiKey,
    setModel, getModel,
    newSession, getMessages,
    sendUserMessage,
    MODELS,
  };
})();
