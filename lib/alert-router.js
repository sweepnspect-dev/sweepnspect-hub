// ── Alert Router — Central Alert System ──────────────────
// alertRouter.send(type, severity, message, data) → persists, broadcasts, queues SMS

const fs = require('fs');
const path = require('path');

const ALERTS_FILE = path.join(__dirname, '..', 'data', 'alerts.json');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');
const MAX_ALERTS = 200;

class AlertRouter {
  constructor(broadcast, smsService) {
    this.broadcast = broadcast;
    this.sms = smsService;
    this.tawk = null; // Set via setTawkNotifier() after SMTP is ready
    this.smsBatch = [];
    this.smsBatchTimer = null;
    this.cooldowns = new Map(); // type → last SMS timestamp
  }

  setTawkNotifier(tawkNotifier) {
    this.tawk = tawkNotifier;
  }

  _readAlerts() {
    try { return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); }
    catch { return []; }
  }

  _writeAlerts(alerts) {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  }

  _readConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { return {}; }
  }

  _writeConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  getConfig() {
    const config = this._readConfig();
    return config.alerts || {
      sms: { enabled: false, batchWindowMs: 30000, cooldownMs: 300000 },
      desktop: { enabled: true }
    };
  }

  updateConfig(updates) {
    const config = this._readConfig();
    config.alerts = { ...this.getConfig(), ...updates };
    this._writeConfig(config);
    return config.alerts;
  }

  send(type, severity, message, data = {}) {
    const alert = {
      id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      severity,
      message,
      data,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };

    // Persist
    const alerts = this._readAlerts();
    alerts.unshift(alert);
    if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
    this._writeAlerts(alerts);

    // Broadcast via WebSocket
    if (this.broadcast) {
      this.broadcast({ type: 'alert', data: alert });
    }

    // Queue SMS for critical/high severity
    if (['critical', 'high'].includes(severity)) {
      this._queueSms(alert);
    }

    // Send to Tawk.to for critical/high severity (creates ticket → push notification)
    if (['critical', 'high'].includes(severity) && this.tawk) {
      this.tawk.send(alert).catch(err => {
        console.error(`[ALERT] Tawk notify error: ${err.message}`);
      });
    }

    console.log(`[ALERT] ${severity.toUpperCase()}: ${message}`);
    return alert;
  }

  _queueSms(alert) {
    const config = this.getConfig();
    if (!config.sms?.enabled || !this.sms?.configured) return;

    // Per-type cooldown
    const cooldownMs = config.sms.cooldownMs || 300000;
    const lastSent = this.cooldowns.get(alert.type) || 0;
    if (Date.now() - lastSent < cooldownMs) return;

    this.smsBatch.push(alert);

    // Batch window
    if (!this.smsBatchTimer) {
      const batchWindowMs = config.sms.batchWindowMs || 30000;
      this.smsBatchTimer = setTimeout(() => this._flushSmsBatch(), batchWindowMs);
    }
  }

  async _flushSmsBatch() {
    this.smsBatchTimer = null;
    if (this.smsBatch.length === 0) return;

    const batch = this.smsBatch.splice(0);
    const lines = batch.map(a =>
      `[${a.severity.toUpperCase()}] ${a.message}`
    );
    const smsText = `SweepNspect Alert${batch.length > 1 ? `s (${batch.length})` : ''}:\n${lines.join('\n')}`;

    const result = await this.sms.send(smsText);
    if (result.sent) {
      batch.forEach(a => this.cooldowns.set(a.type, Date.now()));
      console.log(`[SMS] Sent ${batch.length} alert(s)`);
    } else {
      console.log(`[SMS] Failed: ${result.reason}`);
    }
  }

  getAlerts(limit = 50) {
    return this._readAlerts().slice(0, limit);
  }

  acknowledge(alertId) {
    const alerts = this._readAlerts();
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this._writeAlerts(alerts);
    }
    return alert;
  }
}

module.exports = AlertRouter;
