// app.js
// -------
// The UI glue. Chat rendering, settings modal, proposal + ride cards, and the
// ride-status polling loop.
//
// The event pattern from Phases 1–2 stays the same — this file just SUBSCRIBES
// to `tools.onProposal` / `tools.onChip` / `agent.onAssistantText` and turns
// each event into DOM. It never talks to moiApi or contextApi directly except
// to poll a ride's status.
//
// The confirmation gate keeps its one code path: clicking [Confirm booking]
// calls `tools.confirmPendingProposal()` + `agent.sendUserMessage('[USER
// CLICKED CONFIRM]')`. Same two lines the console helper uses.

(async function () {
  'use strict';

  window.habibi = window.habibi || {};

  // ============ Boot: load locations + run the miner =================

  try {
    const res = await fetch('locations.json');
    window.habibi.locations = await res.json();
    console.log('[app] loaded', window.habibi.locations.length, 'locations');
  } catch (err) {
    console.warn('[app] could not load locations.json:', err);
    window.habibi.locations = [];
  }

  function runMiner() {
    const history = window.habibi.historyApi.getRideHistory();
    const ignoredKeys = window.habibi.historyApi.getIgnoredPatternKeys();
    const patterns = window.habibi.patternMiner.minePatterns(history, { ignoredKeys });
    console.log('[patternMiner] mined patterns:', patterns);
    window.habibi.patterns = patterns;
    return patterns;
  }
  window.habibi.runMiner = runMiner;
  runMiner();

  // ============ DOM refs =============================================

  const $ = (sel) => document.querySelector(sel);
  const messagesEl   = $('#messages');
  const chatEl       = $('#chat');
  const inputEl      = $('#input');
  const sendBtn      = $('#send');
  const settingsBtn  = $('#settings-btn');
  const modalEl      = $('#settings-modal');
  const closeModalBtn = $('#close-settings');
  const saveBtn      = $('#save-settings');
  const apiKeyInput  = $('#api-key-input');
  const modelSelect  = $('#model-select');

  // ============ Message rendering ====================================

  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  // Auto-scroll after every append. The chat container scrolls, not the page.
  function appendMessage(el) {
    messagesEl.appendChild(el);
    requestAnimationFrame(() => { chatEl.scrollTop = chatEl.scrollHeight; });
  }

  function renderUserBubble(text) {
    const row = makeEl('div', 'msg msg--user');
    row.appendChild(makeEl('div', 'bubble', text));
    appendMessage(row);
  }

  function renderAssistantBubble(text) {
    const row = makeEl('div', 'msg msg--assistant');
    row.appendChild(makeEl('div', 'bubble', text));
    appendMessage(row);
  }

  function renderErrorBubble(text) {
    const row = makeEl('div', 'msg msg--error msg--assistant');
    row.appendChild(makeEl('div', 'bubble', text));
    appendMessage(row);
  }

  // Compact one-line summary for each tool's result. Suppressed for
  // propose_booking + request_ride — those get real cards instead.
  function chipSummary(name, result) {
    if (result && result.error) return 'error: ' + result.error;
    switch (name) {
      case 'search_locations':
        return Array.isArray(result) ? `${result.length} result${result.length === 1 ? '' : 's'}` : '';
      case 'get_location_details':
        return (result && result.name) || '(not found)';
      case 'estimate_fare': {
        const first = result && result.options && result.options[0];
        return first ? `${first.type} AED ${first.fareAED}` : '';
      }
      case 'get_ride_status':
        return (result && result.status) || '';
      case 'cancel_ride':
        return 'cancelled' + (result && result.cancellationFeeAED ? ` (AED ${result.cancellationFeeAED} fee)` : ' (free)');
      case 'get_saved_patterns':
        return Array.isArray(result) ? `${result.length} pattern${result.length === 1 ? '' : 's'}` : '';
      case 'update_preference':
        return 'saved';
      case 'delete_preference':
        return 'removed';
      case 'get_city_context': {
        const surge = result && result.surge && result.surge.active ? 'surge on' : 'surge off';
        return surge;
      }
      default:
        return 'ok';
    }
  }

  const CHIP_ICON = {
    search_locations:     '🔍',
    get_location_details: '🔍',
    estimate_fare:        '💰',
    get_ride_status:      '🚗',
    cancel_ride:          '🚗',
    get_saved_patterns:   '🧠',
    update_preference:    '🧠',
    delete_preference:    '🧠',
    get_city_context:     '🌆',
  };

  function renderChip(name, result) {
    const icon = CHIP_ICON[name] || '🔧';
    const summary = chipSummary(name, result);
    const row = makeEl('div', 'msg msg--assistant');
    row.appendChild(makeEl('div', 'chip', `${icon} ${name} → ${summary}`));
    appendMessage(row);
  }

  // ============ Proposal card + Confirm button =======================

  let activeProposalBtn = null; // disable stale Confirm buttons

  function renderProposalCard(proposal) {
    // Retire any prior card's button — only the latest proposal is bookable.
    if (activeProposalBtn) activeProposalBtn.disabled = true;

    const row = makeEl('div', 'msg msg--assistant');
    const card = makeEl('div', 'card card--proposal');

    const head = makeEl('div', 'card-head');
    head.appendChild(makeEl('div', 'card-title', 'Ready to book?'));
    head.appendChild(makeEl('div', 'card-badge', 'Proposal'));
    card.appendChild(head);

    card.appendChild(makeEl('div', 'card-route', `${proposal.pickup} → ${proposal.dropoff}`));
    card.appendChild(makeEl('div', 'card-fare', `AED ${proposal.fareAED}`));
    card.appendChild(makeEl('div', 'card-meta', `${proposal.type}`));

    const btnRow = makeEl('div', 'btn-row');
    const btn = makeEl('button', 'btn-primary', 'Confirm booking');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Booking…';
      try {
        const approved = window.habibi.tools.confirmPendingProposal();
        if (!approved) {
          btn.textContent = 'Expired';
          return;
        }
        await sendMessageWithBubble('[USER CLICKED CONFIRM]', /*renderUser=*/ false);
        btn.textContent = 'Confirmed';
      } catch (e) {
        console.error('[app] confirm failed:', e);
        renderErrorBubble('Booking failed: ' + e.message);
      }
    });
    activeProposalBtn = btn;
    btnRow.appendChild(btn);
    card.appendChild(btnRow);

    row.appendChild(card);
    appendMessage(row);
  }

  // Public helper for console flow (kept from Phase 2).
  async function confirmBooking() {
    const approved = window.habibi.tools.confirmPendingProposal();
    if (!approved) { console.warn('[app] no pending proposal'); return null; }
    return await sendMessageWithBubble('[USER CLICKED CONFIRM]', false);
  }

  // ============ Ride card + polling ==================================

  const activePolls = new Map(); // rideId → interval id

  function statusLabel(status) {
    const labels = {
      requested:       'Requested',
      driver_assigned: 'Driver assigned',
      driver_arriving: 'Driver arriving',
      in_ride:         'In ride',
      completed:       'Completed',
      cancelled:       'Cancelled',
    };
    return labels[status] || status;
  }

  function renderRideCard(ride) {
    const row = makeEl('div', 'msg msg--assistant');
    const card = makeEl('div', 'card card--ride');

    const head = makeEl('div', 'card-head');
    head.appendChild(makeEl('div', 'card-title', 'Ride booked'));
    head.appendChild(makeEl('div', 'card-badge', ride.type));
    card.appendChild(head);

    card.appendChild(makeEl('div', 'card-route', `${ride.pickup} → ${ride.dropoff}`));
    card.appendChild(makeEl('div', 'card-fare', `AED ${ride.fareAED}`));
    const d = ride.driver || {};
    card.appendChild(makeEl(
      'div', 'card-meta',
      `🚗 ${d.name} · ${d.car} · ${d.plate} · ★ ${d.rating}`
    ));

    const status = makeEl('div', 'status-line');
    const dot = makeEl('span', 'status-dot');
    const text = makeEl('span', 'status-text', statusLabel(ride.status));
    status.appendChild(dot);
    status.appendChild(text);
    card.appendChild(status);

    row.appendChild(card);
    appendMessage(row);

    // Start polling every 5s per spec §8 P3. Stops on completed / cancelled.
    startPolling(ride.rideId, dot, text);
  }

  function startPolling(rideId, dotEl, textEl) {
    if (activePolls.has(rideId)) return;
    const id = setInterval(async () => {
      try {
        const s = await window.habibi.moiApi.getRideStatus(rideId);
        if (s && s.status) {
          textEl.textContent = statusLabel(s.status);
          if (s.status === 'completed') {
            dotEl.classList.add('done');
            stopPolling(rideId);
          } else if (s.status === 'cancelled') {
            dotEl.classList.add('cancel');
            stopPolling(rideId);
          }
        }
      } catch (e) {
        console.warn('[app] poll failed for', rideId, e);
      }
    }, 5000);
    activePolls.set(rideId, id);
  }
  function stopPolling(rideId) {
    const id = activePolls.get(rideId);
    if (id) { clearInterval(id); activePolls.delete(rideId); }
  }

  // ============ Settings modal =======================================

  function openSettings() {
    apiKeyInput.value = '';
    modelSelect.value = window.habibi.agent.getModel();
    modalEl.classList.remove('hidden');
    setTimeout(() => apiKeyInput.focus(), 50);
  }
  function closeSettings() { modalEl.classList.add('hidden'); }

  settingsBtn.addEventListener('click', openSettings);
  closeModalBtn.addEventListener('click', closeSettings);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeSettings(); // click backdrop
  });
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) window.habibi.agent.setApiKey(key);
    window.habibi.agent.setModel(modelSelect.value);
    closeSettings();
    // Don't retain the plaintext in the DOM.
    apiKeyInput.value = '';
    // Refocus composer so the user can just type.
    inputEl.focus();
  });

  // ============ Composer wiring ======================================

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  }
  inputEl.addEventListener('input', autoResize);

  let sending = false;
  function setSending(on) {
    sending = on;
    sendBtn.disabled = on;
    inputEl.disabled = on;
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    if (!window.habibi.agent.hasApiKey()) {
      renderErrorBubble('Add your Anthropic API key in Settings first.');
      openSettings();
      return;
    }
    inputEl.value = '';
    autoResize();
    await sendMessageWithBubble(text, true);
    inputEl.focus();
  }

  async function sendMessageWithBubble(text, renderUser) {
    if (sending) return; // guard against overlapping sends
    if (renderUser) renderUserBubble(text);
    setSending(true);
    try {
      await window.habibi.agent.sendUserMessage(text);
    } catch (e) {
      console.error('[app] agent error:', e);
      renderErrorBubble(errorHint(e));
    } finally {
      setSending(false);
    }
  }

  function errorHint(e) {
    const m = String(e && e.message || e);
    if (m.includes('No Anthropic API key')) return 'Add your Anthropic API key in Settings first.';
    if (m.includes('401')) return 'Anthropic rejected the key (401). Check for typos or trailing whitespace.';
    if (m.includes('429')) return 'Rate-limited by Anthropic. Wait a moment and try again.';
    if (m.includes('Failed to fetch')) return 'Network error reaching api.anthropic.com. Check your connection.';
    return 'Something went wrong: ' + m;
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // ============ Event subscriptions ==================================

  // Assistant text: append a bubble whenever a text block arrives.
  window.habibi.agent.onAssistantText((text) => {
    renderAssistantBubble(text);
  });

  // Tool chips: skip propose_booking (proposal card renders it) and skip
  // successful request_ride (ride card renders it). Errors still get a chip.
  window.habibi.tools.onChip((chip) => {
    const { name, result } = chip;
    if (name === 'propose_booking') return;
    if (name === 'request_ride' && result && result.rideId) {
      renderRideCard(result);
      return;
    }
    renderChip(name, result);
  });

  // Proposal card fires from tools.propose_booking.
  window.habibi.tools.onProposal((p) => renderProposalCard(p));

  // ============ Welcome state ========================================

  renderAssistantBubble(
    "Salaam! I'm Habibi — your Dubai concierge. Ask me about places, fares, or book a ride."
  );
  if (!window.habibi.agent.hasApiKey()) {
    renderAssistantBubble('Tap the ⚙ up top to add your Anthropic API key. It stays in memory only.');
  }

  // Focus the composer so the user can start typing.
  inputEl.focus();

  // Public console helpers (kept from earlier phases).
  window.habibi.app = { confirmBooking, renderChip, renderAssistantBubble };
  console.log('[app] Phase 3 UI ready.');
})();
