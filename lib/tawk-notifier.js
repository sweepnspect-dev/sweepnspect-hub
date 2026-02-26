// ── Tawk Notifier — Email-to-Ticket Bridge ───────────────
// Sends formatted emails to Tawk.to ticketing address, creating tickets
// that trigger push notifications on Jonathan's phone.
//
// Tawk.to ticketing email: {property-name}@tickets.tawk.to
// Set via TAWK_TICKET_EMAIL env var.

const nodemailer = require('nodemailer');

const PRIORITY_EMOJI = {
  critical: '🔴',
  high: '🟠',
  normal: '🟡',
  low: '🟢',
};

const EVENT_LABELS = {
  'founding-application': 'FOUNDING',
  'chat-start': 'LIVE CHAT',
  'facebook-message': 'FB MESSAGE',
  'facebook-comment': 'FB COMMENT',
  'ticket-chat': 'CHAT TICKET',
  'ticket-webhook': 'WEBHOOK',
  'email-bug': 'BUG REPORT',
  'email-billing': 'BILLING',
  'email-founding': 'FOUNDING EMAIL',
  'email-demo': 'DEMO REQUEST',
  'clauser-offline': 'SYSTEM',
};

class TawkNotifier {
  constructor(smtpConfig) {
    this.tawkEmail = process.env.TAWK_TICKET_EMAIL || '';
    this.fromEmail = process.env.IMAP_USER || 'contact@sweepnspect.com';
    this.configured = false;
    this.transporter = null;
    this.sendCount = 0;
    this.lastSent = null;
    this.cooldowns = new Map(); // type → last send timestamp
    this.cooldownMs = parseInt(process.env.TAWK_COOLDOWN_MS || '300000'); // 5 min default

    if (!this.tawkEmail) {
      console.log('[TAWK-NOTIFY] No TAWK_TICKET_EMAIL set — Tawk notifications disabled');
      console.log('[TAWK-NOTIFY] Set TAWK_TICKET_EMAIL=sweepnspect@tickets.tawk.to (check Tawk dashboard > Admin > Ticketing)');
      return;
    }

    if (!smtpConfig || !smtpConfig.auth?.pass) {
      console.log('[TAWK-NOTIFY] No SMTP credentials — Tawk notifications disabled');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure !== undefined ? smtpConfig.secure : false,
      auth: smtpConfig.auth,
    });

    this.configured = true;
    console.log(`[TAWK-NOTIFY] Configured — routing priority alerts to ${this.tawkEmail}`);
  }

  /**
   * Send a priority alert to Tawk.to as a ticket.
   * Returns { sent: boolean, reason?: string }
   */
  async send(alert) {
    if (!this.configured) return { sent: false, reason: 'not configured' };

    // Per-type cooldown — don't spam Tawk for the same event type
    const lastSent = this.cooldowns.get(alert.type) || 0;
    if (Date.now() - lastSent < this.cooldownMs) {
      return { sent: false, reason: `cooldown (${Math.round((this.cooldownMs - (Date.now() - lastSent)) / 1000)}s remaining)` };
    }

    const emoji = PRIORITY_EMOJI[alert.severity] || '⚪';
    const label = EVENT_LABELS[alert.type] || alert.type.toUpperCase();
    const subject = `${emoji} [${label}] ${alert.message.substring(0, 120)}`;

    // Build a clean body with metadata
    const lines = [
      `Priority: ${alert.severity.toUpperCase()}`,
      `Source: ${alert.type}`,
      `Time: ${alert.timestamp}`,
      '',
      alert.message,
      '',
    ];

    // Add metadata details
    if (alert.data) {
      const d = alert.data;
      if (d.email) lines.push(`Email: ${d.email}`);
      if (d.subscriberId) lines.push(`Subscriber: ${d.subscriberId}`);
      if (d.ticketId) lines.push(`Ticket: ${d.ticketId}`);
      if (d.chatId) lines.push(`Chat: ${d.chatId}`);
      if (d.facebookSenderId) lines.push(`FB Sender: ${d.facebookSenderId}`);
      if (d.from?.name) lines.push(`From: ${d.from.name}`);
      if (d.commentId) lines.push(`Comment: ${d.commentId}`);
      if (d.postId) lines.push(`Post: ${d.postId}`);
    }

    lines.push('', '— SweepNspect HQ Alert System');

    try {
      await this.transporter.sendMail({
        from: `"SweepNspect HQ" <${this.fromEmail}>`,
        to: this.tawkEmail,
        subject,
        text: lines.join('\n'),
      });

      this.cooldowns.set(alert.type, Date.now());
      this.sendCount++;
      this.lastSent = new Date().toISOString();

      console.log(`[TAWK-NOTIFY] Sent: ${subject}`);
      return { sent: true };
    } catch (err) {
      console.error(`[TAWK-NOTIFY] Failed: ${err.message}`);
      return { sent: false, reason: err.message };
    }
  }

  getStatus() {
    return {
      configured: this.configured,
      tawkEmail: this.configured ? this.tawkEmail : null,
      sendCount: this.sendCount,
      lastSent: this.lastSent,
      cooldownMs: this.cooldownMs,
    };
  }
}

module.exports = TawkNotifier;
