// app.js
// -------
// The UI glue. Chat rendering + settings + Phase 3 ride card + Phase 4 demo
// control panel + one-shot "Your usual?" card + memory screen.
//
// Golden rule from spec §0: the LLM narrates, the system anticipates. So the
// one-shot card is triggered by pure JS (clock + patterns + no-active-ride
// check), not by a prompt. The Confirm button and the [Book now] button both
// flow through the SAME `executeTool("request_ride")` path — spec §6 "one
// code path for all bookings, no bypass".

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
  const messagesEl    = $('#messages');
  const chatEl        = $('#chat');
  const inputEl       = $('#input');
  const sendBtn       = $('#send');
  const settingsBtn   = $('#settings-btn');
  const memoryBtn     = $('#memory-btn');
  const settingsModal = $('#settings-modal');
  const memoryModal   = $('#memory-modal');
  const closeSettingsBtn = $('#close-settings');
  const closeMemoryBtn   = $('#close-memory');
  const saveBtn       = $('#save-settings');
  const apiKeyInput   = $('#api-key-input');
  const modelSelect   = $('#model-select');
  const memoryPatternsEl = $('#memory-patterns');
  const memoryPrefsEl    = $('#memory-prefs');

  const demoPanel   = $('#demo-panel');
  const demoToggle  = $('#demo-toggle');
  const demoSummary = $('#demo-summary');
  const clockInput  = $('#clock-input');
  const resetBtn    = $('#reset-btn');
  const pinnedEl    = $('#pinned');

  // ============ Small DOM helpers ====================================

  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function appendMessage(el) {
    messagesEl.appendChild(el);
    requestAnimationFrame(() => { chatEl.scrollTop = chatEl.scrollHeight; });
  }

  function fmtSimTime(dt) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const p = (n) => String(n).padStart(2, '0');
    return days[dt.getDay()] + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }

  // ============ Message rendering ====================================

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

  let activeProposalBtn = null;

  function renderProposalCard(proposal) {
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
        if (!approved) { btn.textContent = 'Expired'; return; }
        await sendMessageWithBubble('[USER CLICKED CONFIRM]', false);
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

  async function confirmBooking() {
    const approved = window.habibi.tools.confirmPendingProposal();
    if (!approved) { console.warn('[app] no pending proposal'); return null; }
    return await sendMessageWithBubble('[USER CLICKED CONFIRM]', false);
  }

  // ============ Ride card + polling ==================================

  const activePolls = new Map();

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
    card.appendChild(makeEl('div', 'card-meta',
      `🚗 ${d.name} · ${d.car} · ${d.plate} · ★ ${d.rating}`));

    const status = makeEl('div', 'status-line');
    const dot  = makeEl('span', 'status-dot');
    const text = makeEl('span', 'status-text', statusLabel(ride.status));
    status.appendChild(dot);
    status.appendChild(text);
    card.appendChild(status);

    row.appendChild(card);
    appendMessage(row);

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
    // Ride no longer active → re-check whether the one-shot card should appear.
    reevaluateTriggers();
  }

  function hasActiveRide() {
    return activePolls.size > 0;
  }

  // ============ Phase 4: one-shot "Your usual?" card =================
  //
  // Trigger (spec §6): weekday AND simTime is within pattern window ±20 min
  // AND no active ride AND not session-suppressed. [Book now] approves the
  // proposal directly and calls executeTool('request_ride') — same code path
  // as the chat flow, so no bypass.

  let oneshotDismissedCount = 0;
  let oneshotSessionSuppressed = false;
  let oneshotRenderToken = 0;      // guards against stale async renders
  let currentOneshotEl = null;

  function removeOneshotCard() {
    if (currentOneshotEl && currentOneshotEl.parentNode) {
      currentOneshotEl.parentNode.removeChild(currentOneshotEl);
    }
    currentOneshotEl = null;
  }

  function isWeekday(dt) {
    const d = dt.getDay();
    return d >= 1 && d <= 5;
  }

  function simMinutes(dt) {
    return dt.getHours() * 60 + dt.getMinutes();
  }

  function findMatchingPattern(simTime, patterns) {
    const now = simMinutes(simTime);
    return patterns.find(
      (p) => now >= (p.windowStartMin - 20) && now <= (p.windowEndMin + 20)
    );
  }

  async function reevaluateTriggers() {
    if (oneshotSessionSuppressed) return removeOneshotCard();
    if (hasActiveRide())          return removeOneshotCard();
    const simTime = window.habibi.clock.getSimTime();
    if (!isWeekday(simTime))      return removeOneshotCard();

    const patterns = window.habibi.patterns || [];
    const match = findMatchingPattern(simTime, patterns);
    if (!match)                    return removeOneshotCard();

    // Always re-render so the fare reflects the current surge state.
    await renderOneshotCard(match);
  }

  async function renderOneshotCard(pattern) {
    const myToken = ++oneshotRenderToken;

    // Live fare (accounts for surge).
    const est = await window.habibi.moiApi.estimateFare(pattern.pickup, pattern.dropoff);
    if (myToken !== oneshotRenderToken) return; // outdated

    const option = est.options.find((o) => o.type === pattern.rideType) || est.options[0];
    const fareAED = option ? option.fareAED : null;

    // Only rebuild if data actually changed — avoid DOM churn.
    if (currentOneshotEl && currentOneshotEl.dataset.key ===
        `${pattern.id}|${pattern.rideType}|${fareAED}`) {
      return;
    }
    removeOneshotCard();

    const card = makeEl('div', 'oneshot-card');
    card.dataset.key = `${pattern.id}|${pattern.rideType}|${fareAED}`;
    card.appendChild(makeEl('div', 'oneshot-icon', '💡'));

    const body = makeEl('div', 'oneshot-body');
    body.appendChild(makeEl('div', 'oneshot-title',
      `Your usual to ${pattern.dropoff}?`));
    body.appendChild(makeEl('div', 'oneshot-meta',
      `${pattern.rideType} · ~AED ${fareAED}`));
    card.appendChild(body);

    const actions = makeEl('div', 'oneshot-actions');
    const bookBtn = makeEl('button', 'oneshot-btn oneshot-btn--primary', 'Book now');
    bookBtn.type = 'button';
    const dismissBtn = makeEl('button', 'oneshot-btn oneshot-btn--secondary', 'Not today');
    dismissBtn.type = 'button';

    bookBtn.addEventListener('click', () => {
      bookBtn.disabled = true;
      dismissBtn.disabled = true;
      bookBtn.textContent = 'Booking…';
      bookOneShot(pattern, fareAED, card, bookBtn, dismissBtn);
    });
    dismissBtn.addEventListener('click', dismissOneshot);

    actions.appendChild(bookBtn);
    actions.appendChild(dismissBtn);
    card.appendChild(actions);

    pinnedEl.appendChild(card);
    currentOneshotEl = card;
  }

  async function bookOneShot(pattern, fareAED, cardEl, bookBtn, dismissBtn) {
    // Set the approved slot DIRECTLY — the card IS the confirmation. Then
    // call the exact same executeTool('request_ride') path as chat. One
    // code path for all bookings (spec §6).
    window.habibi.tools.approveProposalDirect({
      pickup:  pattern.pickup,
      dropoff: pattern.dropoff,
      type:    pattern.rideType,
      fareAED,
    });
    const result = await window.habibi.tools.executeTool('request_ride', {
      pickup:  pattern.pickup,
      dropoff: pattern.dropoff,
      type:    pattern.rideType,
    });

    if (result && result.error === 'NO_DRIVERS_AVAILABLE') {
      // Never fail silently (spec §6). Update the card in place; keep it
      // dismissible so the user isn't stuck.
      cardEl.classList.add('oneshot-card--error');
      const body = cardEl.querySelector('.oneshot-body');
      body.replaceChildren(
        makeEl('div', 'oneshot-title', 'No drivers right now'),
        makeEl('div', 'oneshot-meta',  'Try again in a minute.'),
      );
      bookBtn.disabled = true;
      bookBtn.textContent = 'Book now';
      dismissBtn.disabled = false;
      return;
    }
    if (result && result.rideId) {
      // The ride card is rendered via the onChip subscription. Just clear
      // the one-shot card since the booking is done.
      removeOneshotCard();
      // Re-evaluate — the active-ride check will now block re-render.
      reevaluateTriggers();
      return;
    }
    // Unknown error — surface it.
    console.warn('[app] one-shot book unexpected result:', result);
    cardEl.classList.add('oneshot-card--error');
    bookBtn.disabled = true;
    bookBtn.textContent = 'Book now';
    dismissBtn.disabled = false;
  }

  function dismissOneshot() {
    oneshotDismissedCount += 1;
    if (oneshotDismissedCount >= 2) {
      oneshotSessionSuppressed = true;
      console.log('[app] one-shot suppressed for this session (2 dismissals)');
    }
    removeOneshotCard();
  }

  // ============ Phase 4: memory screen ===============================

  function openMemory() {
    renderMemoryScreen();
    memoryModal.classList.remove('hidden');
  }
  function closeMemory() { memoryModal.classList.add('hidden'); }

  function renderMemoryScreen() {
    // Patterns
    const patterns = window.habibi.patterns || [];
    memoryPatternsEl.replaceChildren();
    if (!patterns.length) {
      memoryPatternsEl.appendChild(makeEl('div', 'mem-item-empty', 'No patterns yet.'));
    } else {
      for (const p of patterns) {
        const item = makeEl('div', 'mem-item');

        const body = makeEl('div', 'mem-item-body');
        body.appendChild(makeEl('div', 'mem-item-title', `${p.pickup} → ${p.dropoff}`));
        body.appendChild(makeEl('div', 'mem-item-meta',
          `${p.rideType} · ${p.days} · ${p.window} · ${p.evidence} · confidence ${p.confidence}`));

        const del = makeEl('button', 'mem-delete', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
          window.habibi.historyApi.ignorePatternKey(p.key);
          runMiner();
          renderMemoryScreen();
          reevaluateTriggers(); // pattern gone → one-shot goes away
        });

        item.appendChild(body);
        item.appendChild(del);
        memoryPatternsEl.appendChild(item);
      }
    }

    // Preferences
    const prefs = window.habibi.historyApi.getPreferences();
    memoryPrefsEl.replaceChildren();
    const entries = Object.entries(prefs);
    if (!entries.length) {
      memoryPrefsEl.appendChild(makeEl('div', 'mem-item-empty', 'No preferences yet.'));
    } else {
      for (const [key, value] of entries) {
        const item = makeEl('div', 'mem-item');

        const body = makeEl('div', 'mem-item-body');
        body.appendChild(makeEl('div', 'mem-item-title', key));
        body.appendChild(makeEl('div', 'mem-item-meta', String(value)));

        const del = makeEl('button', 'mem-delete', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
          window.habibi.historyApi.deletePreference(key);
          renderMemoryScreen();
        });

        item.appendChild(body);
        item.appendChild(del);
        memoryPrefsEl.appendChild(item);
      }
    }
  }

  // ============ Phase 4: demo panel ==================================

  function updateActivePresetButton() {
    const now = window.habibi.clock.getSimTime().toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
    const presets = window.habibi.clock.PRESETS;
    for (const btn of document.querySelectorAll('.preset-btn')) {
      const iso = presets[btn.dataset.preset];
      const match = iso && iso.slice(0, 16) === now;
      btn.classList.toggle('is-active', !!match);
    }
  }

  function updateClockInput() {
    // datetime-local wants "YYYY-MM-DDTHH:MM" in local time.
    const dt = window.habibi.clock.getSimTime();
    const p = (n) => String(n).padStart(2, '0');
    clockInput.value =
      dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
      'T' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }

  function updateDemoSummary() {
    const parts = [fmtSimTime(window.habibi.clock.getSimTime())];
    if (window.habibi.contextApi.isSurgeActive())  parts.push('surge on');
    if (window.habibi.contextApi.isRainForecast()) parts.push('rain forecast');
    demoSummary.textContent = parts.join(' · ');
  }

  function wireDemoPanel() {
    // Collapsible
    demoToggle.addEventListener('click', () => {
      const expanded = demoToggle.getAttribute('aria-expanded') === 'true';
      demoToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      demoPanel.setAttribute('data-collapsed', expanded ? 'true' : 'false');
    });

    // Clock presets
    for (const btn of document.querySelectorAll('.preset-btn')) {
      btn.addEventListener('click', () => {
        const iso = window.habibi.clock.PRESETS[btn.dataset.preset];
        if (iso) window.habibi.clock.setSimTime(iso);
      });
    }
    // Free datetime input
    clockInput.addEventListener('change', () => {
      if (clockInput.value) window.habibi.clock.setSimTime(clockInput.value);
    });

    // Surge + Weather segmented toggles
    for (const seg of document.querySelectorAll('.seg')) {
      const which = seg.dataset.seg;
      for (const btn of seg.querySelectorAll('.seg-btn')) {
        btn.addEventListener('click', () => {
          for (const other of seg.querySelectorAll('.seg-btn')) other.classList.remove('is-active');
          btn.classList.add('is-active');
          const on = btn.dataset.val === 'on';
          if (which === 'surge') window.habibi.contextApi.setSurge(on);
          else if (which === 'rain') window.habibi.contextApi.setRainForecast(on);
          updateDemoSummary();
          reevaluateTriggers(); // surge changes the one-shot's live fare
        });
      }
    }

    resetBtn.addEventListener('click', resetDemoData);

    // Reflect clock changes coming from anywhere (presets, datetime, console).
    window.habibi.clock.onSimTimeChange(() => {
      updateActivePresetButton();
      updateClockInput();
      updateDemoSummary();
      reevaluateTriggers();
    });

    updateActivePresetButton();
    updateClockInput();
    updateDemoSummary();
  }

  function resetDemoData() {
    // Stop all polling and clear ride state.
    for (const rideId of Array.from(activePolls.keys())) {
      const id = activePolls.get(rideId);
      if (id) clearInterval(id);
      activePolls.delete(rideId);
    }
    window.habibi.moiApi.resetRides();
    window.habibi.historyApi.resetAll();
    window.habibi.tools.clearProposals();

    // Reset session flags for the one-shot fatigue rule.
    oneshotDismissedCount = 0;
    oneshotSessionSuppressed = false;
    removeOneshotCard();

    // Reset the LLM conversation and clear the chat DOM.
    window.habibi.agent.newSession();
    messagesEl.replaceChildren();
    activeProposalBtn = null;

    // Re-run the miner over the freshly seeded history.
    runMiner();

    // Welcome again.
    renderAssistantBubble(
      "Salaam! I'm Habibi — your Dubai concierge. Ask me about places, fares, or book a ride."
    );
    if (!window.habibi.agent.hasApiKey()) {
      renderAssistantBubble('Tap the ⚙ up top to add your Anthropic API key. It stays in memory only.');
    }

    // Recheck one-shot given the fresh state.
    reevaluateTriggers();
  }

  // ============ Settings modal =======================================

  function openSettings() {
    apiKeyInput.value = '';
    modelSelect.value = window.habibi.agent.getModel();
    settingsModal.classList.remove('hidden');
    setTimeout(() => apiKeyInput.focus(), 50);
  }
  function closeSettings() { settingsModal.classList.add('hidden'); }

  settingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) window.habibi.agent.setApiKey(key);
    window.habibi.agent.setModel(modelSelect.value);
    closeSettings();
    apiKeyInput.value = '';
    inputEl.focus();
  });

  // Memory modal wiring
  memoryBtn.addEventListener('click', openMemory);
  closeMemoryBtn.addEventListener('click', closeMemory);
  memoryModal.addEventListener('click', (e) => {
    if (e.target === memoryModal) closeMemory();
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
    if (sending) return;
    if (renderUser) renderUserBubble(text);
    setSending(true);
    try {
      await window.habibi.agent.sendUserMessage(text);
    } catch (e) {
      console.error('[app] agent error:', e);
      renderErrorBubble(errorHint(e));
    } finally {
      setSending(false);
      // Any tool that ran might have changed patterns/prefs; refresh miner
      // + memory screen if it's open, and re-check the one-shot.
      runMiner();
      if (!memoryModal.classList.contains('hidden')) renderMemoryScreen();
      reevaluateTriggers();
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

  // ============ Agent + tools event subscriptions ====================

  window.habibi.agent.onAssistantText((text) => renderAssistantBubble(text));

  window.habibi.tools.onChip((chip) => {
    const { name, result } = chip;
    if (name === 'propose_booking') return; // proposal card handles this
    if (name === 'request_ride' && result && result.rideId) {
      renderRideCard(result);
      return;
    }
    renderChip(name, result);
  });

  window.habibi.tools.onProposal((p) => renderProposalCard(p));

  // ============ Welcome + boot =======================================

  renderAssistantBubble(
    "Salaam! I'm Habibi — your Dubai concierge. Ask me about places, fares, or book a ride."
  );
  if (!window.habibi.agent.hasApiKey()) {
    renderAssistantBubble('Tap the ⚙ up top to add your Anthropic API key. It stays in memory only.');
  }

  wireDemoPanel();
  reevaluateTriggers();
  inputEl.focus();

  window.habibi.app = {
    confirmBooking,
    renderChip,
    renderAssistantBubble,
    reevaluateTriggers,
    resetDemoData,
  };
  console.log('[app] Phase 4 UI ready.');
})();
