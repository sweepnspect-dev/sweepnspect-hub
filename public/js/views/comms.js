// ══════════════════════════════════════════════════════════
// Comms View — Unified Communications
// Email (IMAP) + Tawk.to + Facebook + Live Chat + Claude Sync
// ══════════════════════════════════════════════════════════
const CommsView = {
  messages: [],
  status: 'loading',
  activeSource: null,    // null = all, 'email', 'tawk', 'facebook', 'sms', 'sync', 'livechat'
  activeFilter: null,    // email category filter
  emailCategories: null, // cached from /api/inbox/categories
  openId: null,
  showArchived: false,
  livechatSessions: [],  // cached live chat sessions

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
            <button class="source-btn" data-source="tawk" onclick="CommsView.setSource('tawk')">
              <span class="source-badge tawk"></span> Tawk
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
        App.api('comms/tawk').catch(() => ({ messages: [] })),
        App.api('comms/facebook').catch(() => ({ messages: [] })),
        App.api('comms/sync').catch(() => ({ messages: [] })),
        App.api('comms/sms').catch(() => ({ messages: [] })),
        App.api('inbox/categories').catch(() => null),
        App.api('livechat/sessions').catch(() => ({ sessions: [] })),
      ]);

      // Merge all streams
      const emailData = results[0].status === 'fulfilled' ? results[0].value : { emails: [], status: 'error' };
      const tawkData = results[1].status === 'fulfilled' ? results[1].value : { messages: [] };
      const fbData = results[2].status === 'fulfilled' ? results[2].value : { messages: [] };
      const syncData = results[3].status === 'fulfilled' ? results[3].value : { messages: [] };
      const smsData = results[4].status === 'fulfilled' ? results[4].value : { messages: [] };
      const categories = results[5].status === 'fulfilled' ? results[5].value : null;
      const livechatData = results[6].status === 'fulfilled' ? results[6].value : { sessions: [] };
      if (categories) this.emailCategories = categories;
      this.livechatSessions = livechatData.sessions || [];

      this.status = emailData.status || 'connected';

      // Normalize into unified format
      const unified = [];

      // Email messages — cross-route tawk/facebook emails to their source tabs
      (emailData.emails || []).forEach(e => {
        const cat = e.route?.category;
        // Emails categorized as tawk/facebook belong to those source tabs
        let source = 'email';
        if (cat === 'tawk') source = 'tawk';
        else if (cat === 'facebook') source = 'facebook';

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

      // Tawk messages
      (tawkData.messages || []).forEach(t => {
        unified.push({
          id: 'tawk-' + (t.id || t.chatId),
          source: 'tawk',
          from: t.visitorName || t.name || 'Visitor',
          fromDetail: t.visitorEmail || t.email || '',
          subject: t.message ? t.message.slice(0, 60) : 'Chat session',
          preview: t.message || '',
          date: t.time || t.timestamp || t.createdAt,
          unread: t.unread || false,
          raw: t
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

      // Sort by date descending
      unified.sort((a, b) => new Date(b.date) - new Date(a.date));

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
    const btn = document.querySelector('.comms-toolbar-right .btn');
    if (btn) { btn.textContent = 'Refreshing...'; btn.disabled = true; }
    try {
      await App.api('inbox/check', { method: 'POST' }).catch(() => {});
      await this.load();
    } finally {
      if (btn) { btn.textContent = 'Refresh'; btn.disabled = false; }
    }
  },

  setSource(source) {
    this.activeSource = source;
    // Update button states
    document.querySelectorAll('.source-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.source || '') === (source || ''));
    });
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

    el.innerHTML = this.messages.map(msg => {
      const activeCls = msg.id === this.openId ? ' active' : '';
      const unreadCls = msg.unread ? ' unread' : '';
      return `
        <div class="comms-item${unreadCls}${activeCls}" onclick="CommsView.openMessage('${msg.id}')" data-id="${msg.id}">
          <div class="comms-item-dot${msg.unread ? ' unread' : ''}"></div>
          <span class="source-badge ${msg.source}"></span>
          <div class="comms-item-body">
            <div class="comms-item-from">${App.esc(msg.from)}</div>
            <div class="comms-item-subject">${App.esc(msg.subject)}</div>
            ${msg.categoryLabel ? '<span class="inbox-tag ' + msg.categoryCls + '">' + msg.categoryLabel + '</span>' : ''}
          </div>
          <div class="comms-item-time">${App.timeAgo(msg.date)}</div>
        </div>
      `;
    }).join('');
  },

  async openMessage(id) {
    this.openId = id;
    const detail = document.getElementById('commsDetail');
    if (!detail) return;

    detail.style.display = '';
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
    } else if (msg.source === 'tawk') {
      this.renderTawkDetail(detail, msg);
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

  renderTawkDetail(detail, msg) {
    const t = msg.raw;
    detail.innerHTML = `
      <div class="comms-detail-header">
        <button class="comms-back" onclick="CommsView.closeDetail()">&larr; Back</button>
        <span class="source-badge tawk"></span>
        <div class="comms-detail-meta">
          <div class="comms-detail-subject">Chat with ${App.esc(msg.from)}</div>
          <div class="comms-detail-from">${App.esc(msg.fromDetail || 'No email provided')}</div>
          <div class="comms-detail-info">${App.timeAgo(msg.date)} &middot; Tawk.to Live Chat</div>
        </div>
      </div>
      <div class="comms-detail-body">
        <div class="comms-chat-thread">
          ${(t.messages || [t]).map(m => `
            <div class="comms-chat-msg ${m.type === 'visitor' || m.sender === 'visitor' ? 'from-visitor' : 'from-agent'}">
              <div class="comms-chat-sender">${App.esc(m.senderName || m.sender || msg.from)}</div>
              <div class="comms-chat-text">${App.esc(m.text || m.message || m.msg || '')}</div>
              <div class="comms-chat-time">${m.time ? App.timeAgo(m.time) : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
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

    detail.innerHTML = `
      <div class="comms-detail-header">
        <button class="comms-back" onclick="CommsView.closeDetail()">&larr; Back</button>
        <span class="source-badge livechat" style="background:${statusColor}"></span>
        <div class="comms-detail-meta">
          <div class="comms-detail-subject">Chat with ${App.esc(msg.from)} <span style="color:${statusColor};font-size:12px">(${statusLabel})</span></div>
          <div class="comms-detail-from">${App.esc(msg.fromDetail || 'No email provided')}</div>
          <div class="comms-detail-info">Started ${App.timeAgo(lc.startedAt)} &middot; ${lc.messages?.length || 0} messages</div>
        </div>
      </div>
      <div class="comms-detail-body">
        <div class="comms-chat-thread" id="livechatThread">
          ${(lc.messages || []).map(m => `
            <div class="comms-chat-msg ${m.from === 'visitor' ? 'from-visitor' : 'from-agent'}">
              <div class="comms-chat-sender">${App.esc(m.from === 'visitor' ? (lc.visitor?.name || 'Visitor') : m.from === 'ai' ? 'AI' : 'J')}</div>
              <div class="comms-chat-text">${App.esc(m.text || '')}</div>
              <div class="comms-chat-time">${m.ts ? App.timeAgo(m.ts) : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ${lc.status === 'active' ? `
        <div class="comms-reply">
          <div class="comms-reply-label">Reply to ${App.esc(msg.from)}:</div>
          <textarea class="comms-reply-input" id="livechatReplyInput" rows="3" placeholder="Type your reply..."></textarea>
          <div class="comms-reply-actions">
            <button class="btn btn-primary" onclick="CommsView.sendLivechatReply('${lc.id}')">Send</button>
            <button class="btn btn-ghost" onclick="CommsView.sendLivechatAiReply('${lc.id}')">AI Reply</button>
            <button class="btn btn-ghost btn-sm" onclick="CommsView.endLivechatSession('${lc.id}')" style="margin-left:auto;color:var(--brick)">End Chat</button>
            <span class="comms-reply-status" id="livechatReplyStatus"></span>
          </div>
        </div>
      ` : ''}
    `;
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
    const detail = document.getElementById('commsDetail');
    if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
    document.querySelectorAll('.comms-item').forEach(el => el.classList.remove('active'));
  },

  renderError(msg) {
    const el = document.getElementById('commsStream');
    if (el) el.innerHTML = `<div class="empty-state"><p>Error loading communications</p><p class="dim">${App.esc(msg)}</p></div>`;
  },

  onWsMessage(type, data) {
    if (type === 'email:new' || type === 'tawk:message' || type === 'facebook:message' || type === 'sms:message' || type === 'relay:message' ||
        type === 'livechat:start' || type === 'livechat:message' || type === 'livechat:reply' || type === 'livechat:end') {
      this.load();
    }
  },

  onStats(stats) {
    // Badge already handled by App.updateNavBadges
  }
};
