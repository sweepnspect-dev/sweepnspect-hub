// ══════════════════════════════════════════════════════════
// SweepNspect Command Center v2.0 — App Router & State
// Responsive: Phone → Fold Closed → Fold Open → Desktop
// ══════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { id: 'home',      label: 'Home',      icon: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
  { id: 'comms',     label: 'Comms',     icon: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>', badge: 'comms' },
  { id: 'tickets',   label: 'Tickets',   icon: '<svg viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>', badge: 'tickets' },
  { id: 'customers', label: 'Customers', icon: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
  { id: 'revenue',   label: 'Revenue',   icon: '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' },
  { id: 'tasks',     label: 'Tasks',     icon: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>' },
  { id: 'analytics', label: 'Analytics', icon: '<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>' },
  { id: 'marketing', label: 'Marketing', icon: '<svg viewBox="0 0 24 24"><path d="M21 3L14.5 21l-3.5-8-8-3.5z"/></svg>' },
  { id: 'chat',      label: 'Chat',      icon: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>' },
  { id: 'system',    label: 'System',    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' },
];

// Mobile: show first 5, rest in "More" overflow
const MOBILE_TAB_COUNT = 5;

const App = {
  state: {
    stats: null,
    activities: [],
    alerts: [],
    alertCount: 0,
    alertPanelOpen: false,
    currentView: 'home',
    badges: { comms: 0, tickets: 0 }
  },

  views: {},

  // ── Initialization ────────────────────────────────────
  init() {
    // Register views
    if (typeof HomeView !== 'undefined')      this.registerView('home', HomeView);
    if (typeof CommsView !== 'undefined')     this.registerView('comms', CommsView);
    if (typeof TicketsView !== 'undefined')   this.registerView('tickets', TicketsView);
    if (typeof CustomersView !== 'undefined') this.registerView('customers', CustomersView);
    if (typeof RevenueView !== 'undefined')   this.registerView('revenue', RevenueView);
    if (typeof TasksView !== 'undefined')     this.registerView('tasks', TasksView);
    if (typeof AnalyticsView !== 'undefined') this.registerView('analytics', AnalyticsView);
    if (typeof MarketingView !== 'undefined') this.registerView('marketing', MarketingView);
    if (typeof ChatView !== 'undefined')       this.registerView('chat', ChatView);
    if (typeof SystemView !== 'undefined')    this.registerView('system', SystemView);

    // Build navigation
    this.buildSidebarNav();
    this.buildIconRail();
    this.buildTabBar();

    // Route on hash change
    window.addEventListener('hashchange', () => this.route());

    // WebSocket events
    hubSocket.on('init', (data) => this._onStats(data));
    hubSocket.on('stats', (data) => this._onStats(data));

    hubSocket.on('activity', (data) => {
      this.state.activities.unshift(data);
      if (this.state.activities.length > 50) this.state.activities.length = 50;
      const view = this.views[this.state.currentView];
      if (view?.onActivity) view.onActivity(data);
    });

    hubSocket.on('*', (type, data) => {
      const view = this.views[this.state.currentView];
      if (view?.onWsMessage) view.onWsMessage(type, data);
      // Route to TTS engine
      HubTTS.onEvent(type, data);
      // Livechat notification routing
      if (type === 'livechat:start') {
        HubNotify.chatNotify(data);
      } else if (type === 'livechat:message') {
        HubNotify.playSound('chat');
      }
    });

    hubSocket.on('alert', (data) => {
      this.state.alerts.unshift(data);
      if (this.state.alerts.length > 50) this.state.alerts.length = 50;
      this.state.alertCount++;
      this.updateAlertBadge();
      HubNotify.alertToast(data);
      HubNotify.alertDesktop(data);
      HubTTS.onEvent('alert', data);
      const view = this.views[this.state.currentView];
      if (view?.onAlert) view.onAlert(data);
    });

    hubSocket.on('clauser:status', (data) => this.updateClauserStatus(data));
    hubSocket.on('_connected', () => this.setOnline(true));
    hubSocket.on('_disconnected', () => this.setOnline(false));

    // Clock
    this.clockInterval = setInterval(() => this.updateClock(), 1000);
    this.updateClock();

    // Notifications
    HubNotify.init();

    // Voice TTS + STT
    HubTTS.init();
    HubTTS.updateToggleUI();
    HubSTT.init();

    // Hamburger menu (mobile sidebar fallback)
    const hamburger = document.getElementById('hamburger');
    const overlay = document.getElementById('menuOverlay');
    if (hamburger) {
      hamburger.addEventListener('click', () => this.toggleMobileMenu());
    }
    if (overlay) {
      overlay.addEventListener('click', () => this.toggleMobileMenu(false));
    }

    // Initial route
    setTimeout(() => this.route(), 0);
  },

  registerView(name, viewObj) {
    this.views[name] = viewObj;
  },

  // ── Navigation Builders ───────────────────────────────
  buildSidebarNav() {
    const ul = document.getElementById('sidebarNav');
    if (!ul) return;
    ul.innerHTML = NAV_ITEMS.map(item => `
      <li>
        <a href="#${item.id}" data-view="${item.id}">
          <span class="nav-icon">${item.icon}</span>
          ${item.label}
          ${item.badge ? `<span class="nav-badge" data-badge="${item.badge}" style="display:none">0</span>` : ''}
        </a>
      </li>
    `).join('');
  },

  buildIconRail() {
    const rail = document.getElementById('iconRail');
    if (!rail) return;
    rail.innerHTML = `<div class="rail-brand">S</div>` +
      NAV_ITEMS.map(item => `
        <a href="#${item.id}" class="rail-item" data-view="${item.id}" title="${item.label}">
          ${item.icon}
          ${item.badge ? `<span class="rail-badge" data-badge="${item.badge}" style="display:none">0</span>` : ''}
          <span class="rail-tip">${item.label}</span>
        </a>
      `).join('');
  },

  buildTabBar() {
    const bar = document.getElementById('tabBar');
    if (!bar) return;

    // Show first N items as tabs
    const visible = NAV_ITEMS.slice(0, MOBILE_TAB_COUNT);
    const overflow = NAV_ITEMS.slice(MOBILE_TAB_COUNT);

    let html = visible.map(item => `
      <a href="#${item.id}" class="tab-item" data-view="${item.id}">
        ${item.icon}
        ${item.badge ? `<span class="tab-badge" data-badge="${item.badge}" style="display:none">0</span>` : ''}
        <span class="tab-label">${item.label}</span>
      </a>
    `).join('');

    // "More" tab for overflow items
    if (overflow.length > 0) {
      html += `
        <a href="javascript:void(0)" class="tab-item tab-more" id="tabMore" onclick="App.showMoreMenu(event)">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          <span class="tab-label">More</span>
        </a>
      `;
    }

    bar.innerHTML = html;
    this._overflowItems = overflow;
  },

  showMoreMenu(e) {
    e.preventDefault();
    const existing = document.getElementById('moreMenu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'moreMenu';
    menu.style.cssText = `
      position: fixed; bottom: calc(var(--tab-h) + 8px); right: 8px;
      background: var(--soot); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 6px 0; z-index: 100;
      box-shadow: 0 12px 40px rgba(0,0,0,0.4); min-width: 160px;
    `;

    menu.innerHTML = this._overflowItems.map(item => `
      <a href="#${item.id}" style="display:flex;align-items:center;gap:10px;padding:10px 16px;color:var(--text-dim);text-decoration:none;font-size:13px;transition:background 0.1s"
         onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''"
         onclick="document.getElementById('moreMenu')?.remove()">
        <span style="width:18px;height:18px;display:flex;align-items:center;justify-content:center">${item.icon}</span>
        ${item.label}
      </a>
    `).join('');

    document.body.appendChild(menu);

    // Close on outside click
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 0);
  },

  toggleMobileMenu(forceState) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('menuOverlay');
    const isOpen = sidebar.classList.contains('mobile-open');
    const shouldOpen = forceState !== undefined ? forceState : !isOpen;

    if (shouldOpen) {
      sidebar.classList.add('mobile-open');
      sidebar.style.cssText = 'display:flex;position:fixed;top:0;left:0;bottom:0;width:260px;z-index:25;';
      overlay.classList.add('open');
    } else {
      sidebar.classList.remove('mobile-open');
      sidebar.style.cssText = '';
      overlay.classList.remove('open');
    }
  },

  // ── Routing ───────────────────────────────────────────
  route() {
    const hash = location.hash.slice(1) || 'home';
    const viewName = hash.split('/')[0];

    if (!this.views[viewName]) {
      location.hash = '#home';
      return;
    }

    this.state.currentView = viewName;

    // Close mobile menu if open
    this.toggleMobileMenu(false);
    document.getElementById('moreMenu')?.remove();

    // Update nav active states
    document.querySelectorAll('[data-view]').forEach(el => {
      el.classList.toggle('active', el.dataset.view === viewName);
    });

    // Update header title
    const titles = {
      home: 'Home', comms: 'Communications', tickets: 'Support Tickets',
      customers: 'Subscriber Care', revenue: 'Revenue', tasks: 'Tasks',
      analytics: 'Analytics', marketing: 'Marketing', chat: 'Chat', system: 'System'
    };
    document.getElementById('viewTitle').textContent = titles[viewName] || viewName;

    // Render view
    const container = document.getElementById('viewContainer');
    const view = this.views[viewName];
    if (view?.render) {
      container.innerHTML = '';
      view.render(container, hash);
      // Trigger enter animation
      container.firstElementChild?.classList.add('view-enter');
    }

    // Pass current stats
    if (this.state.stats && view?.onStats) {
      view.onStats(this.state.stats);
    }
  },

  // ── Stats & Badges ────────────────────────────────────
  _onStats(data) {
    this.state.stats = data;
    this.updateHeaderStats();
    this.updateNavBadges();
    const view = this.views[this.state.currentView];
    if (view?.onStats) view.onStats(data);
  },

  updateHeaderStats() {
    const s = this.state.stats;
    if (!s) return;
    const el = (id) => document.getElementById(id);
    if (el('qsTicketsVal')) el('qsTicketsVal').textContent = s.tickets?.open || 0;
    if (el('qsSubsVal')) el('qsSubsVal').textContent = s.subscribers?.active || 0;
    if (el('qsMrrVal')) el('qsMrrVal').textContent = `$${(s.revenue?.mrr || 0).toLocaleString()}`;
  },

  updateNavBadges() {
    const s = this.state.stats;
    if (!s) return;

    const ticketCount = s.tickets?.open || 0;
    const livechatActive = s.livechat?.active || 0;
    const commsCount = (s.inbox?.unread || 0) + livechatActive;

    this.state.badges = { tickets: ticketCount, comms: commsCount };

    // Update all badge elements
    document.querySelectorAll('[data-badge="tickets"]').forEach(el => {
      el.textContent = ticketCount;
      el.style.display = ticketCount > 0 ? '' : 'none';
    });

    document.querySelectorAll('[data-badge="comms"]').forEach(el => {
      el.textContent = commsCount;
      el.style.display = commsCount > 0 ? '' : 'none';
    });
  },

  // ── Clauser Status ────────────────────────────────────
  updateClauserStatus(data) {
    const map = {
      online:  { cls: 'online',  text: 'Clauser: Idle' },
      working: { cls: 'working', text: 'Clauser: Working' },
      paused:  { cls: 'paused',  text: 'Clauser: Paused' },
      offline: { cls: 'offline', text: 'Clauser: Offline' }
    };
    const s = map[data.status] || map.offline;

    // Sidebar
    const sbDot = document.getElementById('sidebarClauserDot');
    const sbLabel = document.getElementById('sidebarClauserLabel');
    if (sbDot) sbDot.className = `clauser-dot ${s.cls}`;
    if (sbLabel) sbLabel.textContent = s.text;

    // Forward to current view
    const view = this.views[this.state.currentView];
    if (view?.onClauserStatus) view.onClauserStatus(data);
  },

  // ── Connection ────────────────────────────────────────
  setOnline(online) {
    const cls = online ? 'online' : 'offline';
    const text = online ? 'Connected' : 'Offline';

    // Sidebar
    const sbDot = document.getElementById('sidebarDot');
    const sbLabel = document.getElementById('sidebarConnLabel');
    if (sbDot) sbDot.className = `status-dot ${cls}`;
    if (sbLabel) sbLabel.textContent = text;
  },

  // ── Clock ─────────────────────────────────────────────
  updateClock() {
    const el = document.getElementById('headerClock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  },

  // ── Alert Panel ───────────────────────────────────────
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

    let alerts = this.state.alerts;
    if (alerts.length === 0) {
      try { alerts = await this.api('alerts?limit=20'); this.state.alerts = alerts; } catch (e) {}
    }

    if (!alerts || alerts.length === 0) {
      body.innerHTML = '<div class="empty-state"><p>No alerts</p></div>';
      return;
    }

    body.innerHTML = alerts.slice(0, 20).map(a => `
      <div class="alert-item">
        <div class="alert-severity-dot ${a.severity || 'medium'}"></div>
        <div>
          <div class="alert-message">${a.message}</div>
          <div class="alert-time">${this.timeAgo(a.timestamp)}</div>
        </div>
      </div>
    `).join('');
  },

  // ── API Helper ────────────────────────────────────────
  async api(path, opts = {}) {
    const res = await fetch(`/api/${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return res.json();
  },

  // ── Modal Helper ──────────────────────────────────────
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

    // Focus first input
    const firstInput = overlay.querySelector('input, textarea, select');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);

    return overlay;
  },

  // ── Time Helper ───────────────────────────────────────
  timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  },

  // ── Escape Helper ─────────────────────────────────────
  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
