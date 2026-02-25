// ── Inbox View ───────────────────────────────────────────
const InboxView = {
  emails: [],
  status: 'loading',
  openUid: null,

  render(container) {
    container.innerHTML = `
      <div class="inbox-header">
        <div class="inbox-status" id="inboxStatusBar">
          <span class="inbox-status-dot" id="inboxDot"></span>
          <span id="inboxStatusText">Connecting...</span>
        </div>
        <button class="btn btn-sm" onclick="InboxView.forceCheck()">Check Now</button>
      </div>
      <div class="inbox-split">
        <div class="inbox-list" id="inboxList">
          <div class="empty-state"><p>Loading inbox...</p></div>
        </div>
        <div class="inbox-detail" id="inboxDetail" style="display:none"></div>
      </div>
    `;
    this.openUid = null;
    this.load();
  },

  async load() {
    try {
      const data = await App.api('inbox');
      this.emails = data.emails || [];
      this.status = data.status;
      this.renderEmails(data);
    } catch (err) {
      this.status = 'error';
      this.renderError(err.message);
    }
  },

  async forceCheck() {
    const btn = document.querySelector('.inbox-header .btn');
    if (btn) { btn.textContent = 'Checking...'; btn.disabled = true; }
    try {
      const data = await App.api('inbox/check', { method: 'POST' });
      this.emails = data.emails || [];
      this.status = data.status;
      this.renderEmails(data);
    } catch (err) {
      this.renderError(err.message);
    } finally {
      if (btn) { btn.textContent = 'Check Now'; btn.disabled = false; }
    }
  },

  renderEmails(data) {
    const list = document.getElementById('inboxList');
    const dot = document.getElementById('inboxDot');
    const statusText = document.getElementById('inboxStatusText');
    if (!list) return;

    // Status bar
    if (dot && statusText) {
      if (data.status === 'connected') {
        dot.className = 'inbox-status-dot online';
        statusText.textContent = `${data.account} \u2022 ${data.total} emails \u2022 ${data.unread} unread \u2022 last check ${App.timeAgo(data.lastCheck)}`;
      } else if (data.status === 'error') {
        dot.className = 'inbox-status-dot offline';
        statusText.textContent = `Error: ${data.error}`;
      } else if (data.status === 'disabled') {
        dot.className = 'inbox-status-dot offline';
        statusText.textContent = 'Email poller disabled \u2014 set IMAP_PASS in .env';
      } else {
        dot.className = 'inbox-status-dot';
        statusText.textContent = data.status;
      }
    }

    if (!data.emails || data.emails.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Inbox empty</p><p class="dim">Polling contact@sweepnspect.com every 30s</p></div>';
      return;
    }

    list.innerHTML = data.emails.map(email => {
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const tag = this.classifyEmail(email);
      const activeCls = email.uid === this.openUid ? ' active' : '';
      return `
        <div class="inbox-item${email.unread ? ' unread' : ''}${activeCls}" onclick="InboxView.openEmail(${email.uid})" data-uid="${email.uid}">
          <div class="inbox-dot-indicator${email.unread ? ' unread' : ''}"></div>
          <div class="inbox-body">
            <div class="inbox-from">${this.esc(fromName)}</div>
            <div class="inbox-subject">${this.esc(email.subject)}</div>
            <div class="inbox-time">${App.timeAgo(email.date)}</div>
          </div>
          ${tag ? `<span class="inbox-tag ${tag.cls}">${tag.label}</span>` : ''}
        </div>
      `;
    }).join('');
  },

  async openEmail(uid) {
    this.openUid = uid;
    const detail = document.getElementById('inboxDetail');
    if (!detail) return;

    detail.style.display = '';
    detail.innerHTML = '<div class="email-loading">Loading email...</div>';

    // Highlight active item in list
    document.querySelectorAll('.inbox-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.uid) === uid);
    });
    // Mark as read locally
    const local = this.emails.find(e => e.uid === uid);
    if (local) {
      local.unread = false;
      const item = document.querySelector(`.inbox-item[data-uid="${uid}"]`);
      if (item) {
        item.classList.remove('unread');
        const dot = item.querySelector('.inbox-dot-indicator');
        if (dot) dot.classList.remove('unread');
      }
    }

    try {
      const email = await App.api(`inbox/${uid}`);
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const fromAddr = email.from?.address || '';
      const toList = (email.to || []).map(t => t.address).join(', ');
      const date = email.date ? new Date(email.date).toLocaleString() : '';

      detail.innerHTML = `
        <div class="email-header">
          <button class="email-back" onclick="InboxView.closeEmail()">&larr; Back</button>
          <div class="email-meta">
            <div class="email-meta-subject">${this.esc(email.subject)}</div>
            <div class="email-meta-from">
              <strong>${this.esc(fromName)}</strong> &lt;${this.esc(fromAddr)}&gt;
            </div>
            <div class="email-meta-details">
              To: ${this.esc(toList)} &middot; ${date}
            </div>
          </div>
        </div>
        <div class="email-body"><pre>${this.esc(email.body || '(no text content)')}</pre></div>
        <div class="email-reply">
          <div class="email-reply-label">Reply to ${this.esc(fromName)}:</div>
          <textarea class="email-reply-input" id="replyInput" rows="5" placeholder="Type your reply..."></textarea>
          <div class="email-reply-actions">
            <button class="btn btn-primary" id="replySendBtn" onclick="InboxView.sendReply(${uid})">Send Reply</button>
            <span class="email-reply-status" id="replyStatus"></span>
          </div>
        </div>
      `;
    } catch (err) {
      detail.innerHTML = `<div class="email-loading">Error loading email: ${this.esc(err.message)}</div>`;
    }
  },

  closeEmail() {
    this.openUid = null;
    const detail = document.getElementById('inboxDetail');
    if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
    document.querySelectorAll('.inbox-item').forEach(el => el.classList.remove('active'));
  },

  async sendReply(uid) {
    const input = document.getElementById('replyInput');
    const btn = document.getElementById('replySendBtn');
    const status = document.getElementById('replyStatus');
    if (!input || !btn) return;

    const body = input.value.trim();
    if (!body) { status.textContent = 'Write something first'; return; }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    status.textContent = '';

    try {
      const result = await App.api(`inbox/${uid}/reply`, {
        method: 'POST',
        body: { body }
      });
      btn.textContent = 'Sent!';
      btn.className = 'btn btn-success';
      status.textContent = `Reply sent to ${result.to}`;
      status.style.color = 'var(--success)';
      input.value = '';
      setTimeout(() => {
        btn.textContent = 'Send Reply';
        btn.className = 'btn btn-primary';
        btn.disabled = false;
      }, 3000);
    } catch (err) {
      btn.textContent = 'Send Reply';
      btn.disabled = false;
      status.textContent = `Failed: ${err.message || 'unknown error'}`;
      status.style.color = 'var(--brick)';
    }
  },

  renderError(msg) {
    const list = document.getElementById('inboxList');
    if (list) list.innerHTML = `<div class="empty-state"><p>Error loading inbox</p><p class="dim">${this.esc(msg)}</p></div>`;
  },

  classifyEmail(email) {
    const subj = (email.subject || '').toLowerCase();
    if (subj.includes('founding') || subj.includes('application') || subj.includes('formsubmit'))
      return { label: 'FOUNDING', cls: 'tag-founding' };
    if (email.unread)
      return { label: 'NEW', cls: 'tag-new' };
    return null;
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  onWsMessage(type, data) {
    if (type === 'email:new') {
      this.emails.unshift(data);
      const listEl = document.getElementById('inboxList');
      if (listEl) {
        this.renderEmails({
          status: this.status,
          emails: this.emails,
          total: this.emails.length,
          unread: this.emails.filter(e => e.unread).length,
          account: 'contact@sweepnspect.com',
          lastCheck: new Date().toISOString(),
        });
      }
    }
  },

  onStats(stats) {
    if (stats.inbox) {
      const badge = document.getElementById('inboxBadge');
      if (badge) {
        if (stats.inbox.unread > 0) {
          badge.textContent = stats.inbox.unread;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  }
};
