// ── Notification Service — ADB Push to Z Fold ───────────
// Sends notifications directly to the phone via ADB over Tailscale.
// Falls back to Twilio SMS if ADB is unavailable and Twilio is configured.
// Same interface as before: send(message), getStatus()

const { execFile } = require('child_process');
const https = require('https');

const ADB_PATH = process.env.ADB_PATH || 'C:/Users/pkoaw/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const ZFOLD_ADDR = process.env.ZFOLD_ADB || '100.99.38.96:5555';

class SmsService {
  constructor() {
    // ADB config
    this.adbPath = ADB_PATH;
    this.zfoldAddr = ZFOLD_ADDR;
    this.adbAvailable = false;
    this.adbSendCount = 0;
    this.lastSent = null;

    // Twilio fallback
    this.sid = process.env.TWILIO_SID || '';
    this.token = process.env.TWILIO_TOKEN || '';
    this.from = process.env.TWILIO_FROM || '';
    this.to = process.env.ALERT_PHONE || '';
    this.twilioConfigured = !!(this.sid && this.token && this.from && this.to);

    this.configured = true; // ADB is always available as primary

    // Check ADB connectivity on startup
    this._checkAdb();
    // Re-check every 2 minutes
    setInterval(() => this._checkAdb(), 120000);
  }

  _checkAdb() {
    return new Promise((resolve) => {
      execFile(this.adbPath, ['-s', this.zfoldAddr, 'shell', 'echo', 'ok'], { timeout: 5000 }, (err, stdout) => {
        this.adbAvailable = !err && stdout.trim() === 'ok';
        if (this.adbAvailable) {
          console.log('[NOTIFY] Z Fold ADB connected');
        } else {
          console.log('[NOTIFY] Z Fold ADB not available — ' + (this.twilioConfigured ? 'Twilio fallback ready' : 'notifications disabled'));
        }
        resolve(this.adbAvailable);
      });
    });
  }

  async send(message) {
    // Try ADB first
    if (this.adbAvailable) {
      const result = await this._sendAdb(message);
      if (result.sent) return result;
      // ADB failed — try Twilio fallback
    }

    // Twilio fallback
    if (this.twilioConfigured) {
      return this._sendTwilio(message);
    }

    return { sent: false, reason: 'No notification channel available' };
  }

  _sendAdb(message) {
    return new Promise((resolve) => {
      // Sanitize message for shell — strip quotes, collapse newlines
      const clean = message.replace(/'/g, '').replace(/"/g, '').replace(/\n/g, ' | ').slice(0, 500);
      const title = 'SweepNspect Hub';

      // Use shell string with single quotes so spaces/special chars pass through correctly
      // Format: cmd notification post -t '<title>' <tag> '<body>'
      const shellCmd = `cmd notification post -t '${title}' hub-alert '${clean}'`;

      execFile(this.adbPath, [
        '-s', this.zfoldAddr,
        'shell', shellCmd
      ], { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          console.log(`[NOTIFY] ADB send failed: ${err.message}`);
          this.adbAvailable = false;
          resolve({ sent: false, reason: 'ADB error: ' + err.message });
        } else {
          this.adbSendCount++;
          this.lastSent = new Date().toISOString();
          console.log(`[NOTIFY] Pushed to Z Fold via ADB`);
          resolve({ sent: true, method: 'adb' });
        }
      });
    });
  }

  _sendTwilio(message) {
    const body = new URLSearchParams({
      To: this.to,
      From: this.from,
      Body: message.slice(0, 1600)
    }).toString();

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.twilio.com',
        port: 443,
        path: `/2010-04-01/Accounts/${this.sid}/Messages.json`,
        method: 'POST',
        auth: `${this.sid}:${this.token}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            this.lastSent = new Date().toISOString();
            resolve({ sent: true, method: 'twilio', sid: JSON.parse(data).sid });
          } else {
            resolve({ sent: false, reason: `Twilio HTTP ${res.statusCode}`, detail: data });
          }
        });
      });

      req.on('error', (err) => resolve({ sent: false, reason: err.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ sent: false, reason: 'timeout' }); });
      req.write(body);
      req.end();
    });
  }

  getStatus() {
    return {
      configured: this.configured,
      method: this.adbAvailable ? 'adb' : (this.twilioConfigured ? 'twilio' : 'none'),
      adb: { available: this.adbAvailable, device: this.zfoldAddr },
      twilio: { configured: this.twilioConfigured },
      sendCount: this.adbSendCount,
      lastSent: this.lastSent,
    };
  }
}

module.exports = SmsService;
