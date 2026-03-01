// ══════════════════════════════════════════════════════════
// Comms View — Unified Communications
// Email (IMAP) + Facebook + Live Chat + SMS + Claude Sync
// ══════════════════════════════════════════════════════════
const CommsView = {
  messages: [],
  status: 'loading',
  activeSource: null,    // null = all, 'email', 'facebook', 'sms', 'livechat', 'sync'
  activeFilter: null,    // email category filter
  emailCategories: null, // cached from /api/inbox/categories
  openId: null,
  showArchived: false,
  livechatSessions: [],  // cached live chat sessions
  dndEnabled: false,     // DND mode state

  render(container, hash) {
    const parts = hash ? hash.split('/') : [];
    const detailId = parts.length > 1 ? parts[1] : null;

    container.innerHTML = `
      <div class="comms-view">
        <div class="comms-toolbar">
          <div class="comms-sources" id="commsSources">
            <button class="source-btn active" data-source="" onclick="CommsView.setSource(null)">
              All
            </button>
            <button class="source-btn" data-source="email" onclick="CommsView.setSource('email')">
              <span class="source-badge email"></span> Email
            </button>
            <button class="source-btn" data-source="facebook" onclick="CommsView.setSource('facebook')">
              <span class="source-badge facebook"></span> Facebook
            </button>
            <button class="source-btn" data-source="sms" onclick="CommsView.setSource('sms')">
              <span class="source-badge sms"></span> SMS
            </button>
            <button class="source-btn" data-source="livechat" onclick="CommsView.setSource('livechat')">
              <span class="source-badge livechat" style="background:#4ade80"></span> Live Chat
            </button>
            <button class="source-btn" data-source="sync" onclick="CommsView.setSource('sync')">
              <span class="source-badge sync"></span> Sync
            </button>
          </div>
          <div class="comms-toolbar-right">
            <button class="btn btn-sm btn-ghost comms-dnd-toggle" id="dndToggle" onclick="CommsView.toggleDnd()" title="Do Not Disturb — AI takes messages instead of pinging your phone" style="display:none">
              DND: Off
            </button>
            <button class="btn btn-sm btn-ghost" onclick="CommsView.refresh()">Refresh</button>
          </div>
        </div>

        <div class="comms-status" id="commsStatusBar">
          <span class="status-dot" id="commsDot"></span>
          <span id="commsStatusText">Loading...</span>
        </div>

        <div class="comms-filters" id="commsFilters" style="display:none"></div>

        <div class="comms-split">
          <div class="comms-stream" id="commsStream">
            <div class="empty-state"><p>Loading messages...</p></div>
          </div>
          <div class="comms-detail" id="commsDetail" style="display:none"></div>
        </div>
      </div>
    `;

    this.openId = detailId || null;
    this.load();
    this.loadDndState();
  },

  async load() {
    try {
      const params = new URLSearchParams();
      if (this.activeSource) params.set('source', this.activeSource);
      if (this.activeFilter) params.set('category', this.activeFilter);
      if (this.showArchived) params.set('archived', 'true');
      const qs = params.toString() ? '?' + params.toString() : '';

      // Load from all available sources
      const results = await Promise.allSettled([
        App.api('inbox' + qs),
        App.api('comms/facebook').catch(() => ({ messages: [] })),
        App.api('comms/sync').catch(() => ({ messages: [] })),
        App.api('comms/sms').catch(() => ({ messages: [] })),
        App.api('inbox/categories').catch(() => null),
        App.api('livechat/sessions').catch(() => ({ sessions: [] })),
      ]);

      // Merge all streams
      const emailData = results[0].status === 'fulfilled' ? results[0].value : { emails: [], status: 'error' };
      const fbData = results[1].status === 'fulfilled' ? results[1].value : { messages: [] };
      const syncData = results[2].status === 'fulfilled' ? results[2].value : { messages: [] };
      const smsData = results[3].status === 'fulfilled' ? results[3].value : { messages: [] };
      const categories = results[4].status === 'fulfilled' ? results[4].value : null;
      const livechatData = results[5].status === 'fulfilled' ? results[5].value : { sessions: [] };
      if (categories) this.emailCategories = categories;
      this.livechatSessions = livechatData.sessions || [];

      this.status = emailData.status || 'connected';

      // Normalize into unified format
      const unified = [];

      // Email messages — cross-route categorized emails to their source tabs
      (emailData.emails || []).forEach(e => {
        const cat = e.route?.category;
        let source = 'email';
        if (cat === 'facebook') source = 'facebook';
        else if (cat === 'livechat') source = 'livechat';

        unified.push({
          id: 'email-' + e.uid,
          source,
          from: e.from?.name || e.from?.address || 'Unknown',
          fromDetail: e.from?.address || '',
          subject: e.subject || '(no subject)',
          preview: e.snippet || '',
          date: e.date,
          unread: e.unread,
          category: cat,
          categoryLabel: e.route?.label,
          categoryCls: e.route?.cls,
          raw: e
        });
      });

      // Facebook messages
      (fbData.messages || []).forEach(f => {
        unified.push({
          id: 'fb-' + (f.id || f.messageId),
          source: 'facebook',
          from: f.from?.name || f.senderName || 'Facebook User',
          fromDetail: '',
          subject: f.message ? f.message.slice(0, 60) : 'Message',
          preview: f.message || '',
          date: f.created_time || f.timestamp,
          unread: f.unread || false,
          raw: f
        });
      });

      // SMS messages
      (smsData.messages || []).forEach(sm => {
        unified.push({
          id: 'sms-' + (sm.id || sm.timestamp),
          source: 'sms',
          from: sm.from || 'Unknown',
          fromDetail: sm.to || '',
          subject: sm.message ? sm.message.slice(0, 60) : 'SMS',
          preview: sm.message || '',
          date: sm.timestamp,
          unread: sm.unread || false,
          direction: sm.direction || 'inbound',
          raw: sm
        });
      });

      // Live Chat sessions
      (livechatData.sessions || []).forEach(lc => {
        const lastMsg = lc.messages && lc.messages.length > 0
          ? lc.messages[lc.messages.length - 1] : null;
        const preview = lastMsg ? lastMsg.text : 'Chat started';
        unified.push({
          id: 'livechat-' + lc.id,
          source: 'livechat',
          from: lc.visitor?.name || 'Visitor',
          fromDetail: lc.visitor?.email || '',
          subject: preview.slice(0, 60),
          preview,
          date: lc.lastActivity || lc.startedAt,
          unread: lc.status === 'active',
          status: lc.status,
          raw: lc,
        });
      });

      // Sync messages
      (syncData.messages || []).forEach(s => {
        unified.push({
          id: 'sync-' + (s.id || s.ts),
          source: 'sync',
          from: s.from || 'Claude Sync',
          fromDetail: s.device || '',
          subject: s.text ? s.text.slice(0, 60) : 'Sync message',
          preview: s.text || '',
          date: s.ts || s.timestamp,
          unread: false,
          raw: s
        });
      });

      // Sort: active livechats first, then everything by date descending
      unified.sort((a, b) => {
        const aActive = a.source === 'livechat' && a.status === 'active' ? 1 : 0;
        const bActive = b.source === 'livechat' && b.status === 'active' ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return new Date(b.date) - new Date(a.date);
      });

      // Apply source filter
      if (this.activeSource) {
        this.messages = unified.filter(m => m.source === this.activeSource);
      } else {
        this.messages = unified;
      }

      this.renderStatus(emailData);
      this.renderFilters();
      this.renderStream();

      // Auto-open detail if hash had an ID
      if (this.openId) {
        this.openMessage(this.openId);
      }
    } catch (err) {
      this.status = 'error';
      this.renderError(err.message);
    }
  },

  async refresh() {
    const btn = document.querySelector('.comms-toolbar-right .btn:last-child');
    if (btn) { btn.textContent = 'Refreshing...'; btn.disabled = true; }
    try {
      await App.api('inbox/check', { method: 'POST' }).catch(() => {});
      await this.load();
    } finally {
      if (btn) { btn.textContent = 'Refresh'; btn.disabled = false; }
    }
  },

  async loadDndState() {
    try {
      const data = await App.api('livechat/dnd');
      this.dndEnabled = !!data.enabled;
      this.renderDndButton();
    } catch { /* ignore */ }
  },

  renderDndButton() {
    // Toolbar toggle
    const btn = document.getElementById('dndToggle');
    if (btn) {
      btn.textContent = this.dndEnabled ? 'DND: On' : 'DND: Off';
      btn.style.background = this.dndEnabled ? 'var(--brick, #ef4444)' : '';
      btn.style.color = this.dndEnabled ? '#fff' : '';
      btn.style.display = (!this.activeSource || this.activeSource === 'livechat') ? '' : 'none';
    }
    // In-chat toggle
    const chatBtn = document.getElementById('chatDndToggle');
    if (chatBtn) {
      chatBtn.textContent = this.dndEnabled ? 'DND: On' : 'DND: Off';
      chatBtn.style.background = this.dndEnabled ? 'var(--brick)' : '';
      chatBtn.style.color = this.dndEnabled ? '#fff' : '';
    }
  },

  async toggleDnd() {
    const btn = document.getElementById('dndToggle');
    const newState = !this.dndEnabled;
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
    try {
      await App.api('livechat/dnd', { method: 'POST', body: { enabled: newState } });
      this.dndEnabled = newState;
      this.renderDndButton();
    } catch (err) {
      console.error('DND toggle failed:', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  setSource(source) {
    this.activeSource = source;
    // Update button states
    document.querySelectorAll('.source-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.source || '') === (source || ''));
    });
    // Show DND toggle only on Live Chat or All view
    const dndBtn = document.getElementById('dndToggle');
    if (dndBtn) dndBtn.style.display = (!source || source === 'livechat') ? '' : 'none';
    this.load();
  },

  renderStatus(emailData) {
    const dot = document.getElementById('commsDot');
    const text = document.getElementById('commsStatusText');
    if (!dot || !text) return;

    if (emailData.status === 'connected') {
      dot.className = 'status-dot online';
      const counts = [];
      if (emailData.total) counts.push(emailData.total + ' emails');
      if (emailData.unread) counts.push(emailData.unread + ' unread');
      text.textContent = (emailData.account || 'Email') + (counts.length ? ' \u2022 ' + counts.join(' \u2022 ') : '') + ' \u2022 All channels live';
    } else if (emailData.status === 'error') {
      dot.className = 'status-dot offline';
      text.textContent = 'Error: ' + (emailData.error || 'connection failed');
    } else if (emailData.status === 'disabled') {
      dot.className = 'status-dot offline';
      text.textContent = 'Email disabled \u2014 other channels active';
    } else {
      dot.className = 'status-dot';
      text.textContent = 'Connecting...';
    }
  },

  renderFilters() {
    const el = document.getElementById('commsFilters');
    if (!el) return;

    // Only show category filters when viewing email or all
    if (this.activeSource && this.activeSource !== 'email') {
      el.style.display = 'none';
      return;
    }

    if (!this.emailCategories || Object.keys(this.emailCategories).length === 0) {
      el.style.display = 'none';
      return;
    }

    el.style.display = '';
    const cats = this.emailCategories;
    el.innerHTML = `
      <button class="comms-filter-btn${!this.activeFilter ? ' active' : ''}" onclick="CommsView.setFilter(null)">All</button>
      ${Object.entries(cats).map(([key, cat]) =>
        `<button class="comms-filter-btn${this.activeFilter === key ? ' active' : ''}${cat.cls ? ' ' + cat.cls : ''}" onclick="CommsView.setFilter('${key}')">${cat.label || key}</button>`
      ).join('')}
    `;
  },

  setFilter(cat) {
    this.activeFilter = cat;
    this.load();
  },

  renderStream() {
    const el = document.getElementById('commsStream');
    if (!el) return;

    if (this.messages.length === 0) {
      const label = this.activeSource ? this.activeSource : 'all channels';
      el.innerHTML = `<div class="empty-state"><p>No messages from ${label}</p><p class="dim">Messages will appear here in real time</p></div>`;
      return;
    }

    let html = '';
    let lastSection = '';
    this.messages.forEach(msg => {
      // Section headers for livechat view
      if (this.activeSource === 'livechat') {
        const section = (msg.status === 'active') ? 'Active' : 'Ended';
        if (section !== lastSection) {
          html += `<div class="comms-section-header">${section}</div>`;
          lastSection = section;
        }
      }

      const activeCls = msg.id === this.openId ? ' active' : '';
      const unreadCls = msg.unread ? ' unread' : '';
      const modeBadge = msg.raw?.mode === 'agent' ? '<span style="font-size:9px;color:var(--green);font-weight:600;margin-left:4px">LIVE</span>'
        : msg.raw?.mode === 'transferring' ? '<span style="font-size:9px;color:#f59e0b;font-weight:600;margin-left:4px">WAITING</span>' : '';
      html += `
        <div class="comms-item${unreadCls}${activeCls}" onclick="CommsView.openMessage('${msg.id}')" data-id="${msg.id}">
          <div class="comms-item-dot${msg.unread ? ' unread' : ''}"></div>
          <span class="source-badge ${msg.source}"></span>
          <div class="comms-item-body">
            <div class="comms-item-from">${App.esc(msg.from)}${modeBadge}</div>
            <div class="comms-item-subject">${App.esc(msg.subject)}</div>
            ${msg.categoryLabel ? '<span class="inbox-tag ' + msg.categoryCls + '">' + msg.categoryLabel + '</span>' : ''}
          </div>
          <div class="comms-item-time">${App.timeAgo(msg.date)}</div>
        </div>
      `;
    });
    el.innerHTML = html;
  },

  async openMessage(id) {
    this.openId = id;
    const detail = document.getElementById('commsDetail');
    if (!detail) return;

    detail.style.display = 'block';
    detail.classList.add('mobile-open');
    detail.innerHTML = '<div class="comms-loading">Loading...</div>';

    // Highlight in stream
    document.querySelectorAll('.comms-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const msg = this.messages.find(m => m.id === id);
    if (!msg) {
      detail.innerHTML = '<div class="comms-loading">Message not found</div>';
      return;
    }

    // Mark as read in stream
    if (msg.unread) {
      msg.unread = false;
      const item = document.querySelector(`.comms-item[data-id="${id}"]`);
      if (item) {
        item.classList.remove('unread');
        const dot = item.querySelector('.comms-item-dot');
        if (dot) dot.classList.remove('unread');
      }
    }

    if (msg.source === 'email') {
      await this.renderEmailDetail(detail, msg);
    } else if (msg.source === 'facebook') {
      this.renderFbDetail(detail, msg);
    } else if (msg.source === 'sms') {
      this.renderSmsDetail(detail, msg);
    } else if (msg.source === 'livechat') {
      this.renderLivechatDetail(detail, msg);
    } else if (msg.source === 'sync') {
      this.renderSyncDetail(detail, msg);
    }
  },

  async renderEmailDetail(detail, msg) {
    try {
      const uid = msg.id.replace('email-', '');
      const email = await App.api('inbox/' + uid);
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const fromAddr = email.from?.address || '';
      const toList = (email.to || []).map(t => t.address).join(', ');
      const date = email.date ? new Date(email.date).toLocaleString() : '';
      const route = email.route;

      let linkedHtml = '';
      if (email.linkedTicket) {
        linkedHtml = `<a class="email-linked-badge badge-ticket" href="#tickets/${email.linkedTicket.id}">Ticket ${email.linkedTicket.id} (${email.linkedTicket.status})</a>`;
      } else if (email.linkedSubscriber) {
        linkedHtml = `<a class="email-linked-badge badge-subscriber" href="#customers/${email.linkedSubscriber.id}">${App.esc(email.linkedSubscriber.name)} (${email.linkedSubscriber.status})</a>`;
      }

      detail.innerHTML = `
        <div class="comms-detail-header">
          <button class="comms-back" onclick="CommsView.closeDetail()">&larr; Back</button>
          <span class="source-badge email"></span>
          <div class="comms-detail-meta">
            <div class="comms-detail-subject">
              ${route ? '<span class="inbox-tag ' + route.cls + '">' + route.label + '</span> ' : ''}${App.esc(email.subject)}
            </div>
            <div class="comms-detail-from">
              <strong>${App.esc(fromName)}</strong> &lt;${App.esc(fromAddr)}&gt;
            </div>
            <div class="comms-detail-info">
              To: ${App.esc(toList)} &middot; ${date}${route?.source ? ' &middot; Routed: ' + route.source : ''}
            </div>
            ${linkedHtml ? '<div class="comms-detail-linked">' + linkedHtml + '</div>' : ''}
          </div>
        </div>
        <div class="comms-detail-body"><pre>${App.esc(email.body || '(no text content)')}</pre></div>
        <div class="comms-reply">
          <div class="comms-reply-label">Reply to ${App.esc(fromName)}:</div>
          <textarea class="comms-reply-input" id="commsReplyInput" rows="4" placeholder="Type your reply..."></textarea>
          <div class="comms-reply-actions">
            <button class="btn btn-primary" id="commsReplyBtn" onclick="CommsView.sendEmailReply('${uid}')">Send Reply</button>
            <span class="comms-reply-status" id="commsReplyStatus"></span>
          </div>
        </div>
      `;
    } catch (err) {
      detail.innerHTML = `<div class="comms-loading">Error: ${App.esc(err.message)}</div>`;
    }
  },

  renderFbDetail(detail, msg) {
    const f = msg.raw;
    detail.innerHTML = `
      <div class="comms-detail-header">
        <button class="comms-back" onclick="CommsView.closeDetail()">&larr; Back</button>
        <span class="source-badge facebook"></span>
        <div class="comms-detail-meta">
          <div class="comms-detail-subject">${App.esc(msg.subject)}</div>
          <div class="comms-detail-from">${App.esc(msg.from)}</div>
          <div class="comms-detail-info">${App.timeAgo(msg.date)} &middot; Facebook</div>
        </div>
      </div>
      <div class="comms-detail-body">
        <pre>${App.esc(f.message || f.text || '(no content)')}</pre>
        ${f.attachments ? '<div class="comms-attachments">' + f.attachments.map(a => '<div class="comms-attachment">' + App.esc(a.name || a.url || 'Attachment') + '</div>').join('') + '</div>' : ''}
      </div>
    `;
  },

  renderSmsDetail(detail, msg) {
    const sm = msg.raw;
    const dir = sm.direction === 'outbound' ? 'Outbound' : 'Inbound';
    detail.innerHTML = `
      <div class="comms-detail-header">
        <button class="comms-back" onclick="CommsView.closeDetail()">&larr; Back</button>
        <span class="source-badge sms"></span>
        <div class="comms-detail-meta">
          <div class="comms-detail-subject">${dir} SMS</div>
          <div class="comms-detail-from">From: ${App.esc(sm.from || 'Unknown')} &middot; To: ${App.esc(sm.to || 'Unknown')}</div>
          <div class="comms-detail-info">${App.timeAgo(msg.date)} &middot; SMS</div>
        </div>
      </div>
      <div class="comms-detail-body">
        <pre>${App.esc(sm.message || sm.text || '(empty)')}</pre>
      </div>
    `;
  },

  renderSyncDetail(detail, msg) {
    const s = msg.raw;
    detail.innerHTML = `
      <div class="comms-detail-header">
        <button class="comms-back" onclick="CommsView.closeDetail()">&larr; Back</button>
        <span class="source-badge sync"></span>
        <div class="comms-detail-meta">
          <div class="comms-detail-subject">Sync Message</div>
          <div class="comms-detail-from">From: ${App.esc(s.from || 'Unknown')} &middot; Device: ${App.esc(s.device || 'unknown')}</div>
          <div class="comms-detail-info">${App.timeAgo(msg.date)} &middot; Claude Sync Protocol</div>
        </div>
      </div>
      <div class="comms-detail-body">
        <pre>${App.esc(s.text || s.body || '(empty)')}</pre>
        ${s.task ? '<div class="comms-sync-task"><strong>Task:</strong> ' + App.esc(s.task) + '</div>' : ''}
        ${s.status ? '<div class="comms-sync-status"><strong>Status:</strong> ' + App.esc(s.status) + '</div>' : ''}
      </div>
    `;
  },

  renderLivechatDetail(detail, msg) {
    const lc = msg.raw;
    const statusColor = lc.status === 'active' ? '#4ade80' : lc.status === 'ended' ? '#888' : '#f59e0b';
    const statusLabel = lc.status === 'active' ? 'Active' : lc.status === 'ended' ? 'Ended' : 'Waiting';

    detail.style.display = 'flex';
    detail.style.flexDirection = 'column';
    detail.style.overflow = 'hidden';

    detail.innerHTML = `
      <div class="comms-detail-header" style="flex-shrink:0;padding:10px 16px">
        <button class="comms-back" onclick="CommsView.closeDetail()">&larr;</button>
        <span class="source-badge livechat" style="background:${statusColor}"></span>
        <div class="comms-detail-meta">
          <div class="comms-detail-subject" style="font-size:14px">Chat with ${App.esc(msg.from)} <span style="color:${statusColor};font-size:11px">(${statusLabel})</span></div>
          <div class="comms-detail-info">${lc.messages?.length || 0} msgs &middot; ${App.timeAgo(lc.startedAt)}</div>
        </div>
      </div>
      <div class="comms-chat-thread" id="livechatThread" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
        ${(lc.messages || []).map(m => `
          <div class="comms-chat-msg ${m.from === 'visitor' ? 'from-visitor' : 'from-agent'}">
            <div class="comms-chat-sender">${App.esc(m.from === 'visitor' ? (lc.visitor?.name || 'Visitor') : m.from === 'ai' ? 'AI' : 'J')}</div>
            <div class="comms-chat-text">${App.esc(m.text || '')}</div>
            <div class="comms-chat-time">${m.ts ? App.timeAgo(m.ts) : ''}</div>
          </div>
        `).join('')}
      </div>
      ${lc.status === 'active' ? `
        <div class="comms-reply livechat-reply" style="flex-shrink:0;padding:8px 10px;border-top:1px solid var(--border)">
          <div style="display:flex;gap:6px;align-items:flex-end">
            <textarea class="comms-reply-input" id="livechatReplyInput" rows="1" placeholder="Reply..." style="margin:0;min-height:38px;flex:1;resize:none" oninput="CommsView._onTyping('${lc.id}')"></textarea>
            <button class="btn btn-primary" onclick="CommsView.sendLivechatReply('${lc.id}')" style="height:38px;padding:0 14px;flex-shrink:0">Send</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
            <button class="btn btn-ghost btn-sm" id="chatDndToggle" onclick="CommsView.toggleDnd()" style="${this.dndEnabled ? 'background:var(--brick);color:#fff' : ''}">${this.dndEnabled ? 'DND: On' : 'DND: Off'}</button>
            <span class="comms-reply-status" id="livechatReplyStatus" style="flex:1"></span>
            <button class="btn btn-ghost btn-sm" onclick="CommsView.handBackToAi('${lc.id}')">Hand Back</button>
          </div>
        </div>
      ` : ''}
      ${this._renderNotesPanel(lc)}
    `;

    // Scroll thread to bottom so latest messages are visible
    const thread = document.getElementById('livechatThread');
    if (thread) thread.scrollTop = thread.scrollHeight;

    // Start visitor typing poll for active sessions
    this._stopTypingPoll();
    if (lc.status === 'active') {
      this._typingPollId = setInterval(() => this._checkVisitorTyping(lc.id), 3000);
    }
  },

  _renderNotesPanel(lc) {
    const notes = lc.agentNotes || [];
    const pending = notes.filter(n => n.status === 'pending');
    const approved = notes.filter(n => n.status === 'approved');
    if (notes.length === 0) return '';

    const modeLabel = (lc.mode === 'agent') ? '<span style="color:var(--green);font-size:10px">Agent mode</span>' : '';

    return `
      <div id="livechatNotesPanel" style="flex-shrink:0;border-top:1px solid var(--border);padding:10px 12px;max-height:200px;overflow-y:auto;background:var(--bg-alt,#f8fafc)">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          AI Notes ${modeLabel}
        </div>
        ${pending.map(n => `
          <div class="note-item" style="font-size:12px;padding:6px 8px;margin-bottom:4px;background:var(--bg,#fff);border:1px solid var(--border);border-radius:6px;display:flex;align-items:flex-start;gap:8px">
            <span style="flex:1">
              <span style="color:${n.type === 'correction' ? 'var(--brick)' : n.type === 'faq' ? '#6366f1' : 'var(--green)'};font-size:10px;font-weight:600;text-transform:uppercase">${App.esc(n.type)}</span>
              ${App.esc(n.text)}
              ${n.confidence < 0.7 ? '<span style="color:#94a3b8;font-size:10px">(low confidence)</span>' : ''}
            </span>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--green)" onclick="CommsView.approveNote('${lc.id}','${n.id}')">&#10003;</button>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--brick)" onclick="CommsView.dismissNote('${lc.id}','${n.id}')">&#10005;</button>
          </div>
        `).join('')}
        ${approved.length > 0 ? `
          <div style="font-size:10px;color:#94a3b8;margin-top:4px">${approved.length} note${approved.length !== 1 ? 's' : ''} approved &amp; added to KB</div>
        ` : ''}
      </div>
    `;
  },

  async approveNote(sessionId, noteId) {
    try {
      await App.api(`livechat/sessions/${sessionId}/notes/${noteId}/approve`, { method: 'POST' });
      // Refresh detail
      if (this.openId) this.openMessage(this.openId);
    } catch (err) {
      console.error('Failed to approve note:', err);
    }
  },

  async dismissNote(sessionId, noteId) {
    try {
      await App.api(`livechat/sessions/${sessionId}/notes/${noteId}/dismiss`, { method: 'POST' });
      // Refresh detail
      if (this.openId) this.openMessage(this.openId);
    } catch (err) {
      console.error('Failed to dismiss note:', err);
    }
  },

  _showHandoffBanner(data) {
    const { sessionId, visitor, question } = data;
    const name = visitor?.name || 'Visitor';

    // Remove existing banner for this session if any
    this._dismissHandoffBanner(sessionId);

    const banner = document.createElement('div');
    banner.id = `handoff-banner-${sessionId}`;
    banner.className = 'handoff-banner';
    banner.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${App.esc(name)} needs you</div>
        <div style="font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${App.esc(question || '')}</div>
      </div>
      <button class="btn" style="background:var(--green);color:#fff;padding:4px 12px;font-size:12px;border-radius:6px" onclick="CommsView.acceptHandoff('${sessionId}')">Join</button>
      <button class="btn" style="background:var(--brick);color:#fff;padding:4px 12px;font-size:12px;border-radius:6px" onclick="CommsView.declineHandoff('${sessionId}')">Decline</button>
    `;
    const container = document.getElementById('commsStream') || document.getElementById('app');
    container.prepend(banner);

    // Auto-dismiss after 2 minutes
    setTimeout(() => this._dismissHandoffBanner(sessionId), 120000);
  },

  _dismissHandoffBanner(sessionId) {
    const el = document.getElementById(`handoff-banner-${sessionId}`);
    if (el) el.remove();
  },

  async acceptHandoff(sessionId) {
    this._dismissHandoffBanner(sessionId);
    // Open the chat session so J can start replying
    this.openMessage('livechat-' + sessionId);
  },

  async declineHandoff(sessionId) {
    this._dismissHandoffBanner(sessionId);
    try {
      await App.api(`livechat/sessions/${sessionId}/decline`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to decline handoff:', err);
    }
  },

  async sendLivechatReply(sessionId) {
    const input = document.getElementById('livechatReplyInput');
    const status = document.getElementById('livechatReplyStatus');
    if (!input) return;
    const text = input.value.trim();
    if (!text) { if (status) status.textContent = 'Write something first'; return; }

    try {
      await App.api('livechat/sessions/' + sessionId + '/reply', { method: 'POST', body: { text } });
      input.value = '';
      if (status) { status.textContent = 'Sent!'; status.style.color = 'var(--green)'; }
      // Refresh detail
      setTimeout(() => this.openMessage(this.openId), 500);
    } catch (err) {
      if (status) { status.textContent = 'Failed: ' + err.message; status.style.color = 'var(--brick)'; }
    }
  },

  async sendLivechatAiReply(sessionId) {
    const status = document.getElementById('livechatReplyStatus');
    if (status) { status.textContent = 'AI thinking...'; status.style.color = ''; }

    try {
      const result = await App.api('livechat/sessions/' + sessionId + '/ai-reply', { method: 'POST' });
      if (status) { status.textContent = 'AI replied!'; status.style.color = 'var(--green)'; }
      setTimeout(() => this.openMessage(this.openId), 500);
    } catch (err) {
      if (status) { status.textContent = 'AI error: ' + err.message; status.style.color = 'var(--brick)'; }
    }
  },

  // ── Voice Mode ──
  voiceMode: false,
  voiceRecognition: null,

  toggleVoiceMode(sessionId) {
    this.voiceMode = !this.voiceMode;
    const btn = document.getElementById('voiceModeBtn');
    const status = document.getElementById('livechatReplyStatus');

    if (this.voiceMode) {
      if (btn) btn.style.background = 'var(--green)';
      if (status) { status.textContent = 'Voice mode ON — speak to reply'; status.style.color = 'var(--green)'; }
      this._startVoiceListening(sessionId);
      // Enable TTS for incoming messages
      this._voiceSessionId = sessionId;
    } else {
      if (btn) btn.style.background = '';
      if (status) { status.textContent = 'Voice mode OFF'; status.style.color = ''; }
      this._stopVoiceListening();
      this._voiceSessionId = null;
    }
  },

  _startVoiceListening(sessionId) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const status = document.getElementById('livechatReplyStatus');
      if (status) { status.textContent = 'Speech recognition not supported'; status.style.color = 'var(--brick)'; }
      this.voiceMode = false;
      return;
    }

    this.voiceRecognition = new SpeechRecognition();
    this.voiceRecognition.continuous = true;
    this.voiceRecognition.interimResults = true;
    this.voiceRecognition.lang = 'en-US';

    let finalTranscript = '';
    let silenceTimer = null;

    this.voiceRecognition.onresult = (event) => {
      let interim = '';
      finalTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      const input = document.getElementById('livechatReplyInput');
      if (input) input.value = finalTranscript + interim;

      // Reset silence timer — send after 3s of silence
      clearTimeout(silenceTimer);
      if (finalTranscript.trim()) {
        silenceTimer = setTimeout(() => {
          this._sendVoiceReply(sessionId, finalTranscript.trim());
          finalTranscript = '';
          if (this.voiceRecognition) {
            this.voiceRecognition.stop();
            setTimeout(() => { if (this.voiceMode) this._startVoiceListening(sessionId); }, 500);
          }
        }, 3000);
      }
    };

    this.voiceRecognition.onerror = (event) => {
      console.log('Voice error:', event.error);
      if (event.error === 'no-speech' && this.voiceMode) {
        // Restart listening
        setTimeout(() => { if (this.voiceMode) this._startVoiceListening(sessionId); }, 500);
      }
    };

    this.voiceRecognition.onend = () => {
      // Auto-restart if voice mode still on
      if (this.voiceMode && !silenceTimer) {
        setTimeout(() => { if (this.voiceMode) this._startVoiceListening(sessionId); }, 500);
      }
    };

    this.voiceRecognition.start();
  },

  _stopVoiceListening() {
    if (this.voiceRecognition) {
      this.voiceRecognition.abort();
      this.voiceRecognition = null;
    }
  },

  async _sendVoiceReply(sessionId, rawText) {
    const status = document.getElementById('livechatReplyStatus');
    if (status) { status.textContent = 'AI cleaning up your reply...'; status.style.color = ''; }

    // Send the raw dictation with context so AI can clean it up and reply as J
    try {
      const result = await App.api('livechat/sessions/' + sessionId + '/reply', {
        method: 'POST',
        body: { text: rawText },
      });
      const input = document.getElementById('livechatReplyInput');
      if (input) input.value = '';
      if (status) { status.textContent = 'Sent!'; status.style.color = 'var(--green)'; }
      setTimeout(() => this.openMessage(this.openId), 500);
    } catch (err) {
      if (status) { status.textContent = 'Failed: ' + err.message; status.style.color = 'var(--brick)'; }
    }
  },

  _speakText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  },

  _typingTimer: null,
  _typingSent: false,
  _typingPollId: null,

  _stopTypingPoll() {
    if (this._typingPollId) { clearInterval(this._typingPollId); this._typingPollId = null; }
  },

  async _checkVisitorTyping(sessionId) {
    try {
      const data = await App.api(`livechat/sessions/${sessionId}/typing-status`);
      const indicator = document.getElementById('hubVisitorTyping');
      if (data.visitorTyping) {
        if (!indicator) {
          const thread = document.getElementById('livechatThread');
          if (thread) {
            const div = document.createElement('div');
            div.id = 'hubVisitorTyping';
            div.className = 'comms-chat-msg from-visitor';
            div.innerHTML = '<div class="comms-chat-sender" style="font-size:10px;color:var(--text-muted)">typing</div><div class="hub-typing-dots"><span></span><span></span><span></span></div>';
            thread.appendChild(div);
            div.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        }
      } else if (indicator) {
        indicator.remove();
      }
    } catch {}
  },

  _onTyping(sessionId) {
    if (!this._typingSent) {
      this._typingSent = true;
      App.api(`livechat/sessions/${sessionId}/typing`, { method: 'POST' }).catch(() => {});
    }
    clearTimeout(this._typingTimer);
    this._typingTimer = setTimeout(() => { this._typingSent = false; }, 3000);
  },

  async handBackToAi(sessionId) {
    const status = document.getElementById('livechatReplyStatus');
    try {
      await App.api(`livechat/sessions/${sessionId}/handback`, { method: 'POST' });
      if (status) { status.textContent = 'Handed back to AI'; status.style.color = 'var(--green)'; }
      setTimeout(() => this.openMessage(this.openId), 500);
    } catch (err) {
      if (status) { status.textContent = 'Failed: ' + err.message; status.style.color = 'var(--brick)'; }
    }
  },

  async endLivechatSession(sessionId) {
    try {
      await App.api('livechat/sessions/' + sessionId + '/end', { method: 'POST' });
      this.load();
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  },

  async sendEmailReply(uid) {
    const input = document.getElementById('commsReplyInput');
    const btn = document.getElementById('commsReplyBtn');
    const status = document.getElementById('commsReplyStatus');
    if (!input || !btn) return;

    const body = input.value.trim();
    if (!body) { if (status) status.textContent = 'Write something first'; return; }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    if (status) status.textContent = '';

    try {
      const result = await App.api('inbox/' + uid + '/reply', {
        method: 'POST',
        body: { body }
      });
      btn.textContent = 'Sent!';
      btn.className = 'btn btn-success';
      if (status) {
        status.textContent = 'Reply sent to ' + result.to;
        status.style.color = 'var(--green)';
      }
      input.value = '';
      setTimeout(() => {
        btn.textContent = 'Send Reply';
        btn.className = 'btn btn-primary';
        btn.disabled = false;
      }, 3000);
    } catch (err) {
      btn.textContent = 'Send Reply';
      btn.disabled = false;
      if (status) {
        status.textContent = 'Failed: ' + (err.message || 'unknown error');
        status.style.color = 'var(--brick)';
      }
    }
  },

  closeDetail() {
    this.openId = null;
    this._stopTypingPoll();
    const detail = document.getElementById('commsDetail');
    if (detail) { detail.style.display = 'none'; detail.style.flexDirection = ''; detail.style.overflow = ''; detail.classList.remove('mobile-open'); detail.innerHTML = ''; }
    document.querySelectorAll('.comms-item').forEach(el => el.classList.remove('active'));
  },

  renderError(msg) {
    const el = document.getElementById('commsStream');
    if (el) el.innerHTML = `<div class="empty-state"><p>Error loading communications</p><p class="dim">${App.esc(msg)}</p></div>`;
  },

  onWsMessage(type, data) {
    // DND state change
    if (type === 'livechat:dnd') {
      this.dndEnabled = !!data.enabled;
      this.renderDndButton();
      return;
    }

    // Handoff request — show accept/decline banner
    if (type === 'livechat:defer') {
      this._showHandoffBanner(data);
      return;
    }

    // Mode change (e.g. after decline)
    if (type === 'livechat:mode') {
      this._dismissHandoffBanner(data.sessionId);
      if (this.openId === 'livechat-' + data.sessionId) this.openMessage(this.openId);
      return;
    }

    // Real-time append for livechat messages when viewing that session
    if (type === 'livechat:message' || type === 'livechat:reply') {
      const sid = data.sessionId;
      if (this.openId === 'livechat-' + sid && data.message) {
        this.appendLivechatMessage(sid, data.message);
        return;
      }
    }

    // Real-time notes update
    if (type === 'livechat:notes') {
      const sid = data.sessionId;
      if (this.openId === 'livechat-' + sid) {
        // Refresh to show new notes
        this.openMessage(this.openId);
      }
      return;
    }

    // For structural changes or other sources, reload
    if (['email:new', 'facebook:message', 'sms:message', 'relay:message',
         'livechat:start', 'livechat:message', 'livechat:reply', 'livechat:end'].includes(type)) {
      this.load();
    }
  },

  appendLivechatMessage(sessionId, message) {
    const thread = document.getElementById('livechatThread');
    if (!thread) return;

    // Update session cache
    const session = this.livechatSessions.find(s => s.id === sessionId);
    if (session && !session.messages.find(m => m.id === message.id)) {
      session.messages.push(message);
    }

    // Append DOM element
    const div = document.createElement('div');
    const cls = message.from === 'visitor' ? 'from-visitor' : 'from-agent';
    const sender = message.from === 'visitor' ? (session?.visitor?.name || 'Visitor')
      : message.from === 'ai' ? 'AI' : 'J';
    div.className = `comms-chat-msg ${cls}`;
    div.innerHTML = `
      <div class="comms-chat-sender">${App.esc(sender)}</div>
      <div class="comms-chat-text">${App.esc(message.text || '')}</div>
      <div class="comms-chat-time">just now</div>
    `;
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;

    // Voice mode: read visitor messages aloud
    if (this.voiceMode && this._voiceSessionId === sessionId && message.from === 'visitor') {
      const name = session?.visitor?.name || 'Visitor';
      this._speakText(`${name} says: ${message.text}`);
    }
  },

  onStats(stats) {
    // Badge already handled by App.updateNavBadges
  }
};
