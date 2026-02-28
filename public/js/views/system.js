// ══════════════════════════════════════════════════════════
// System View — Hive Relay, Service Health, Clauser Agent
// ══════════════════════════════════════════════════════════
const SystemView = {
  health: null,
  relayStatus: null,
  relayMessages: [],

  render(container) {
    container.innerHTML = `
      <div class="system-view">
        <div class="stat-grid">
          <div class="stat-card" id="sysRelayCard">
            <div class="stat-label">Hive Relay</div>
            <div class="stat-value" id="sysRelayStatus">-</div>
            <div class="stat-sub" id="sysRelaySub">Checking...</div>
          </div>
          <div class="stat-card" id="sysClauserCard">
            <div class="stat-label">Clauser Agent</div>
            <div class="stat-value" id="sysClauserStatus">-</div>
            <div class="stat-sub" id="sysClauserSub"></div>
          </div>
          <div class="stat-card" id="sysHqCard">
            <div class="stat-label">HQ Server</div>
            <div class="stat-value" id="sysHqStatus">-</div>
            <div class="stat-sub" id="sysHqSub"></div>
          </div>
          <div class="stat-card" id="sysWorkerCard">
            <div class="stat-label">Edge Worker</div>
            <div class="stat-value" id="sysWorkerStatus">-</div>
            <div class="stat-sub" id="sysWorkerSub"></div>
          </div>
        </div>

        <div class="panel-grid">
          <div class="panel">
            <div class="panel-header">
              <h2>Services</h2>
              <button class="btn btn-sm btn-ghost" onclick="SystemView.loadHealth()">Refresh</button>
            </div>
            <div class="panel-body" id="sysServiceList">
              <div class="empty-state" style="padding:16px"><p>Checking services...</p></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <h2>Hive Mesh</h2>
            </div>
            <div class="panel-body" id="sysMeshList">
              <div class="empty-state" style="padding:16px"><p>Loading mesh status...</p></div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>Relay Messages</h2>
            <button class="btn btn-sm btn-ghost" onclick="SystemView.loadRelayMessages()">Refresh</button>
          </div>
          <div class="panel-body" id="sysRelayMessages">
            <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>Data Management</h2>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-ghost" onclick="SystemView.loadStores()">Refresh</button>
              <button class="btn btn-sm" style="background:var(--brick);color:#fff" onclick="SystemView.purgeAll()">Purge All Data</button>
            </div>
          </div>
          <div class="panel-body" id="sysDataStores">
            <div class="empty-state" style="padding:16px"><p>Loading stores...</p></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>WebSocket Events</h2>
          </div>
          <div class="panel-body">
            <div class="sys-events" id="sysEventLog">
              <div class="empty-state" style="padding:16px"><p>Listening for events...</p></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.eventLog = [];
    this.loadHealth();
    this.loadRelayStatus();
    this.loadRelayMessages();
    this.loadStores();
  },

  async loadHealth() {
    try {
      const svc = await App.api('system/services').catch(() => null);
      this.services = svc;

      const el = (id) => document.getElementById(id);

      if (svc) {
        // Relay card
        if (el('sysRelayStatus')) {
          el('sysRelayStatus').textContent = svc.relay.status === 'online' ? 'Connected' : 'Offline';
          el('sysRelayStatus').className = `stat-value ${svc.relay.status === 'online' ? 'success' : 'danger'}`;
          el('sysRelaySub').textContent = svc.relay.detail;
        }

        // Clauser card
        if (el('sysClauserStatus')) {
          const statusMap = { online: 'Online', offline: 'Offline' };
          const colorMap = { online: 'success', offline: 'danger' };
          el('sysClauserStatus').textContent = statusMap[svc.clauser.status] || 'Offline';
          el('sysClauserStatus').className = `stat-value ${colorMap[svc.clauser.status] || 'danger'}`;
          el('sysClauserSub').textContent = svc.clauser.detail;
        }

        // HQ card
        if (el('sysHqStatus')) {
          el('sysHqStatus').textContent = 'Running';
          el('sysHqStatus').className = 'stat-value success';
          el('sysHqSub').textContent = svc.hq.detail;
        }

        // Worker card
        if (el('sysWorkerStatus')) {
          const wMap = { online: ['Running', 'success'], error: ['Error', 'danger'], offline: ['Offline', 'text-dim'] };
          const w = wMap[svc.worker.status] || wMap.offline;
          el('sysWorkerStatus').textContent = w[0];
          el('sysWorkerStatus').className = `stat-value ${w[1]}`;
          el('sysWorkerSub').textContent = svc.worker.detail;
        }
      }

      this.renderServices(svc);
    } catch (e) {
      console.error('System health error:', e);
    }
  },

  async loadRelayStatus() {
    try {
      const data = await App.api('relay/status').catch(() => null);
      this.relayStatus = data;
      if (data) this.renderMesh(data);
    } catch {}
  },

  async loadRelayMessages() {
    const el = document.getElementById('sysRelayMessages');
    if (!el) return;
    try {
      const data = await App.api('relay/messages').catch(() => ({ messages: [] }));
      this.relayMessages = data.messages || [];
      this.renderRelayMessages();
    } catch (e) {
      el.innerHTML = `<div class="empty-state" style="padding:16px"><p>Cannot load relay messages</p></div>`;
    }
  },

  renderServices(svc) {
    const el = document.getElementById('sysServiceList');
    if (!el) return;

    if (!svc) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>Cannot reach services endpoint</p></div>';
      return;
    }

    const services = [
      { name: 'HQ Server',        ...svc.hq },
      { name: 'WebSocket',        ...svc.ws },
      { name: 'Email Poller',     ...svc.email },
      { name: 'Facebook Hooks',   ...svc.facebook },
      { name: 'Clauser Agent',    ...svc.clauser },
      { name: 'AI Proxy',         ...svc.ai },
      { name: 'Hive Relay',       ...svc.relay },
      { name: 'Cloudflare Worker', ...svc.worker },
    ];

    el.innerHTML = services.map(s => {
      const dotCls = s.status === 'online' ? 'online' : s.status === 'error' ? 'offline' : s.status === 'standby' ? '' : s.status === 'offline' ? 'offline' : '';
      const labelCls = s.status === 'online' ? 'online' : s.status === 'error' ? 'offline' : s.status === 'standby' ? 'unknown' : 'offline';
      return `
        <div class="service-item">
          <span class="status-dot ${dotCls}"></span>
          <div class="service-info">
            <div class="service-name">${s.name}</div>
            <div class="service-detail">${s.detail}</div>
          </div>
          <span class="service-status-label ${labelCls}">${s.status}</span>
        </div>
      `;
    }).join('');
  },

  renderMesh(data) {
    const el = document.getElementById('sysMeshList');
    if (!el) return;

    const nodes = data.nodes || [];
    if (nodes.length === 0) {
      // Show expected nodes even if relay is offline
      el.innerHTML = `
        <div class="mesh-node">
          <div class="mesh-node-icon">T</div>
          <div class="mesh-node-info">
            <div class="mesh-node-name">GENESIS (T)</div>
            <div class="mesh-node-detail">Windows &middot; 100.73.4.77</div>
          </div>
          <span class="status-dot online"></span>
        </div>
        <div class="mesh-node">
          <div class="mesh-node-icon">Z</div>
          <div class="mesh-node-info">
            <div class="mesh-node-name">Z Fold (Z)</div>
            <div class="mesh-node-detail">Android &middot; 100.99.38.96</div>
          </div>
          <span class="status-dot offline"></span>
        </div>
      `;
      return;
    }

    el.innerHTML = nodes.map(n => {
      const online = n.lastSeen && (Date.now() - new Date(n.lastSeen).getTime()) < 120000;
      return `
        <div class="mesh-node">
          <div class="mesh-node-icon">${(n.name || n.id || '?')[0].toUpperCase()}</div>
          <div class="mesh-node-info">
            <div class="mesh-node-name">${App.esc(n.name || n.id)}</div>
            <div class="mesh-node-detail">${n.platform || ''} ${n.ip ? '&middot; ' + n.ip : ''} ${n.lastSeen ? '&middot; ' + App.timeAgo(n.lastSeen) : ''}</div>
          </div>
          <span class="status-dot ${online ? 'online' : 'offline'}"></span>
        </div>
      `;
    }).join('');
  },

  renderRelayMessages() {
    const el = document.getElementById('sysRelayMessages');
    if (!el) return;

    if (this.relayMessages.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No relay messages</p></div>';
      return;
    }

    el.innerHTML = `<div class="relay-message-list">${this.relayMessages.slice(0, 30).map(m => `
      <div class="relay-msg">
        <div class="relay-msg-header">
          <span class="relay-msg-from">${App.esc(m.from || 'unknown')}</span>
          <span class="relay-msg-arrow">&rarr;</span>
          <span class="relay-msg-to">${App.esc(m.to || 'broadcast')}</span>
          <span class="relay-msg-time">${m.ts ? App.timeAgo(m.ts) : ''}</span>
        </div>
        <div class="relay-msg-body">${App.esc((m.text || m.body || '').slice(0, 200))}</div>
      </div>
    `).join('')}</div>`;
  },

  onWsMessage(type, data) {
    // Log events
    this.eventLog = this.eventLog || [];
    this.eventLog.unshift({ type, time: new Date().toISOString(), data: JSON.stringify(data).slice(0, 100) });
    if (this.eventLog.length > 50) this.eventLog.length = 50;
    this.renderEventLog();

    // Auto-refresh on system events
    if (type === 'relay:message' || type === 'relay:heartbeat' || type === 'system:health') {
      this.loadRelayStatus();
    }
  },

  renderEventLog() {
    const el = document.getElementById('sysEventLog');
    if (!el || !this.eventLog || this.eventLog.length === 0) return;

    el.innerHTML = this.eventLog.slice(0, 20).map(e => `
      <div class="sys-event-row">
        <span class="sys-event-type">${App.esc(e.type)}</span>
        <span class="sys-event-data">${App.esc(e.data)}</span>
        <span class="sys-event-time">${App.timeAgo(e.time)}</span>
      </div>
    `).join('');
  },

  async loadStores() {
    const el = document.getElementById('sysDataStores');
    if (!el) return;
    try {
      const stores = await App.api('data/stores');
      el.innerHTML = Object.entries(stores).map(([key, s]) => `
        <div class="data-store-row">
          <div class="data-store-info">
            <span class="data-store-name">${s.label}</span>
            <span class="data-store-file">${s.file}</span>
          </div>
          <span class="data-store-count">${s.count} record${s.count !== 1 ? 's' : ''}</span>
          <button class="btn btn-sm btn-ghost" style="color:var(--brick-light)" onclick="SystemView.purgeStore('${key}', '${App.esc(s.label)}')" ${s.count === 0 ? 'disabled' : ''}>Purge</button>
        </div>
      `).join('');
    } catch (e) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>Cannot load stores</p></div>';
    }
  },

  async purgeStore(key, label) {
    if (!confirm(`Delete all ${label} data? This cannot be undone.`)) return;
    try {
      await App.api(`data/${key}`, { method: 'DELETE' });
      HubNotify.toast(`${label} purged`, 'success');
      this.loadStores();
    } catch (e) {
      HubNotify.toast(`Failed to purge ${label}`, 'error');
    }
  },

  async purgeAll() {
    if (!confirm('Delete ALL data across every store? This cannot be undone.')) return;
    if (!confirm('Are you sure? Tickets, subscribers, revenue, comms, alerts — everything goes.')) return;
    try {
      await App.api('data', { method: 'DELETE' });
      HubNotify.toast('All data purged', 'success');
      this.loadStores();
    } catch (e) {
      HubNotify.toast('Failed to purge data', 'error');
    }
  },

  onClauserStatus(data) {
    const el = (id) => document.getElementById(id);
    if (el('sysClauserStatus')) {
      const statusMap = { online: 'Online', working: 'Working', paused: 'Paused', offline: 'Offline' };
      const colorMap = { online: 'success', working: 'brass', paused: 'text-dim', offline: 'danger' };
      el('sysClauserStatus').textContent = statusMap[data.status] || 'Offline';
      el('sysClauserStatus').className = `stat-value ${colorMap[data.status] || 'danger'}`;
      el('sysClauserSub').textContent = data.currentTask || '';
    }
  }
};
