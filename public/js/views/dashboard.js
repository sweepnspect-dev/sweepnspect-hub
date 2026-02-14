// ── Dashboard View ──────────────────────────────────────
const DashboardView = {
  clauserStatus: null,

  render(container) {
    container.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Open Tickets</div>
          <div class="stat-value danger" id="dashTickets">-</div>
          <div class="stat-sub" id="dashTicketSub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Subscribers</div>
          <div class="stat-value brass" id="dashSubs">-</div>
          <div class="stat-sub" id="dashSubSub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Monthly Revenue</div>
          <div class="stat-value success" id="dashMrr">-</div>
          <div class="stat-sub" id="dashMrrSub"></div>
        </div>
        <div class="stat-card clauser-card" id="clauserCard">
          <div class="stat-label">Clauser AI</div>
          <div class="clauser-panel">
            <div class="clauser-status-row">
              <span class="clauser-dot offline" id="clauserDot"></span>
              <span class="clauser-status-text" id="clauserStatusText">Offline</span>
            </div>
            <div class="clauser-task" id="clauserTask"></div>
            <div class="clauser-meta">
              <span id="clauserProcessed">0 tickets processed</span>
              <span id="clauserUptime"></span>
            </div>
            <button class="btn btn-sm btn-ghost clauser-toggle" id="clauserToggleBtn" onclick="DashboardView.toggleClauser()">Pause</button>
          </div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="panel">
          <div class="panel-header">
            <h2>Live Activity</h2>
          </div>
          <div class="panel-body" id="activityFeed">
            <div class="empty-state" style="padding:24px"><p>Waiting for activity...</p></div>
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="panel-header">
              <h2>Quick Actions</h2>
            </div>
            <div class="panel-body">
              <div class="quick-actions">
                <button class="btn btn-primary" onclick="location.hash='tickets'; setTimeout(()=>TicketsView.showNewTicketModal(),100)">New Ticket</button>
                <button class="btn btn-ghost" onclick="location.hash='subscribers'">View Subscribers</button>
                <button class="btn btn-ghost" onclick="location.hash='revenue'">Check Revenue</button>
                <button class="btn btn-ghost" onclick="location.hash='commands'">Tasks</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <h2>Needs Review</h2>
            </div>
            <div class="panel-body" id="dashReviewList">
              <div class="empty-state" style="padding:16px"><p>No tickets waiting</p></div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:20px">
        <div class="panel-header">
          <h2>Recent Alerts</h2>
        </div>
        <div class="panel-body" id="dashAlertsList">
          <div class="empty-state" style="padding:16px"><p>No alerts</p></div>
        </div>
      </div>

      <div style="margin-top:20px">
        <div id="dashAiChat"></div>
      </div>
    `;

    // Load data
    this.loadActivity();
    this.loadReviewTickets();
    this.loadAlerts();
    this.fetchClauserStatus();

    // Init AI chat
    if (typeof AIChat !== 'undefined') {
      AIChat.init('dashAiChat');
    }
  },

  async fetchClauserStatus() {
    try {
      const status = await App.api('clauser/status');
      this.updateClauserCard(status);
    } catch (e) { /* hub may not be reachable */ }
  },

  updateClauserCard(data) {
    this.clauserStatus = data;
    const el = (id) => document.getElementById(id);

    const dot = el('clauserDot');
    const text = el('clauserStatusText');
    const task = el('clauserTask');
    const processed = el('clauserProcessed');
    const uptime = el('clauserUptime');
    const btn = el('clauserToggleBtn');
    const sbDot = el('clauserSbDot');
    const sbLabel = el('clauserSbLabel');

    if (!dot) return;

    // Dot + status text
    const statusMap = {
      online:  { cls: 'online',  label: 'Online \u2014 Idle' },
      working: { cls: 'working', label: 'Working' },
      paused:  { cls: 'paused',  label: 'Paused' },
      offline: { cls: 'offline', label: 'Offline' }
    };
    const s = statusMap[data.status] || statusMap.offline;
    dot.className = `clauser-dot ${s.cls}`;
    text.textContent = s.label;

    // Current task
    if (task) {
      task.textContent = data.currentTask || '';
      task.style.display = data.currentTask ? '' : 'none';
    }

    // Meta
    if (processed) processed.textContent = `${data.ticketsProcessed || 0} tickets processed`;
    if (uptime && data.uptime > 0) {
      const m = Math.floor(data.uptime / 60);
      const h = Math.floor(m / 60);
      uptime.textContent = h > 0 ? `${h}h ${m % 60}m uptime` : `${m}m uptime`;
    } else if (uptime) {
      uptime.textContent = '';
    }

    // Toggle button
    if (btn) {
      if (data.status === 'offline') {
        btn.style.display = 'none';
      } else {
        btn.style.display = '';
        btn.textContent = data.status === 'paused' ? 'Resume' : 'Pause';
      }
    }

    // Status bar indicator
    if (sbDot) sbDot.className = `clauser-dot ${s.cls}`;
    if (sbLabel) sbLabel.textContent = `Clauser: ${s.label}`;
  },

  async toggleClauser() {
    const isPaused = this.clauserStatus?.status === 'paused';
    const directive = isPaused ? '@clauser resume' : '@clauser pause';
    try {
      await App.api('commands', {
        method: 'POST',
        body: { text: directive }
      });
    } catch (e) { /* ignore */ }
  },

  onWsMessage(type, data) {
    if (type === 'clauser:status') {
      this.updateClauserCard(data);
    }
  },

  async loadAlerts() {
    try {
      const alerts = await App.api('alerts?limit=10');
      this.renderDashAlerts(alerts);
    } catch (e) { /* ignore */ }
  },

  onAlert(data) {
    // Prepend to dashboard alert list
    const el = document.getElementById('dashAlertsList');
    if (!el) return;
    // Re-render with new data
    const current = App.state.alerts.slice(0, 10);
    this.renderDashAlerts(current);
  },

  renderDashAlerts(alerts) {
    const el = document.getElementById('dashAlertsList');
    if (!el) return;
    if (!alerts || alerts.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No alerts</p></div>';
      return;
    }
    el.innerHTML = `<ul class="dash-alerts-list">${alerts.slice(0, 10).map(a => `
      <li class="dash-alert-item">
        <div class="alert-severity-dot ${a.severity || 'medium'}"></div>
        <div>
          <div class="activity-text">${a.message}</div>
          <div class="activity-time">${App.timeAgo(a.timestamp)}</div>
        </div>
      </li>
    `).join('')}</ul>`;
  },

  async loadActivity() {
    if (App.state.activities.length > 0) {
      this.renderActivities(App.state.activities);
    }
  },

  async loadReviewTickets() {
    try {
      const tickets = await App.api('tickets?status=review');
      const el = document.getElementById('dashReviewList');
      if (!el) return;
      if (tickets.length === 0) {
        el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No tickets waiting</p></div>';
        return;
      }
      el.innerHTML = `<ul class="ticket-list">${tickets.map(t => `
        <li class="ticket-item" onclick="location.hash='tickets/${t.id}'">
          <div class="ticket-priority ${t.priority}"></div>
          <div class="ticket-info">
            <div class="ticket-subject">${t.subject}</div>
            <div class="ticket-meta">${t.id} &middot; ${App.timeAgo(t.createdAt)}</div>
          </div>
          <span class="ticket-status ${t.status}">${t.status}</span>
        </li>
      `).join('')}</ul>`;
    } catch (e) { /* ignore if server unreachable */ }
  },

  onStats(stats) {
    const el = (id) => document.getElementById(id);
    if (el('dashTickets')) {
      el('dashTickets').textContent = stats.tickets.open;
      el('dashTickets').className = `stat-value ${stats.tickets.open > 0 ? 'danger' : 'success'}`;
      el('dashTicketSub').textContent = `${stats.tickets.aiWorking} AI-working, ${stats.tickets.needsReview} needs review`;
    }
    if (el('dashSubs')) {
      el('dashSubs').textContent = stats.subscribers.active;
      el('dashSubSub').textContent = `${stats.subscribers.trial} trial, ${stats.subscribers.churned} churned`;
    }
    if (el('dashMrr')) {
      el('dashMrr').textContent = `$${stats.revenue.mrr.toLocaleString()}`;
      el('dashMrrSub').textContent = `$${stats.revenue.monthRevenue.toLocaleString()} this month`;
    }
  },

  onActivity(data) {
    App.state.activities.unshift(data);
    this.renderActivities(App.state.activities);
  },

  renderActivities(activities) {
    const el = document.getElementById('activityFeed');
    if (!el) return;
    const items = activities.slice(0, 15);
    if (items.length === 0) return;
    el.innerHTML = `<ul class="activity-list">${items.map(a => `
      <li class="activity-item">
        <div class="activity-dot ${a.icon || 'system'}"></div>
        <div>
          <div class="activity-text">${a.text}</div>
          <div class="activity-time">${App.timeAgo(a.time)}</div>
        </div>
      </li>
    `).join('')}</ul>`;
  }
};
