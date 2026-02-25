// ── Email Poller — IMAP listener for contact@sweepnspect.com ──
const { ImapFlow } = require('imapflow');

class EmailPoller {
  constructor(broadcast, alertRouter, emailRouter) {
    this.broadcast = broadcast;
    this.alertRouter = alertRouter;
    this.emailRouter = emailRouter;
    this.emails = [];
    this.seenUids = new Set();
    this.checkCount = 0;
    this.lastCheck = null;
    this.status = 'starting';
    this.error = null;
    this.pollTimer = null;

    // Config from env or defaults
    this.config = {
      host: process.env.IMAP_HOST || 'mail.privateemail.com',
      port: parseInt(process.env.IMAP_PORT || '993'),
      user: process.env.IMAP_USER || 'contact@sweepnspect.com',
      pass: process.env.IMAP_PASS || '',
      pollInterval: parseInt(process.env.EMAIL_POLL_INTERVAL || '30000'),
    };
  }

  async start() {
    if (!this.config.pass) {
      console.log('[EMAIL] No IMAP_PASS set — email poller disabled');
      this.status = 'disabled';
      return;
    }

    console.log(`[EMAIL] Polling ${this.config.user} every ${this.config.pollInterval / 1000}s`);

    // First check
    await this.check();

    // Schedule recurring checks
    this.pollTimer = setInterval(() => this.check(), this.config.pollInterval);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = 'stopped';
  }

