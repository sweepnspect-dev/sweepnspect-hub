// ── SMS Service — Twilio Wrapper ─────────────────────────
// Reads TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, ALERT_PHONE env vars.
// Gracefully no-ops when unconfigured.

const https = require('https');

class SmsService {
  constructor() {
    this.sid = process.env.TWILIO_SID || '';
    this.token = process.env.TWILIO_TOKEN || '';
    this.from = process.env.TWILIO_FROM || '';
    this.to = process.env.ALERT_PHONE || '';
    this.configured = !!(this.sid && this.token && this.from && this.to);

    if (!this.configured) {
      console.log('[SMS] Twilio not configured — SMS alerts disabled');
    } else {
      console.log('[SMS] Twilio configured — SMS alerts enabled');
    }
  }

  async send(message) {
    if (!this.configured) return { sent: false, reason: 'not configured' };

    try {
      const body = new URLSearchParams({
        To: this.to,
        From: this.from,
        Body: message.slice(0, 1600) // Twilio limit
      }).toString();

      return new Promise((resolve, reject) => {
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
              resolve({ sent: true, sid: JSON.parse(data).sid });
            } else {
              resolve({ sent: false, reason: `HTTP ${res.statusCode}`, detail: data });
            }
          });
        });

        req.on('error', (err) => {
          resolve({ sent: false, reason: err.message });
        });
        req.setTimeout(10000, () => {
          req.destroy();
          resolve({ sent: false, reason: 'timeout' });
        });
        req.write(body);
        req.end();
      });
    } catch (err) {
      return { sent: false, reason: err.message };
    }
  }

  getStatus() {
    return {
      configured: this.configured,
      to: this.configured ? this.to.replace(/.(?=.{4})/g, '*') : null
    };
  }
}

module.exports = SmsService;
