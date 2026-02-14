// ── AI Chat Widget ──────────────────────────────────────
// Reusable chat component for guide.html and dashboard
// Calls POST /api/ai/ask with user question, displays streamed response

const AIChat = {
  containerId: null,
  available: false,

  async init(containerId) {
    this.containerId = containerId;
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="ai-chat">
        <div class="ai-chat-header">
          <div class="ai-icon">AI</div>
          <span>Hub Assistant</span>
          <span class="ai-status" id="aiStatus">checking...</span>
        </div>
        <div class="ai-messages" id="aiMessages">
        </div>
        <div class="ai-input-row">
          <input type="text" class="ai-input" id="aiInput" placeholder="Ask about tickets, revenue, subscribers..." autocomplete="off">
          <button class="ai-send" id="aiSend">Ask</button>
        </div>
      </div>
    `;

    // Bind events
    document.getElementById('aiSend').addEventListener('click', () => this.ask());
    document.getElementById('aiInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.ask();
    });

    // Check AI status
    await this.checkStatus();
  },

  async checkStatus() {
    const statusEl = document.getElementById('aiStatus');
    try {
      const res = await fetch('/api/ai/status');
      const data = await res.json();
      this.available = data.available;
      if (data.available) {
        statusEl.textContent = 'online';
        statusEl.className = 'ai-status ai-online';
        this.addMessage('system', 'AI Assistant ready. Ask me anything about your Hub — tickets, revenue, subscribers, Clauser status, or how the system works.');
      } else {
        statusEl.textContent = 'no API key';
        statusEl.className = 'ai-status ai-offline';
        this.addMessage('system',
          '<strong>API key needed.</strong> Set <code>ANTHROPIC_API_KEY</code> when starting the Hub:<br><br>' +
          '<code>ANTHROPIC_API_KEY=sk-ant-... node server.js</code><br><br>' +
          'The AI assistant uses your Anthropic API to answer questions with live Hub data.'
        );
      }
    } catch (e) {
      statusEl.textContent = 'offline';
      statusEl.className = 'ai-status ai-offline';
      this.addMessage('system', 'Cannot reach the Hub server. Is it running?');
    }
  },

  async ask() {
    const input = document.getElementById('aiInput');
    const btn = document.getElementById('aiSend');
    const q = input.value.trim();
    if (!q) return;

    input.value = '';
    this.addMessage('user', q);

    if (!this.available) {
      this.addMessage('system', 'AI is not available. Configure <code>ANTHROPIC_API_KEY</code> to enable.');
      return;
    }

    btn.disabled = true;
    btn.textContent = '...';
    const thinkingId = this.addMessage('thinking', 'Thinking...');

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      });

      const data = await res.json();

      // Remove thinking message
      const thinkingEl = document.getElementById(thinkingId);
      if (thinkingEl) thinkingEl.remove();

      if (data.error) {
        this.addMessage('error', 'Error: ' + data.error + (data.hint ? '<br><em>' + data.hint + '</em>' : ''));
      } else {
        // Convert markdown-ish to HTML
        const html = this.formatResponse(data.answer);
        this.addMessage('assistant', html);
      }
    } catch (e) {
      const thinkingEl = document.getElementById(thinkingId);
      if (thinkingEl) thinkingEl.remove();
      this.addMessage('error', 'Failed to reach AI: ' + e.message);
    }

    btn.disabled = false;
    btn.textContent = 'Ask';
  },

  addMessage(type, text) {
    const msgs = document.getElementById('aiMessages');
    if (!msgs) return;
    const id = 'ai-msg-' + Date.now() + Math.random().toString(36).slice(2, 6);
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-' + type;
    div.id = id;
    div.innerHTML = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return id;
  },

  formatResponse(text) {
    // Simple markdown → HTML
    return text
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bullet lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      // Numbered lists
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      // Wrap
      .replace(/^/, '<p>').replace(/$/, '</p>')
      // Clean up empty tags
      .replace(/<p><\/p>/g, '')
      .replace(/<p><ul>/g, '<ul>')
      .replace(/<\/ul><\/p>/g, '</ul>');
  }
};
