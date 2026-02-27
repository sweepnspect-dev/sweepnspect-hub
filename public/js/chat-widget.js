/**
 * SweepNspect Live Chat Widget
 * Self-contained, no dependencies (~6KB)
 * Drop-in for any website: <script src="...chat-widget.js"></script>
 */
(function() {
  'use strict';

  const WORKER_URL = 'https://sweepnspect-webhook.sweepnspect.workers.dev';
  const POLL_INTERVAL = 4000; // 4s poll for replies

  let state = {
    open: false,
    phase: 'intro', // intro | chat
    sessionId: null,
    visitor: { name: '', email: '' },
    messages: [],
    lastTs: '1970-01-01T00:00:00.000Z',
    pollTimer: null,
    sending: false,
  };

  // ── Styles ──────────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #snsp-chat-bubble {
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        width: 60px; height: 60px; border-radius: 50%;
        background: #ea580c; color: #fff; border: none;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 20px rgba(234,88,12,0.45);
        transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
      }
      #snsp-chat-bubble:hover {
        transform: scale(1.08);
        background: #c2410c;
        box-shadow: 0 6px 28px rgba(234,88,12,0.55);
      }
      #snsp-chat-bubble .badge {
        position: absolute; top: -4px; right: -4px;
        background: #ea580c; color: #fff; font-size: 11px;
        width: 20px; height: 20px; border-radius: 50%;
        display: none; align-items: center; justify-content: center;
      }
      #snsp-chat-window {
        position: fixed; bottom: 92px; right: 20px; z-index: 99998;
        width: 360px; max-width: calc(100vw - 32px);
        height: 480px; max-height: calc(100vh - 120px);
        background: rgba(15,23,42,0.55);
        backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(148,163,184,0.15);
        border-radius: 16px;
        box-shadow: 0 12px 48px rgba(0,0,0,0.4);
        display: none; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #e2e8f0;
      }
      #snsp-chat-window.open { display: flex; }
      .snsp-header {
        background: rgba(15,23,42,0.6); padding: 14px 16px;
        border-bottom: 1px solid rgba(148,163,184,0.12); display: flex;
        align-items: center; justify-content: space-between;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      }
      .snsp-header-title {
        font-weight: 600; font-size: 14px; display: flex;
        align-items: center; gap: 8px; color: #fff;
      }
      .snsp-header-title .dot {
        width: 8px; height: 8px; border-radius: 50%; background: #4ade80;
      }
      .snsp-close {
        background: none; border: none; color: #94a3b8; cursor: pointer;
        font-size: 18px; padding: 4px 8px; border-radius: 4px;
      }
      .snsp-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.1); }
      .snsp-body {
        flex: 1; overflow-y: auto; padding: 16px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .snsp-intro {
        display: flex; flex-direction: column; gap: 12px;
        justify-content: center; flex: 1;
      }
      .snsp-intro h3 {
        margin: 0 0 4px; font-size: 16px; color: #fff;
      }
      .snsp-intro p {
        margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.4;
      }
      .snsp-intro input {
        background: rgba(15,23,42,0.5); border: 1px solid rgba(148,163,184,0.2);
        color: #e2e8f0; padding: 10px 12px; border-radius: 8px; font-size: 14px;
        outline: none; width: 100%; box-sizing: border-box;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      }
      .snsp-intro input:focus { border-color: #ea580c; }
      .snsp-intro input::placeholder { color: #64748b; }
      .snsp-start-btn {
        background: #ea580c; color: #fff; border: none; padding: 12px;
        border-radius: 8px; font-size: 14px; font-weight: 600;
        cursor: pointer; transition: background 0.2s;
      }
      .snsp-start-btn:hover { background: #c2410c; }
      .snsp-start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .snsp-msg {
        max-width: 85%; padding: 10px 14px; border-radius: 12px;
        font-size: 13px; line-height: 1.5; word-wrap: break-word;
      }
      .snsp-msg-visitor {
        align-self: flex-end; background: #ea580c; color: #fff;
        border-bottom-right-radius: 4px;
      }
      .snsp-msg-agent, .snsp-msg-ai {
        align-self: flex-start;
        background: rgba(51,65,85,0.55);
        border: 1px solid rgba(148,163,184,0.15);
        border-bottom-left-radius: 4px;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      }
      .snsp-msg-ai { border-color: rgba(148,163,184,0.2); }
      .snsp-msg-time {
        font-size: 10px; color: #64748b; margin-top: 2px;
      }
      .snsp-typing {
        align-self: flex-start; padding: 10px 14px;
        background: rgba(51,65,85,0.55); border: 1px solid rgba(148,163,184,0.15);
        border-radius: 12px; font-size: 13px; color: #94a3b8;
      }
      .snsp-input-area {
        padding: 12px; background: rgba(15,23,42,0.6);
        border-top: 1px solid rgba(148,163,184,0.12); display: flex; gap: 8px;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      }
      .snsp-input-area input {
        flex: 1; background: rgba(30,41,59,0.5); border: 1px solid rgba(148,163,184,0.2);
        color: #e2e8f0; padding: 10px 12px; border-radius: 8px;
        font-size: 14px; outline: none;
      }
      .snsp-input-area input:focus { border-color: #ea580c; }
      .snsp-input-area input::placeholder { color: #64748b; }
      .snsp-send-btn {
        background: #ea580c; border: none; color: #fff;
        width: 40px; border-radius: 8px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s;
      }
      .snsp-send-btn:hover { background: #c2410c; }
      .snsp-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .snsp-powered {
        text-align: center; padding: 6px; font-size: 10px;
        color: #64748b; background: rgba(15,23,42,0.4);
      }
      .snsp-powered a { color: #94a3b8; text-decoration: none; }
      .snsp-faq-tiles {
        display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0;
      }
      .snsp-faq-tile {
        background: rgba(51,65,85,0.5); color: #e2e8f0;
        border: 1px solid rgba(148,163,184,0.15);
        padding: 6px 12px; border-radius: 16px; font-size: 12px;
        cursor: pointer; transition: background 0.2s; line-height: 1.4;
      }
      .snsp-faq-tile:hover { background: rgba(71,85,105,0.6); }
    `;
    document.head.appendChild(style);
  }

  // ── DOM ─────────────────────────────────────────────────
  function createWidget() {
    // Bubble — orange with filled chat icon
    const bubble = document.createElement('div');
    bubble.id = 'snsp-chat-bubble';
    bubble.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><span class="badge" id="snspBadge">0</span>';
    bubble.onclick = toggleChat;
    document.body.appendChild(bubble);

    // Window
    const win = document.createElement('div');
    win.id = 'snsp-chat-window';
    win.innerHTML = `
      <div class="snsp-header">
        <div class="snsp-header-title"><span class="dot"></span> SweepNspect Chat</div>
        <button class="snsp-close" onclick="document.getElementById('snsp-chat-window').classList.remove('open')">&times;</button>
      </div>
      <div class="snsp-body" id="snspBody"></div>
    `;
    document.body.appendChild(win);

    renderIntro();
  }

  function toggleChat() {
    const win = document.getElementById('snsp-chat-window');
    state.open = !win.classList.contains('open');
    win.classList.toggle('open', state.open);
  }

  function renderIntro() {
    const body = document.getElementById('snspBody');
    body.innerHTML = `
      <div class="snsp-intro">
        <h3>Hi there! \u{1F44B}</h3>
        <p>Have a question about chimney inspections? We're here to help.</p>
        <input type="text" id="snspName" placeholder="Your name" value="${esc(state.visitor.name)}">
        <input type="email" id="snspEmail" placeholder="Email (optional)" value="${esc(state.visitor.email)}">
        <button class="snsp-start-btn" id="snspStartBtn" onclick="window._snspStart()">Start Chat</button>
      </div>
    `;
  }

  window._snspStart = async function() {
    const nameEl = document.getElementById('snspName');
    const emailEl = document.getElementById('snspEmail');
    const btn = document.getElementById('snspStartBtn');

    const name = (nameEl.value || '').trim();
    if (!name) { nameEl.style.borderColor = '#ea580c'; nameEl.focus(); return; }

    state.visitor.name = name;
    state.visitor.email = (emailEl.value || '').trim();

    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
      const res = await post('/api/chat/start', { name: state.visitor.name, email: state.visitor.email });
      if (res.ok && res.sessionId) {
        state.sessionId = res.sessionId;
        state.phase = 'chat';
        renderChat();
        startPolling();
      } else {
        btn.textContent = 'Error \u2014 retry';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = 'Connection failed \u2014 retry';
      btn.disabled = false;
    }
  };

  function renderChat() {
    const body = document.getElementById('snspBody');
    body.innerHTML = `
      <div id="snspMessages" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-bottom:8px"></div>
      <div class="snsp-input-area">
        <input type="text" id="snspInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter')window._snspSend()">
        <button class="snsp-send-btn" id="snspSendBtn" onclick="window._snspSend()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="snsp-powered">Powered by <a href="https://sweepnspect.com" target="_blank">SweepNspect</a></div>
    `;

    // Add welcome message then FAQ tiles
    addLocalMessage('agent', 'Hi ' + esc(state.visitor.name) + '! How can we help you today?');
    showFaqTiles();
    document.getElementById('snspInput').focus();
  }

  // ── FAQ Quick Tiles ───────────────────────────────────────
  function showFaqTiles() {
    const msgs = document.getElementById('snspMessages');
    if (!msgs) return;
    const tiles = document.createElement('div');
    tiles.className = 'snsp-faq-tiles';
    tiles.id = 'snspFaqTiles';
    var questions = [
      'How much does it cost?',
      'What is the Founding 25?',
      'Does it work offline?',
      'What devices supported?',
    ];
    questions.forEach(function(q) {
      var tile = document.createElement('span');
      tile.className = 'snsp-faq-tile';
      tile.textContent = q;
      tile.onclick = function() {
        var input = document.getElementById('snspInput');
        if (input) input.value = q;
        window._snspSend();
      };
      tiles.appendChild(tile);
    });
    msgs.appendChild(tiles);
  }

  window._snspSend = async function() {
    const input = document.getElementById('snspInput');
    if (!input || state.sending) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    state.sending = true;
    addLocalMessage('visitor', text);

    try {
      await post('/api/chat/message', { sessionId: state.sessionId, text });
    } catch {}

    state.sending = false;
    input.focus();
  };

  function addLocalMessage(from, text) {
    state.messages.push({ from, text, ts: new Date().toISOString() });
    renderMessages();
  }

  function renderMessages() {
    const el = document.getElementById('snspMessages');
    if (!el) return;
    el.innerHTML = state.messages.map(m => {
      const cls = m.from === 'visitor' ? 'snsp-msg-visitor' : m.from === 'ai' ? 'snsp-msg-ai' : 'snsp-msg-agent';
      const label = m.from === 'visitor' ? '' : m.from === 'ai' ? '<div style="font-size:10px;color:#94a3b8;margin-bottom:2px">AI Assistant</div>' : '<div style="font-size:10px;color:#94a3b8;margin-bottom:2px">Support</div>';
      return `<div class="snsp-msg ${cls}">${label}${esc(m.text)}</div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  // ── Polling ─────────────────────────────────────────────
  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(poll, POLL_INTERVAL);
  }

  async function poll() {
    if (!state.sessionId) return;
    try {
      const data = await get(`/api/chat/messages?session=${state.sessionId}&after=${encodeURIComponent(state.lastTs)}`);
      if (data.messages && data.messages.length > 0) {
        for (const m of data.messages) {
          // Skip visitor messages (we already have those locally)
          if (m.from === 'visitor') {
            if (m.ts > state.lastTs) state.lastTs = m.ts;
            continue;
          }
          // Deduplicate
          if (!state.messages.find(existing => existing.id === m.id)) {
            state.messages.push(m);
          }
          if (m.ts > state.lastTs) state.lastTs = m.ts;
        }
        renderMessages();
      }
      if (data.status === 'ended') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        addLocalMessage('agent', 'This chat session has ended. Thanks for reaching out!');
      }
    } catch {}
  }

  // ── HTTP helpers ────────────────────────────────────────
  async function post(path, body) {
    const res = await fetch(WORKER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function get(path) {
    const res = await fetch(WORKER_URL + path);
    return res.json();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ── Init ────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    injectStyles();
    createWidget();
  }
})();
