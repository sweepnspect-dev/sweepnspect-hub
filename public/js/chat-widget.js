/**
 * SweepNspect Live Chat Widget — Phone Frame, App-Matched
 * Self-contained, no dependencies
 * Drop-in: <script src="...chat-widget.js"></script>
 */
(function() {
  'use strict';

  const WORKER_URL = 'https://sweepnspect-webhook.sweepnspect.workers.dev';
  const POLL_INTERVAL = 4000;

  let state = {
    open: false,
    phase: 'intro',
    sessionId: null,
    visitor: { name: '', email: '' },
    messages: [],
    lastTs: '1970-01-01T00:00:00.000Z',
    pollTimer: null,
    sending: false,
  };

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* ── Bubble ── */
      #snsp-chat-bubble {
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        width: 60px; height: 60px; border-radius: 50%;
        background: #ea580c; color: #fff; border: none;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 20px rgba(234,88,12,0.45);
        transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
      }
      #snsp-chat-bubble:hover {
        transform: scale(1.08); background: #c2410c;
        box-shadow: 0 6px 28px rgba(234,88,12,0.55);
      }
      #snsp-chat-bubble .badge {
        position: absolute; top: -4px; right: -4px;
        background: #dc2626; color: #fff; font-size: 11px;
        width: 20px; height: 20px; border-radius: 50%;
        display: none; align-items: center; justify-content: center;
      }

      /* ── Phone Frame ── */
      #snsp-chat-window {
        position: fixed; bottom: 92px; right: 20px; z-index: 99998;
        width: 310px; max-width: calc(100vw - 32px);
        height: 560px; max-height: calc(100vh - 120px);
        background: linear-gradient(165deg, #28282e 0%, #1a1a1e 12%, #101012 35%, #0c0c0e 65%, #141416 88%, #222226 100%);
        border-radius: 40px; padding: 6px;
        border: 3px solid; border-color: #606068 #48484e #2a2a30 #48484e;
        box-shadow:
          -12px 16px 45px rgba(0,0,0,0.6), 0 8px 30px rgba(0,0,0,0.4),
          0 0 0 1px rgba(140,140,150,0.2),
          inset 2px 2px 0 rgba(255,255,255,0.12), inset 0 2px 6px rgba(255,255,255,0.06),
          inset -2px -2px 0 rgba(0,0,0,0.6), inset 0 -3px 8px rgba(0,0,0,0.3);
        display: none; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #snsp-chat-window.open { display: flex; }
      #snsp-chat-window::before {
        content: ''; position: absolute; right: -5px; top: 100px;
        width: 3px; height: 40px;
        background: linear-gradient(180deg, #5a5a62 0%, #3c3c42 40%, #3c3c42 60%, #5a5a62 100%);
        border-radius: 0 3px 3px 0; box-shadow: 1px 0 3px rgba(0,0,0,0.5);
      }
      #snsp-chat-window::after {
        content: ''; position: absolute; left: -5px; top: 80px;
        width: 3px; height: 28px;
        background: linear-gradient(180deg, #5a5a62 0%, #3c3c42 40%, #3c3c42 60%, #5a5a62 100%);
        border-radius: 3px 0 0 3px; box-shadow: -1px 0 3px rgba(0,0,0,0.5);
      }

      /* ── Screen ── */
      .snsp-screen {
        flex: 1; display: flex; flex-direction: column;
        background: #1e3a5f; border-radius: 34px; overflow: hidden;
        position: relative;
      }
      .snsp-camera {
        width: 10px; height: 10px; background: #06060a;
        border-radius: 50%; position: absolute; top: 10px; left: 50%;
        transform: translateX(-50%); z-index: 10;
        border: 1.5px solid #1c1c22;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.4);
      }

      /* ── Status Bar ── */
      .snsp-statusbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 20px 2px; font-size: 10px; color: #cbd5e1;
        background: #1e3a5f; min-height: 26px;
      }
      .snsp-statusbar-time { font-weight: 600; color: #fff; }
      .snsp-statusbar-icons { display: flex; gap: 4px; align-items: center; }
      .snsp-statusbar-icons svg { opacity: 0.8; }

      /* ── App Bar (navy) ── */
      .snsp-header {
        background: #1e3a5f; padding: 8px 14px 12px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .snsp-header-left { display: flex; align-items: center; gap: 8px; }
      .snsp-header-logo { height: 24px; width: auto; display: block; }
      .snsp-header-title {
        font-weight: 600; font-size: 14px; color: #fff;
        display: flex; align-items: center; gap: 6px;
      }
      .snsp-header-title .dot {
        width: 7px; height: 7px; border-radius: 50%; background: #4ade80;
      }
      .snsp-close {
        background: none; border: none; color: #94a3b8; cursor: pointer;
        font-size: 20px; padding: 2px 6px; border-radius: 6px; line-height: 1;
      }
      .snsp-close:hover { color: #fff; background: rgba(255,255,255,0.1); }

      /* ── Chat Body (app bg) ── */
      .snsp-body {
        flex: 1; overflow-y: auto; padding: 12px 10px;
        display: flex; flex-direction: column; gap: 8px;
        background: #eaeff4; color: #0f172a;
      }

      /* ── Intro ── */
      .snsp-intro {
        display: flex; flex-direction: column; gap: 10px;
        justify-content: center; flex: 1; padding: 0 4px;
      }
      .snsp-intro h3 { margin: 0; font-size: 16px; color: #1e293b; }
      .snsp-intro p { margin: 0; font-size: 13px; color: #64748b; line-height: 1.4; }
      .snsp-intro input {
        background: #fff; border: 1px solid #cbd5e1; color: #1e293b;
        padding: 11px 14px; border-radius: 12px; font-size: 14px;
        outline: none; width: 100%; box-sizing: border-box;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }
      .snsp-intro input:focus { border-color: #ea580c; box-shadow: 0 0 0 2px rgba(234,88,12,0.15); }
      .snsp-intro input::placeholder { color: #94a3b8; }
      .snsp-start-btn {
        background: #ea580c; color: #fff; border: none; padding: 12px;
        border-radius: 12px; font-size: 14px; font-weight: 600;
        cursor: pointer; transition: background 0.2s;
        box-shadow: 0 2px 8px rgba(234,88,12,0.25);
      }
      .snsp-start-btn:hover { background: #c2410c; }
      .snsp-start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* ── Messages (card style) ── */
      .snsp-msg {
        max-width: 82%; padding: 10px 14px; font-size: 13px;
        line-height: 1.5; word-wrap: break-word;
      }
      .snsp-msg-visitor {
        align-self: flex-end; background: #ea580c; color: #fff;
        border-radius: 16px 16px 4px 16px;
        box-shadow: 0 1px 4px rgba(234,88,12,0.2);
      }
      .snsp-msg-agent, .snsp-msg-ai {
        align-self: flex-start; background: #fff; color: #1e293b;
        border-radius: 16px 16px 16px 4px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
      }

      /* ── Input Area (navy) ── */
      .snsp-input-area {
        padding: 8px 10px; background: #1e3a5f;
        display: flex; gap: 8px; align-items: center;
      }
      .snsp-input-area input {
        flex: 1; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18);
        color: #fff; padding: 9px 14px; border-radius: 20px;
        font-size: 13px; outline: none;
      }
      .snsp-input-area input:focus { border-color: #ea580c; background: rgba(255,255,255,0.18); }
      .snsp-input-area input::placeholder { color: rgba(255,255,255,0.5); }
      .snsp-send-btn {
        background: #ea580c; border: none; color: #fff;
        width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; flex-shrink: 0;
        box-shadow: 0 2px 6px rgba(234,88,12,0.3);
      }
      .snsp-send-btn:hover { background: #c2410c; }
      .snsp-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

      /* ── Footer ── */
      .snsp-footer {
        background: #1e3a5f; text-align: center; padding: 4px 0 2px;
        font-size: 9px; color: rgba(255,255,255,0.35);
      }
      .snsp-footer a { color: rgba(255,255,255,0.5); text-decoration: none; }
      .snsp-footer a:hover { color: rgba(255,255,255,0.7); }

      /* ── Home Bar (navy, tight) ── */
      .snsp-homebar {
        display: flex; justify-content: center; padding: 4px 0 8px;
        background: #1e3a5f;
      }
      .snsp-homebar-pill {
        width: 90px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2);
      }

      /* ── FAQ Tiles (app button style) ── */
      .snsp-faq-tiles {
        display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0;
      }
      .snsp-faq-tile {
        background: #fff; color: #334155; border: 1px solid #cbd5e1;
        padding: 7px 12px; border-radius: 20px; font-size: 11px;
        cursor: pointer; transition: all 0.15s; line-height: 1.3;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }
      .snsp-faq-tile:hover { background: #f1f5f9; border-color: #ea580c; color: #ea580c; }
    `;
    document.head.appendChild(style);
  }

  function createWidget() {
    const bubble = document.createElement('div');
    bubble.id = 'snsp-chat-bubble';
    bubble.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.837 1.37 5.378 3.527 7.09L4 22l4.322-2.16C9.478 20.27 10.707 20.486 12 20.486c5.523 0 10-4.145 10-9.243S17.523 2 12 2z"/></svg><span class="badge" id="snspBadge">0</span>';
    bubble.onclick = toggleChat;
    document.body.appendChild(bubble);

    const win = document.createElement('div');
    win.id = 'snsp-chat-window';
    win.innerHTML = `
      <div class="snsp-screen">
        <div class="snsp-camera"></div>
        <div class="snsp-statusbar">
          <span class="snsp-statusbar-time">9:41</span>
          <span class="snsp-statusbar-icons">
            <svg width="12" height="12" fill="#cbd5e1" viewBox="0 0 24 24"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 00-6 0zm-4-4l2 2a7.074 7.074 0 0110 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>
            <svg width="12" height="12" fill="#cbd5e1" viewBox="0 0 24 24"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
          </span>
        </div>
        <div class="snsp-header">
          <div class="snsp-header-left">
            <img src="https://sweepnspect.com/images/sweepnspect-logo-TransBG.png" alt="" class="snsp-header-logo">
            <div class="snsp-header-title"><span class="dot"></span> Live Chat</div>
          </div>
          <button class="snsp-close" onclick="document.getElementById('snsp-chat-window').classList.remove('open')">&times;</button>
        </div>
        <div class="snsp-body" id="snspBody"></div>
        <div class="snsp-footer">Powered by <a href="https://sweepnspect.com" target="_blank">SweepNspect</a></div>
        <div class="snsp-homebar"><div class="snsp-homebar-pill"></div></div>
      </div>
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
    document.getElementById('snspBody').innerHTML = `
      <div class="snsp-intro">
        <h3>Hi there! \u{1F44B}</h3>
        <p>Have a question about SweepNspect? We're here to help.</p>
        <input type="text" id="snspName" placeholder="Your name" value="${esc(state.visitor.name)}">
        <input type="email" id="snspEmail" placeholder="Email (optional)" value="${esc(state.visitor.email)}">
        <button class="snsp-start-btn" id="snspStartBtn" onclick="window._snspStart()">Start Chat</button>
      </div>
    `;
  }

  window._snspStart = async function() {
    const nameEl = document.getElementById('snspName'), btn = document.getElementById('snspStartBtn');
    const name = (nameEl.value || '').trim();
    if (!name) { nameEl.style.borderColor = '#ea580c'; nameEl.focus(); return; }
    state.visitor.name = name;
    state.visitor.email = (document.getElementById('snspEmail').value || '').trim();
    btn.disabled = true; btn.textContent = 'Connecting...';
    try {
      const res = await post('/api/chat/start', { name: state.visitor.name, email: state.visitor.email });
      if (res.ok && res.sessionId) { state.sessionId = res.sessionId; state.phase = 'chat'; renderChat(); startPolling(); }
      else { btn.textContent = 'Error \u2014 retry'; btn.disabled = false; }
    } catch { btn.textContent = 'Connection failed \u2014 retry'; btn.disabled = false; }
  };

  function renderChat() {
    document.getElementById('snspBody').innerHTML = `
      <div id="snspMessages" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-bottom:4px"></div>
      <div class="snsp-input-area">
        <input type="text" id="snspInput" placeholder="Message..." onkeydown="if(event.key==='Enter')window._snspSend()">
        <button class="snsp-send-btn" onclick="window._snspSend()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;
    addLocalMessage('agent', 'Hi ' + esc(state.visitor.name) + '! How can we help you today?');
    showFaqTiles();
    document.getElementById('snspInput').focus();
  }

  function showFaqTiles() {
    const msgs = document.getElementById('snspMessages');
    if (!msgs) return;
    const tiles = document.createElement('div');
    tiles.className = 'snsp-faq-tiles'; tiles.id = 'snspFaqTiles';
    ['How much does it cost?','What is the Founding 25?','Does it work offline?','What devices supported?'].forEach(function(q) {
      var t = document.createElement('span'); t.className = 'snsp-faq-tile'; t.textContent = q;
      t.onclick = function() { var i = document.getElementById('snspInput'); if (i) i.value = q; window._snspSend(); };
      tiles.appendChild(t);
    });
    msgs.appendChild(tiles);
  }

  window._snspSend = async function() {
    const input = document.getElementById('snspInput');
    if (!input || state.sending) return;
    const text = input.value.trim(); if (!text) return;
    input.value = ''; state.sending = true;
    addLocalMessage('visitor', text);
    try { await post('/api/chat/message', { sessionId: state.sessionId, text }); } catch {}
    state.sending = false; input.focus();
  };

  function addLocalMessage(from, text) { state.messages.push({ from, text, ts: new Date().toISOString() }); renderMessages(); }

  function renderMessages() {
    const el = document.getElementById('snspMessages'); if (!el) return;
    el.innerHTML = state.messages.map(m => {
      const cls = m.from === 'visitor' ? 'snsp-msg-visitor' : m.from === 'ai' ? 'snsp-msg-ai' : 'snsp-msg-agent';
      const label = m.from === 'visitor' ? '' : m.from === 'ai' ? '<div style="font-size:10px;color:#94a3b8;margin-bottom:2px">AI Assistant</div>' : '<div style="font-size:10px;color:#94a3b8;margin-bottom:2px">Support</div>';
      return `<div class="snsp-msg ${cls}">${label}${esc(m.text)}</div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function startPolling() { if (state.pollTimer) return; state.pollTimer = setInterval(poll, POLL_INTERVAL); }
  async function poll() {
    if (!state.sessionId) return;
    try {
      const data = await get(`/api/chat/messages?session=${state.sessionId}&after=${encodeURIComponent(state.lastTs)}`);
      if (data.messages && data.messages.length > 0) {
        for (const m of data.messages) {
          if (m.from === 'visitor') { if (m.ts > state.lastTs) state.lastTs = m.ts; continue; }
          if (!state.messages.find(x => x.id === m.id)) state.messages.push(m);
          if (m.ts > state.lastTs) state.lastTs = m.ts;
        }
        renderMessages();
      }
      if (data.status === 'ended') { clearInterval(state.pollTimer); state.pollTimer = null; addLocalMessage('agent', 'Chat ended. Thanks for reaching out!'); }
    } catch {}
  }

  async function post(path, body) { const r = await fetch(WORKER_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  async function get(path) { const r = await fetch(WORKER_URL + path); return r.json(); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  function init() { injectStyles(); createWidget(); }
})();
