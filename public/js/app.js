// ── SweepNspect HQ — App Router & State ─────────────────
const App = {
  state: {
    stats: null,
    activities: [],
    alerts: [],
    alertCount: 0,
    alertPanelOpen: false,
    currentView: 'dashboard'
  },

  views: {},

  init() {
    this.registerView('dashboard', DashboardView);
    this.registerView('tickets', TicketsView);
    this.registerView('subscribers', SubscribersView);
    this.registerView('revenue', RevenueView);
    this.registerView('commands', CommandsView);

    // Route on hash change
    window.addEventListener('hashchange', () => this.route());

    // WebSocket events
    hubSocket.on('init', (data) => {
      this.state.stats = data;
      this.updateStatusBar();
      this.updateBadges();
      if (this.views[this.state.currentView]?.onStats) {
        this.views[this.state.currentView].onStats(data);
      }
    });

    hubSocket.on('stats', (data) => {
      this.state.stats = data;
      this.updateStatusBar();
      this.updateBadges();
      if (this.views[this.state.currentView]?.onStats) {
        this.views[this.state.currentView].onStats(data);
      }
    });

    hubSocket.on('activity', (data) => {
      this.state.activities.unshift(data);
      if (this.state.activities.length > 50) this.state.activities.length = 50;
      if (this.views[this.state.currentView]?.onActivity) {
        this.views[this.state.currentView].onActivity(data);
      }
    });

    // Forward all WS events to current view
    hubSocket.on('*', (type, data) => {
      const view = this.views[this.state.currentView];
      if (view?.onWsMessage) view.onWsMessage(type, data);
    });

    hubSocket.on('alert', (data) => {
      this.state.alerts.unshift(data);
      if (this.state.alerts.length > 50) this.state.alerts.length = 50;
      this.state.alertCount++;
      this.updateAlertBadge();

      // Toast + desktop notify
      HubNotify.alertToast(data);
      HubNotify.alertDesktop(data);

      // Forward to dashboard if active
      if (this.views[this.state.currentView]?.onAlert) {
        this.views[this.state.currentView].onAlert(data);
      }
    });

    hubSocket.on('clauser:status', (data) => {
      this.updateClauserStatusBar(data);
    });

    hubSocket.on('_connected', () => this.setOnline(true));
    hubSocket.on('_disconnected', () => this.setOnline(false));

    // Start clock
    this.clockInterval = setInterval(() => this.updateClock(), 1000);
    this.updateClock();

    // Init notifications
    HubNotify.init();

    // Initial route
    this.route();
  },

  registerView(name, viewObj) {
    this.views[name] = viewObj;
  },

  route() {
    const hash = location.hash.slice(1) || 'dashboard';
    const viewName = hash.split('/')[0];

    if (!this.views[viewName]) {
      location.hash = '#dashboard';
      return;
    }

    this.state.currentView = viewName;

    // Update sidebar active state
    document.querySelectorAll('.sidebar-nav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + viewName);
    });

    // Update header
    const titles = { dashboard: 'Dashboard', tickets: 'Support Tickets', subscribers: 'Subscribers', revenue: 'Revenue', commands: 'Commands' };
    document.getElementById('viewTitle').textContent = titles[viewName] || viewName;

    // Render view
    const container = document.getElementById('viewContainer');
    const view = this.views[viewName];
    if (view.render) {
      container.innerHTML = '';
      view.render(container, hash);
    }

    // Pass current stats if available
    if (this.state.stats && view.onStats) {
      view.onStats(this.state.stats);
    }
  },

  updateClock() {
    const el = document.getElementById('headerTime');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    }
  },

  updateStatusBar() {
    const s = this.state.stats;
    if (!s) return;
    const el = (id) => document.getElementById(id);
    if (el('sbTickets')) el('sbTickets').textContent = `${s.tickets.open} open`;
    if (el('sbSubs')) el('sbSubs').textContent = `${s.subscribers.active} subs`;
    if (el('sbMrr')) el('sbMrr').textContent = `$${s.revenue.mrr} MRR`;
  },

  updateBadges() {
    const s = this.state.stats;
    if (!s) return;
    const badge = document.getElementById('ticketBadge');
    if (badge) {
      badge.textContent = s.tickets.open || '';
      badge.style.display = s.tickets.open > 0 ? '' : 'none';
    }
  },

  updateClauserStatusBar(data) {
    const dot = document.getElementById('clauserSbDot');
    const label = document.getElementById('clauserSbLabel');
    if (!dot) return;
    const map = {
      online: { cls: 'online', text: 'Clauser: Idle' },
      working: { cls: 'working', text: 'Clauser: Working' },
      paused: { cls: 'paused', text: 'Clauser: Paused' },
      offline: { cls: 'offline', text: 'Clauser: Offline' }
    };
    const s = map[data.status] || map.offline;
    dot.className = `clauser-dot ${s.cls}`;
    if (label) label.textContent = s.text;
  },

  setOnline(online) {
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    if (dot) { dot.className = `status-dot ${online ? 'online' : 'offline'}`; }
    if (label) { label.textContent = online ? 'Online' : 'Offline'; }
  },

  updateAlertBadge() {
    const badge = document.getElementById('alertBadge');
    if (!badge) return;
    if (this.state.alertCount > 0) {
      badge.textContent = this.state.alertCount > 99 ? '99+' : this.state.alertCount;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  },

  toggleAlertPanel() {
    const panel = document.getElementById('alertPanel');
    if (!panel) return;
    this.state.alertPanelOpen = !this.state.alertPanelOpen;
    panel.style.display = this.state.alertPanelOpen ? 'flex' : 'none';
    if (this.state.alertPanelOpen) {
      this.state.alertCount = 0;
      this.updateAlertBadge();
      this.renderAlertPanel();
    }
  },

  async renderAlertPanel() {
    const body = document.getElementById('alertPanelBody');
    if (!body) return;

    // Use cached alerts or fetch
    let alerts = this.state.alerts;
    if (alerts.length === 0) {
      try {
        alerts = await this.api('alerts?limit=20');
        this.state.alerts = alerts;
      } catch (e) { /* ignore */ }
    }

    if (!alerts || alerts.length === 0) {
      body.innerHTML = '<div class="empty-state" style="padding:16px"><p>No alerts</p></div>';
      return;
    }

    body.innerHTML = alerts.slice(0, 20).map(a => `
      <div class="alert-item">
        <div class="alert-severity-dot ${a.severity || 'medium'}"></div>
        <div class="alert-content">
          <div class="alert-message">${a.message}</div>
          <div class="alert-time">${this.timeAgo(a.timestamp)}</div>
        </div>
      </div>
    `).join('');
  },

  // API helper
  async api(path, opts = {}) {
    const res = await fetch(`/api/${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return res.json();
  },

  // Modal helper
  showModal(title, bodyHtml, onSave) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost modal-cancel">Cancel</button>
          <button class="btn btn-primary modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.querySelector('.modal-cancel').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.modal-save').onclick = () => {
      if (onSave) onSave(overlay);
      close();
    };

    return overlay;
  },

  // Relative time
  timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
