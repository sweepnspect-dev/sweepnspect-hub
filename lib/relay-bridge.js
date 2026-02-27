// ── Relay Bridge — Connects Hub to Hive Relay (port 4747) ──────
// Proxies relay status, messages, tasks into Hub.
// Polls heartbeats and broadcasts system health to Hub WebSocket.

const http = require('http');

const RELAY_URL = process.env.RELAY_URL || 'http://127.0.0.1:4747';

class RelayBridge {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.connected = false;
    this.lastCheck = null;
    this.healthInterval = null;
  }

  // ── HTTP helper ──────────────────────────────────────────
  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, RELAY_URL);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      });

      req.on('error', (err) => {
        this.connected = false;
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        this.connected = false;
        reject(new Error('Relay timeout'));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // ── Public API ───────────────────────────────────────────

  async getStatus() {
    try {
      const status = await this._request('GET', '/status');
      this.connected = true;
      this.lastCheck = new Date().toISOString();
      return { connected: true, ...status };
    } catch (err) {
      this.connected = false;
      this.lastCheck = new Date().toISOString();
      return { connected: false, error: err.message };
    }
  }

  async getHealth() {
    try {
      const health = await this._request('GET', '/health');
      this.connected = true;
      return health;
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  async getMessages(recipient = 'hub') {
    try {
      return await this._request('GET', `/msg?for=${recipient}`);
    } catch (err) {
      return { messages: [], count: 0, error: err.message };
    }
  }

  async peekMessages(recipient = 'hub') {
    try {
      return await this._request('GET', `/msg/peek?for=${recipient}`);
    } catch (err) {
      return { messages: [], count: 0, error: err.message };
    }
  }

  async sendMessage(from, to, body) {
    return this._request('POST', '/msg', { from, to, body });
  }

  async getHistory(last = 20) {
    try {
      return await this._request('GET', `/msg/history?last=${last}`);
    } catch (err) {
      return { messages: [], count: 0, error: err.message };
    }
  }

  async getTasks(filters = {}) {
    try {
      const query = Object.entries(filters)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
      const path = query ? `/task?${query}` : '/task';
      return await this._request('GET', path);
    } catch (err) {
      return { tasks: [], count: 0, error: err.message };
    }
  }

  async createTask(title, assignee, opts = {}) {
    return this._request('POST', '/task', {
      title,
      assignee,
      creator: 'hub',
      ...opts
    });
  }

  async dispatch(prompt, cwd) {
    return this._request('POST', '/dispatch', { prompt, cwd });
  }

  async getHeartbeats() {
    try {
      return await this._request('GET', '/heartbeat');
    } catch (err) {
      return {};
    }
  }

  async postHeartbeat(node, status, extra = {}) {
    return this._request('POST', '/heartbeat', { node, status, ...extra });
  }

  // ── Health Polling ───────────────────────────────────────
  // Broadcasts relay + mesh health to Hub WebSocket every 30s

  startHealthPolling(intervalMs = 30000) {
    if (this.healthInterval) return;

    const poll = async () => {
      try {
        const health = await this.getHealth();
        this.connected = true;
        this.broadcast({ type: 'relay:health', data: health });

        // Post Hub's heartbeat to relay
        await this.postHeartbeat('hub', 'online', {
          port: 8888,
          uptime: process.uptime()
        }).catch(() => {});
      } catch {
        this.connected = false;
        this.broadcast({ type: 'relay:health', data: { connected: false } });
      }
    };

    poll(); // immediate first check
    this.healthInterval = setInterval(poll, intervalMs);
  }

  stopHealthPolling() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  getConnectionStatus() {
    return {
      connected: this.connected,
      relayUrl: RELAY_URL,
      lastCheck: this.lastCheck
    };
  }
}

module.exports = RelayBridge;
