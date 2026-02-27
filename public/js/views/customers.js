// ══════════════════════════════════════════════════════════
// Customers View — Unified Subscriber Care
// 360° profile: tickets, comms, revenue, health — all in one
// ══════════════════════════════════════════════════════════
const CustomersView = {
  subscribers: [],
  careData: null,
  activeSubId: null,
  careTab: 'overview',

  render(container, hash) {
    // Check if deep-linking into a care profile: #customers/s-001
    const parts = (hash || '').split('/');
    const subId = parts[1] || null;

    container.innerHTML = `
      <div class="customers-view">
        <div class="customers-toolbar">
          <div class="customers-filters">
            <button class="btn btn-sm btn-primary" onclick="CustomersView.loadSubs()">All</button>
            <button class="btn btn-sm btn-ghost" onclick="CustomersView.loadSubs('active')">Active</button>
            <button class="btn btn-sm btn-ghost" onclick="CustomersView.loadSubs('trial')">Trial</button>
            <button class="btn btn-sm btn-ghost" onclick="CustomersView.loadSubs('lead')">Leads</button>
            <button class="btn btn-sm btn-ghost" onclick="CustomersView.loadSubs('churned')">Churned</button>
          </div>
          <div class="customers-toolbar-right">
            <button class="btn btn-primary" onclick="CustomersView.showNewModal()">+ Add Customer</button>
          </div>
        </div>

        <div class="care-layout" id="careLayout">
          <div class="care-list-panel" id="careListPanel">
            <div class="panel">
              <div class="panel-body" style="padding:0" id="customersContainer">
                <div class="empty-state" style="padding:24px"><p>Loading...</p></div>
              </div>
            </div>
          </div>
          <div class="care-profile-panel" id="careProfilePanel" style="display:none">
            <div id="careProfileContent"></div>
          </div>
        </div>
      </div>
    `;

    this.loadSubs().then(() => {
      if (subId) this.openCare(subId);
    });
  },

  async loadSubs(status) {
    // Update active filter button
    const btns = document.querySelectorAll('.customers-filters .btn');
    btns.forEach(b => {
      const label = b.textContent.trim().toLowerCase();
      const isActive = (!status && label === 'all') || label === status || (label === 'leads' && status === 'lead');
      b.className = `btn btn-sm ${isActive ? 'btn-primary' : 'btn-ghost'}`;
    });

    const param = status ? `?status=${status}` : '';
    this.subscribers = await App.api(`subscribers${param}`);
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('customersContainer');
    if (!el) return;
    if (this.subscribers.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:24px"><p>No customers found</p></div>';
      return;
    }
    el.innerHTML = this.subscribers.map(s => `
      <div class="care-list-item ${this.activeSubId === s.id ? 'active' : ''}" onclick="CustomersView.openCare('${s.id}')">
        <div class="care-list-avatar">${(s.name || '?')[0].toUpperCase()}</div>
        <div class="care-list-info">
          <div class="care-list-name">${App.esc(s.name)}</div>
          <div class="care-list-meta">
            <span class="plan-badge ${s.plan}">${s.plan}</span>
            <span class="status-badge ${s.status}">${s.status}</span>
            <span class="care-list-mrr">$${s.mrr}/mo</span>
          </div>
        </div>
        <svg class="care-list-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    `).join('');
  },

  async openCare(subId) {
    this.activeSubId = subId;
    this.careTab = 'overview';
    this.renderList(); // highlight active

    const profile = document.getElementById('careProfilePanel');
    const content = document.getElementById('careProfileContent');
    if (!profile || !content) return;

    profile.style.display = '';
    content.innerHTML = '<div class="care-loading"><div class="pulse-ring"></div><p>Loading care profile...</p></div>';

    try {
      this.careData = await App.api(`subscribers/${subId}/care`);
      this.renderCareProfile();
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><p>Error loading profile: ${err.message}</p></div>`;
    }
  },

  closeCare() {
    this.activeSubId = null;
    this.careData = null;
    const profile = document.getElementById('careProfilePanel');
    if (profile) profile.style.display = 'none';
    this.renderList();
  },

  renderCareProfile() {
    const content = document.getElementById('careProfileContent');
    if (!content || !this.careData) return;

    const d = this.careData;
    const s = d.subscriber;
    const h = d.health;

    content.innerHTML = `
      <div class="care-profile">
        <div class="care-profile-header">
          <button class="care-back-btn" onclick="CustomersView.closeCare()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="care-profile-identity">
            <div class="care-avatar-lg">${(s.name || '?')[0].toUpperCase()}</div>
            <div>
              <h2 class="care-name">${App.esc(s.name)}</h2>
              <div class="care-email">${App.esc(s.email)}</div>
              <div class="care-badges">
                <span class="plan-badge ${s.plan}">${s.plan}</span>
                <span class="status-badge ${s.status}">${s.status}</span>
                <span class="care-since">Since ${s.startDate ? new Date(s.startDate).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>
          </div>
          <div class="care-health-ring ${h.label}">
            <svg viewBox="0 0 36 36" class="health-chart">
              <path class="health-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
              <path class="health-fill" stroke-dasharray="${h.score}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
            </svg>
            <div class="health-score">${h.score}</div>
            <div class="health-label">${h.label}</div>
          </div>
        </div>

        <div class="care-kpi-row">
          <div class="care-kpi">
            <div class="care-kpi-val" style="color:var(--brass)">$${d.revenue.mrr}</div>
            <div class="care-kpi-label">MRR</div>
          </div>
          <div class="care-kpi">
            <div class="care-kpi-val" style="color:var(--cream)">${d.tickets.total}</div>
            <div class="care-kpi-label">Tickets</div>
          </div>
          <div class="care-kpi">
            <div class="care-kpi-val" style="color:${d.tickets.open > 0 ? 'var(--brick)' : 'var(--sage)'}">${d.tickets.open}</div>
            <div class="care-kpi-label">Open</div>
          </div>
          <div class="care-kpi">
            <div class="care-kpi-val" style="color:var(--sage)">$${d.revenue.total}</div>
            <div class="care-kpi-label">Lifetime</div>
          </div>
          <div class="care-kpi">
            <div class="care-kpi-val">${d.comms.total}</div>
            <div class="care-kpi-label">Messages</div>
          </div>
        </div>

        <div class="care-tabs">
          <button class="care-tab ${this.careTab === 'overview' ? 'active' : ''}" onclick="CustomersView.setCareTab('overview')">Overview</button>
          <button class="care-tab ${this.careTab === 'tickets' ? 'active' : ''}" onclick="CustomersView.setCareTab('tickets')">Tickets (${d.tickets.total})</button>
          <button class="care-tab ${this.careTab === 'comms' ? 'active' : ''}" onclick="CustomersView.setCareTab('comms')">Comms (${d.comms.total})</button>
          <button class="care-tab ${this.careTab === 'billing' ? 'active' : ''}" onclick="CustomersView.setCareTab('billing')">Billing (${d.revenue.items.length})</button>
        </div>

        <div class="care-tab-content" id="careTabContent">
          ${this.renderCareTabContent()}
        </div>
      </div>
    `;
  },

  setCareTab(tab) {
    this.careTab = tab;
    // Update tab buttons
    document.querySelectorAll('.care-tab').forEach(b => {
      b.classList.toggle('active', b.textContent.toLowerCase().startsWith(tab));
    });
    const el = document.getElementById('careTabContent');
    if (el) el.innerHTML = this.renderCareTabContent();
  },

  renderCareTabContent() {
    if (!this.careData) return '';
    switch (this.careTab) {
      case 'overview': return this.renderOverviewTab();
      case 'tickets': return this.renderTicketsTab();
      case 'comms': return this.renderCommsTab();
      case 'billing': return this.renderBillingTab();
      default: return '';
    }
  },

  // ── Overview Tab: Timeline ──
  renderOverviewTab() {
    const d = this.careData;
    if (d.timeline.length === 0) {
      return '<div class="empty-state" style="padding:24px"><p>No activity yet</p></div>';
    }

    return `
      <div class="care-timeline">
        ${d.timeline.map(e => {
          const icon = this.timelineIcon(e.type, e.channel);
          const cls = e.type === 'ticket' ? `tl-${e.priority || 'normal'}` : `tl-${e.type}`;
          return `
            <div class="tl-item ${cls}">
              <div class="tl-dot">${icon}</div>
              <div class="tl-body">
                <div class="tl-text">${App.esc(e.text)}</div>
                <div class="tl-meta">
                  <span class="tl-type">${this.timelineLabel(e)}</span>
                  <span class="tl-time">${App.timeAgo(e.date)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  timelineIcon(type, channel) {
    const icons = {
      ticket: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/></svg>',
      resolved: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
      revenue: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
      comms: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
      subscriber: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/></svg>',
    };
    return icons[type] || icons.comms;
  },

  timelineLabel(e) {
    if (e.type === 'ticket') return `${e.priority} ticket — ${e.status}`;
    if (e.type === 'resolved') return 'ticket resolved';
    if (e.type === 'revenue') return `$${e.amount} payment`;
    if (e.type === 'comms') return e.channel;
    if (e.type === 'subscriber') return 'joined';
    return e.type;
  },

  // ── Tickets Tab ──
  renderTicketsTab() {
    const tickets = this.careData.tickets.items;
    if (tickets.length === 0) {
      return '<div class="empty-state" style="padding:24px"><p>No tickets</p></div>';
    }

    return `
      <div class="care-ticket-list">
        ${tickets.map(t => `
          <div class="care-ticket-item" onclick="location.hash='#tickets/${t.id}'">
            <div class="care-ticket-priority ${t.priority}"></div>
            <div class="care-ticket-info">
              <div class="care-ticket-subject">${App.esc(t.subject)}</div>
              <div class="care-ticket-meta">
                <span class="status-badge ${t.status}">${t.status}</span>
                <span>${App.timeAgo(t.createdAt)}</span>
                ${t.aiAnalysis ? '<span class="ai-tag">AI analyzed</span>' : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  // ── Comms Tab ──
  renderCommsTab() {
    const comms = this.careData.comms.items;
    if (comms.length === 0) {
      return '<div class="empty-state" style="padding:24px"><p>No communications</p></div>';
    }

    return `
      <div class="care-comms-list">
        ${comms.map(c => {
          const channelCls = c.channel || 'email';
          return `
            <div class="care-comms-item">
              <span class="comms-channel-badge ${channelCls}">${channelCls}</span>
              <div class="care-comms-info">
                <div class="care-comms-text">${App.esc(c.subject || 'No subject')}</div>
                <div class="care-comms-meta">
                  ${c.from ? `<span>From: ${App.esc(c.from)}</span>` : ''}
                  <span>${c.date ? App.timeAgo(c.date) : ''}</span>
                  ${c.unread ? '<span class="unread-dot"></span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // ── Billing Tab ──
  renderBillingTab() {
    const d = this.careData.revenue;
    return `
      <div class="care-billing">
        <div class="care-billing-summary">
          <div class="care-billing-stat">
            <div class="care-billing-val" style="color:var(--brass)">$${d.mrr}/mo</div>
            <div class="care-billing-label">Current MRR</div>
          </div>
          <div class="care-billing-stat">
            <div class="care-billing-val" style="color:var(--sage)">$${d.total}</div>
            <div class="care-billing-label">Lifetime Revenue</div>
          </div>
          <div class="care-billing-stat">
            <div class="care-billing-val" style="color:var(--brick)">$${d.refunds}</div>
            <div class="care-billing-label">Refunds</div>
          </div>
        </div>
        ${d.items.length === 0 ? '<div class="empty-state" style="padding:24px"><p>No billing records</p></div>' : `
          <table class="data-table" style="margin-top:16px">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th></tr>
            </thead>
            <tbody>
              ${d.items.map(r => `
                <tr>
                  <td style="color:var(--text-dim)">${new Date(r.date).toLocaleDateString()}</td>
                  <td><span class="revenue-type ${r.type}">${r.type}</span></td>
                  <td style="color:${r.type === 'refund' ? 'var(--brick)' : 'var(--brass)'};font-family:var(--font-mono)">
                    ${r.type === 'refund' ? '-' : ''}$${r.amount}
                  </td>
                  <td>${App.esc(r.note || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;
  },

  // ── CRUD Modals (kept from original) ──
  showNewModal() {
    App.showModal('Add Customer', this.formHtml(), async (overlay) => {
      const data = this.readForm(overlay);
      if (!data.name) return HubNotify.toast('Name is required', 'error');
      await App.api('subscribers', { method: 'POST', body: data });
      HubNotify.toast('Customer added', 'success');
      this.loadSubs();
    });
  },

  showEditModal(id) {
    const sub = this.subscribers.find(s => s.id === id);
    if (!sub) return;
    App.showModal('Edit Customer', this.formHtml(sub), async (overlay) => {
      const data = this.readForm(overlay);
      await App.api(`subscribers/${id}`, { method: 'PUT', body: data });
      HubNotify.toast('Customer updated', 'success');
      this.loadSubs();
      if (this.activeSubId === id) this.openCare(id); // refresh care profile
    });
  },

  async deleteSub(id) {
    if (!confirm('Delete this customer?')) return;
    await App.api(`subscribers/${id}`, { method: 'DELETE' });
    HubNotify.toast('Customer deleted', 'success');
    if (this.activeSubId === id) this.closeCare();
    this.loadSubs();
  },

  formHtml(sub) {
    const s = sub || {};
    return `
      <div class="form-group">
        <label>Name</label>
        <input class="form-input" id="subName" value="${App.esc(s.name || '')}">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input class="form-input" id="subEmail" value="${App.esc(s.email || '')}">
      </div>
      <div class="form-group">
        <label>Plan</label>
        <select class="form-select" id="subPlan">
          <option value="founding" ${s.plan === 'founding' ? 'selected' : ''}>Founding 25 — $29/mo</option>
          <option value="solo" ${s.plan === 'solo' ? 'selected' : ''}>Solo — $49/mo</option>
          <option value="pro" ${s.plan === 'pro' ? 'selected' : ''}>Pro — $79/mo</option>
          <option value="team" ${s.plan === 'team' ? 'selected' : ''}>Team — $149/mo</option>
        </select>
      </div>
      <div class="form-group">
        <label>MRR ($)</label>
        <input class="form-input" id="subMrr" type="number" value="${s.mrr || 0}">
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-select" id="subStatus">
          <option value="lead" ${s.status === 'lead' ? 'selected' : ''}>Lead</option>
          <option value="trial" ${s.status === 'trial' ? 'selected' : ''}>Trial</option>
          <option value="active" ${s.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="churned" ${s.status === 'churned' ? 'selected' : ''}>Churned</option>
          <option value="founding" ${s.status === 'founding' ? 'selected' : ''}>Founding</option>
        </select>
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input class="form-input" id="subPhone" value="${App.esc(s.phone || '')}" placeholder="+15551234567">
      </div>
    `;
  },

  readForm(overlay) {
    return {
      name: overlay.querySelector('#subName').value,
      email: overlay.querySelector('#subEmail').value,
      plan: overlay.querySelector('#subPlan').value,
      mrr: parseFloat(overlay.querySelector('#subMrr').value) || 0,
      status: overlay.querySelector('#subStatus').value,
      phone: overlay.querySelector('#subPhone').value,
    };
  },

  onWsMessage(type) {
    if (type.startsWith('subscriber:')) this.loadSubs();
    if (type.startsWith('ticket:') && this.activeSubId) this.openCare(this.activeSubId);
  },

  onStats() {}
};
