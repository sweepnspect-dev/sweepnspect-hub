// ── Inbox View ───────────────────────────────────────────
const InboxView = {
  emails: [],
  status: 'loading',
  openUid: null,
  activeFilter: null,
  showArchived: false,
  byCategory: {},

  render(container) {
    container.innerHTML = `
      <div class="inbox-header">
        <div class="inbox-status" id="inboxStatusBar">
          <span class="inbox-status-dot" id="inboxDot"></span>
          <span id="inboxStatusText">Connecting...</span>
        </div>
        <button class="btn btn-sm" onclick="InboxView.forceCheck()">Check Now</button>
      </div>
      <div class="inbox-filters" id="inboxFilters"></div>
      <div class="inbox-split">
        <div class="inbox-list" id="inboxList">
          <div class="empty-state"><p>Loading inbox...</p></div>
        </div>
        <div class="inbox-detail" id="inboxDetail" style="display:none"></div>
      </div>
    `;
    this.openUid = null;
    this.activeFilter = null;
    this.load();
  },

  async load() {
    try {
      const params = new URLSearchParams();
      if (this.activeFilter) params.set('category', this.activeFilter);
      if (this.showArchived) params.set('archived', 'true');
      const qs = params.toString() ? '?' + params.toString() : '';
      const data = await App.api('inbox' + qs);
      this.emails = data.emails || [];
      this.status = data.status;
      this.byCategory = data.byCategory || {};
      this.renderFilters();
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
      this.byCategory = data.byCategory || {};
      this.renderFilters();
      this.renderEmails(data);
    } catch (err) {
      this.renderError(err.message);
    } finally {
      if (btn) { btn.textContent = 'Check Now'; btn.disabled = false; }
    }
  },

  renderFilters() {
    const el = document.getElementById('inboxFilters');
    if (!el) return;

    const cats = [
      { key: null,       label: 'All' },
      { key: 'founding', label: 'Founding', cls: 'tag-founding' },
      { key: 'billing',  label: 'Billing',  cls: 'tag-billing' },
      { key: 'bug',      label: 'Bugs',     cls: 'tag-bug' },
      { key: 'demo',     label: 'Demos',    cls: 'tag-demo' },
      { key: 'ticket',   label: 'Tickets',  cls: 'tag-ticket' },
      { key: 'feature',  label: 'Features', cls: 'tag-feature' },
      { key: 'referral', label: 'Referrals', cls: 'tag-referral' },
      { key: 'contact',  label: 'Contact',  cls: 'tag-contact' },
      { key: 'partner',  label: 'Partners', cls: 'tag-partner' },
    ];

    const counts = this.byCategory;
    el.innerHTML = cats.map(c => {
      const count = c.key ? (counts[c.key] || 0) : Object.values(counts).reduce((s, v) => s + v, 0);
      const active = this.activeFilter === c.key ? ' active' : '';
      const clsAttr = c.cls ? ' ' + c.cls : '';
      return `<button class="inbox-filter-btn${active}${clsAttr}"
                onclick="InboxView.setFilter(${c.key ? "'" + c.key + "'" : 'null'})">${c.label}${count ? ' <span class="filter-count">' + count + '</span>' : ''}</button>`;
    }).join('') +
    `<label class="inbox-archive-toggle">
      <input type="checkbox" ${this.showArchived ? 'checked' : ''} onchange="InboxView.toggleArchived(this.checked)"> Show system
    </label>`;
  },

  setFilter(category) {
    this.activeFilter = category;
    this.load();
  },

  toggleArchived(show) {
    this.showArchived = show;
    this.load();
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
        const counts = data.byCategory || {};
        const parts = Object.entries(counts)
          .filter(([k, v]) => v > 0 && k !== 'system')
          .map(([k, v]) => v + ' ' + k);
        statusText.textContent = data.account + ' \u2022 ' + data.total + ' emails \u2022 ' + data.unread + ' unread' + (parts.length ? ' \u2022 ' + parts.join(' \u00b7 ') : '');
      } else if (data.status === 'error') {
        dot.className = 'inbox-status-dot offline';
        statusText.textContent = 'Error: ' + data.error;
      } else if (data.status === 'disabled') {
        dot.className = 'inbox-status-dot offline';
        statusText.textContent = 'Email poller disabled \u2014 set IMAP_PASS in .env';
      } else {
        dot.className = 'inbox-status-dot';
        statusText.textContent = data.status;
      }
    }

    if (!data.emails || data.emails.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>' + (this.activeFilter ? 'No ' + this.activeFilter + ' emails' : 'Inbox empty') + '</p><p class="dim">Polling contact@sweepnspect.com every 30s</p></div>';
      return;
    }

    list.innerHTML = data.emails.map(email => {
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const route = email.route;
      const activeCls = email.uid === this.openUid ? ' active' : '';
      const archivedCls = route?.category === 'system' ? ' archived' : '';
      return `
        <div class="inbox-item${email.unread ? ' unread' : ''}${activeCls}${archivedCls}" onclick="InboxView.openEmail(${email.uid})" data-uid="${email.uid}">
          <div class="inbox-dot-indicator${email.unread ? ' unread' : ''}"></div>
          <div class="inbox-body">
            <div class="inbox-from">${this.esc(fromName)}</div>
            <div class="inbox-subject">${this.esc(email.subject)}</div>
            <div class="inbox-time">${App.timeAgo(email.date)}</div>
          </div>
          ${route ? '<span class="inbox-tag ' + route.cls + '">' + route.label + '</span>' : ''}
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

    document.querySelectorAll('.inbox-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.uid) === uid);
    });
    const local = this.emails.find(e => e.uid === uid);
    if (local) {
      local.unread = false;
      const item = document.querySelector('.inbox-item[data-uid="' + uid + '"]');
      if (item) {
        item.classList.remove('unread');
        const dot = item.querySelector('.inbox-dot-indicator');
        if (dot) dot.classList.remove('unread');
      }
    }

    try {
      const email = await App.api('inbox/' + uid);
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const fromAddr = email.from?.address || '';
      const toList = (email.to || []).map(t => t.address).join(', ');
      const date = email.date ? new Date(email.date).toLocaleString() : '';
      const route = email.route;

      let linkedHtml = '';
      if (email.linkedTicket) {
        linkedHtml = '<a class="email-linked-badge badge-ticket" href="#tickets/' + email.linkedTicket.id + '">Ticket ' + email.linkedTicket.id + ' (' + email.linkedTicket.status + ')</a>';
      } else if (email.linkedSubscriber) {
        linkedHtml = '<a class="email-linked-badge badge-subscriber" href="#subscribers/' + email.linkedSubscriber.id + '">' + this.esc(email.linkedSubscriber.name) + ' (' + email.linkedSubscriber.status + ')</a>';
      }

      detail.innerHTML = `
        <div class="email-header">
          <button class="email-back" onclick="InboxView.closeEmail()">&larr; Back</button>
          <div class="email-meta">
            <div class="email-meta-subject">
              ${route ? '<span class="inbox-tag ' + route.cls + '">' + route.label + '</span> ' : ''}${this.esc(email.subject)}
            </div>
            <div class="email-meta-from">
              <strong>${this.esc(fromName)}</strong> &lt;${this.esc(fromAddr)}&gt;
            </div>
            <div class="email-meta-details">
              To: ${this.esc(toList)} &middot; ${date}${route?.source ? ' &middot; Routed by: ' + route.source : ''}
            </div>
            ${linkedHtml ? '<div class="email-meta-linked">' + linkedHtml + '</div>' : ''}
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
      detail.innerHTML = '<div class="email-loading">Error loading email: ' + this.esc(err.message) + '</div>';
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
      const result = await App.api('inbox/' + uid + '/reply', {
        method: 'POST',
        body: { body }
      });
      btn.textContent = 'Sent!';
      btn.className = 'btn btn-success';
      status.textContent = 'Reply sent to ' + result.to;
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
      status.textContent = 'Failed: ' + (err.message || 'unknown error');
      status.style.color = 'var(--brick)';
    }
  },

  renderError(msg) {
    const list = document.getElementById('inboxList');
    if (list) list.innerHTML = '<div class="empty-state"><p>Error loading inbox</p><p class="dim">' + this.esc(msg) + '</p></div>';
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  onWsMessage(type, data) {
    if (type === 'email:new') {
      this.load();
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
