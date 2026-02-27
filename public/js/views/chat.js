// ══════════════════════════════════════════════════════════
// Chat View — Direct LLM Chat Interface
// Routes through AI Proxy (port 8889) → Claude CLI
// Renders AI responses as formatted markdown
// ══════════════════════════════════════════════════════════
const ChatView = {
  messages: [],
  sending: false,

  render(container) {
    container.innerHTML = `
      <div class="chat-view">
        <div class="chat-header">
          <div class="chat-header-info">
            <span class="chat-header-dot" id="chatStatusDot"></span>
            <span id="chatStatusText">Connecting...</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="ChatView.clearChat()" title="Clear chat">Clear</button>
        </div>
        <div class="chat-messages" id="chatMessages">
          <div class="chat-welcome">
            <div class="chat-welcome-icon">C</div>
            <div class="chat-welcome-text">Claude is ready. Ask anything about SweepNspect, inspect tickets, check system status, or get help with code.</div>
          </div>
        </div>
        <div class="chat-input-area">
          <button class="chat-mic-btn" id="chatMicBtn" onclick="ChatView.toggleMic()" title="Voice input">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <textarea class="chat-input" id="chatInput" rows="1" placeholder="Message Claude..." onkeydown="ChatView.onKey(event)"></textarea>
          <button class="chat-send-btn" id="chatSendBtn" onclick="ChatView.send()">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    `;

    this.checkStatus();
    this.renderMessages();

    setTimeout(() => {
      const input = document.getElementById('chatInput');
      if (input) input.focus();
    }, 100);
  },

  async checkStatus() {
    const dot = document.getElementById('chatStatusDot');
    const text = document.getElementById('chatStatusText');
    if (!dot || !text) return;

    try {
      const res = await App.api('ai/status').catch(() => null);
      if (res && res.available) {
        dot.className = 'chat-header-dot online';
        text.textContent = 'Claude Online';
      } else {
        dot.className = 'chat-header-dot offline';
        text.textContent = 'AI Proxy Offline';
      }
    } catch {
      dot.className = 'chat-header-dot offline';
      text.textContent = 'Cannot reach AI';
    }
  },

  onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  },

  async send() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (!input || this.sending) return;

    const text = input.value.trim();
    if (!text) return;

    this.messages.push({ role: 'user', text, ts: new Date().toISOString() });
    input.value = '';
    input.style.height = 'auto';
    this.sending = true;
    if (btn) btn.disabled = true;

    this.messages.push({ role: 'assistant', text: '', ts: new Date().toISOString(), pending: true });
    this.renderMessages();

    try {
      // Send conversation history (exclude the pending placeholder)
      const history = this.messages
        .filter(m => !m.pending && m.text)
        .slice(0, -1) // exclude current user msg (sent as prompt)
        .map(m => ({ role: m.role, text: m.text }));

      const res = await App.api('ai/chat', {
        method: 'POST',
        body: { prompt: text, messages: history }
      });

      const last = this.messages[this.messages.length - 1];
      if (last.pending) {
        last.text = res.answer || res.error || 'No response';
        last.speech = res.speech || '';
        last.actions = res.actions || [];
        last.pending = false;
        last.error = !!res.error;
        // Speak the conversational version (not the markdown)
        if (!last.error && HubTTS.enabled) {
          const speechText = last.speech || last.text;
          HubTTS.speak(speechText, { raw: !!last.speech });
        }
      }
    } catch (err) {
      const last = this.messages[this.messages.length - 1];
      if (last.pending) {
        last.text = 'Error: ' + (err.message || 'Request failed');
        last.pending = false;
        last.error = true;
      }
    }

    this.sending = false;
    if (btn) btn.disabled = false;
    this.renderMessages();

    if (input) input.focus();
  },

  copyMsg(idx) {
    const m = this.messages[idx];
    if (!m) return;
    navigator.clipboard.writeText(m.text).then(() => {
      const btns = document.querySelectorAll('.chat-copy-btn');
      const btn = btns[Math.floor(idx / 2)]; // AI messages are every other
      if (btn) {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 1500);
      }
    });
  },

  toggleMic() {
    if (!HubSTT.supported) {
      HubNotify.toast('Speech recognition not supported in this browser', 'error');
      return;
    }

    HubSTT.toggle({
      onResult: (text, isFinal) => {
        const input = document.getElementById('chatInput');
        if (!input) return;
        input.value = text;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';

        // Auto-send on final result (after silence)
        if (isFinal && text.trim()) {
          HubSTT.stop();
          this.send();
        }
      },
      onStateChange: (listening) => {
        const btn = document.getElementById('chatMicBtn');
        if (btn) btn.classList.toggle('mic-active', listening);
        const input = document.getElementById('chatInput');
        if (input) input.placeholder = listening ? 'Listening...' : 'Message Claude...';
      }
    });
  },

  clearChat() {
    this.messages = [];
    this.renderMessages();
  },

  renderMessages() {
    const el = document.getElementById('chatMessages');
    if (!el) return;

    if (this.messages.length === 0) {
      el.innerHTML = `
        <div class="chat-welcome">
          <div class="chat-welcome-icon">C</div>
          <div class="chat-welcome-text">Claude is ready. Ask anything about SweepNspect, inspect tickets, check system status, or get help with code.</div>
        </div>
      `;
      return;
    }

    el.innerHTML = this.messages.map((m, i) => {
      const cls = m.role === 'user' ? 'chat-msg-user' : 'chat-msg-ai';
      const errorCls = m.error ? ' chat-msg-error' : '';
      if (m.pending) {
        return `<div class="chat-msg ${cls}"><div class="chat-msg-bubble"><span class="chat-typing">Thinking...</span></div></div>`;
      }

      // User messages: plain escaped text
      // AI messages: rendered markdown + copy button
      const content = m.role === 'user'
        ? `<div class="chat-msg-text">${App.esc(m.text)}</div>`
        : `<div class="chat-md">${this.renderMarkdown(m.text)}</div>`;

      const copyBtn = m.role === 'assistant'
        ? `<button class="chat-copy-btn" onclick="ChatView.copyMsg(${i})" title="Copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
           </button>`
        : '';

      return `
        <div class="chat-msg ${cls}${errorCls}">
          <div class="chat-msg-bubble">${content}${copyBtn}</div>
          <div class="chat-msg-time">${App.timeAgo(m.ts)}</div>
        </div>
      `;
    }).join('');

    el.scrollTop = el.scrollHeight;
  },

  // ── Lightweight Markdown Renderer ──
  // Handles: headers, bold, italic, code blocks, inline code, lists, links, line breaks
  renderMarkdown(text) {
    if (!text) return '';

    // Escape HTML first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`;
    });

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4 class="chat-h">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="chat-h">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="chat-h">$1</h2>');

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr class="chat-hr">');

    // Bold + Italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Unordered lists
    html = html.replace(/^[*\-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul class="chat-list">$1</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Links (but not already inside tags)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="chat-link">$1</a>');

    // Paragraphs — double newline becomes paragraph break
    html = html.replace(/\n\n/g, '</p><p>');

    // Single newlines become <br> (outside of blocks)
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>\s*(<h[234])/g, '$1');
    html = html.replace(/(<\/h[234]>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<pre)/g, '$1');
    html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<ul)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<hr)/g, '$1');

    return html;
  },

  onWsMessage() {},
  onStats() {}
};