  async check() {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.user, pass: this.config.pass },
      logger: false,
    });

    try {
      await client.connect();
      this.status = 'connected';

      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages = [];
        for await (const msg of client.fetch('1:*', {
          envelope: true,
          flags: true,
          uid: true,
        })) {
          const sender = msg.envelope.from?.[0];
          let fromAddr = '';
          if (sender) {
            fromAddr = sender.address || (sender.mailbox && sender.host ? `${sender.mailbox}@${sender.host}` : '');
          }
          messages.push({
            uid: msg.uid,
            subject: msg.envelope.subject || '(no subject)',
            from: { name: sender?.name || '', address: fromAddr },
            to: msg.envelope.to?.map(t => ({ name: t.name || '', address: t.address || '' })) || [],
            date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
            unread: !msg.flags.has('\\Seen'),
          });
        }

        // Sort newest first
        messages.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Detect new messages (after first load)
        if (this.checkCount > 0) {
          const newMsgs = messages.filter(m => !this.seenUids.has(m.uid));
          for (const msg of newMsgs) {
            console.log(`[EMAIL] NEW: ${msg.from.name || msg.from.address}: ${msg.subject}`);

            // Broadcast raw email:new event
            this.broadcast({ type: 'email:new', data: msg });

            // Route through classifier — handles alerts, auto-create, activity feed
            if (this.emailRouter) {
              await this.emailRouter.processNew(msg);
            }
          }
        }

        // Update state
        messages.forEach(m => this.seenUids.add(m.uid));
        this.emails = messages;
        this.lastCheck = new Date().toISOString();
        this.error = null;
        this.checkCount++;

      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      console.error(`[EMAIL] Error: ${err.message}`);
    }
  }

  // Connect helper — returns an authenticated client
  async _connect() {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.user, pass: this.config.pass },
      logger: false,
    });
    await client.connect();
    return client;
  }

  // Fetch a single email's full content by UID
  async fetchOne(uid) {
    const client = await this._connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const msg = await client.fetchOne(String(uid), {
          envelope: true,
          source: true,
          flags: true,
        }, { uid: true });
        if (!msg) return null;

        // Parse the raw source to extract text body
        const raw = msg.source.toString();
        const body = this._extractBody(raw);

        const sender = msg.envelope.from?.[0];
        const fromAddr = sender?.address || '';

        // Mark as seen
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

        // Update local state
        const local = this.emails.find(e => e.uid === uid);
        if (local) local.unread = false;

        return {
          uid: msg.uid,
          subject: msg.envelope.subject || '(no subject)',
          from: { name: sender?.name || '', address: fromAddr },
          to: msg.envelope.to?.map(t => ({ name: t.name || '', address: t.address || '' })) || [],
          cc: msg.envelope.cc?.map(t => ({ name: t.name || '', address: t.address || '' })) || [],
          replyTo: msg.envelope.replyTo?.[0]?.address || fromAddr,
          date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
          messageId: msg.envelope.messageId || '',
          body,
        };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  // Extract plain text body from raw email source
  _extractBody(raw) {
    // Try to find text/plain part
    // Handle both simple and multipart messages
    const lines = raw.split(/\r?\n/);
    let inBody = false;
    let isBase64 = false;
    let isQP = false;
    let boundary = null;
    let inTextPart = false;
    let bodyLines = [];

    // Check for multipart
    const ctHeader = lines.find(l => /^content-type:/i.test(l));
    if (ctHeader && ctHeader.includes('multipart')) {
      const bMatch = raw.match(/boundary="?([^\s";\r\n]+)"?/i);
      boundary = bMatch ? bMatch[1] : null;
    }

    if (boundary) {
      // Multipart — find text/plain part
      let inPart = false;
      let pastPartHeaders = false;
      let partIsText = false;
      let partIsBase64 = false;
      let partIsQP = false;

      for (const line of lines) {
        if (line.includes(boundary)) {
          // Save previous part if it was text
          if (inPart && partIsText && bodyLines.length > 0) break;
          inPart = true;
          pastPartHeaders = false;
          partIsText = false;
          partIsBase64 = false;
          partIsQP = false;
          bodyLines = [];
          continue;
        }
        if (inPart && !pastPartHeaders) {
          if (line.trim() === '') { pastPartHeaders = true; continue; }
          if (/^content-type:.*text\/plain/i.test(line)) partIsText = true;
          if (/^content-transfer-encoding:.*base64/i.test(line)) partIsBase64 = true;
          if (/^content-transfer-encoding:.*quoted-printable/i.test(line)) partIsQP = true;
        } else if (inPart && pastPartHeaders && partIsText) {
          bodyLines.push(line);
        }
      }

      let text = bodyLines.join('\n');
      if (partIsBase64) {
        try { text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf-8'); } catch {}
      } else if (partIsQP) {
        text = text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      return text.trim();
    } else {
      // Simple message — body after first blank line
      for (const line of lines) {
        if (inBody) {
          bodyLines.push(line);
        } else if (line.trim() === '') {
          inBody = true;
          // Check encoding from headers
          const enc = lines.find(l => /^content-transfer-encoding:/i.test(l));
          if (enc && /base64/i.test(enc)) isBase64 = true;
          if (enc && /quoted-printable/i.test(enc)) isQP = true;
        }
      }
      let text = bodyLines.join('\n');
      if (isBase64) {
        try { text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf-8'); } catch {}
      } else if (isQP) {
        text = text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      return text.trim();
    }
  }

  // SMTP config for sending replies
  getSmtpConfig() {
    return {
      host: this.config.host,
      port: 587,
      secure: false,
      auth: { user: this.config.user, pass: this.config.pass },
    };
  }

  getInbox() {
    const emails = this.emails.slice(0, 30).map(e => ({
      ...e,
      route: this.emailRouter ? this.emailRouter.classify(e) : null,
    }));

    return {
      status: this.status,
      lastCheck: this.lastCheck,
      checkCount: this.checkCount,
      error: this.error,
      pollInterval: this.config.pollInterval,
      account: this.config.user,
      unread: this.emails.filter(e => e.unread).length,
      total: this.emails.length,
      emails,
      byCategory: this.emailRouter ? this.emailRouter.getCategoryCounts(this.emails) : {},
    };
  }
}

module.exports = EmailPoller;
