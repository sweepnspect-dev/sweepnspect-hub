// ── Comms API — Facebook, Sync, SMS, Outbound ───────
const router = require('express').Router();
const nodemailer = require('nodemailer');

// ── Facebook messages ───────────────────────────────────────
router.get('/facebook', (req, res) => {
  const store = req.app.locals.jsonStore('comms-facebook.json');
  const messages = store.read();
  res.json({ messages });
});

router.get('/facebook/:id', (req, res) => {
  const store = req.app.locals.jsonStore('comms-facebook.json');
  const messages = store.read();
  const msg = messages.find(m => m.id === req.params.id || m.messageId === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  res.json(msg);
});

// ── SMS messages ────────────────────────────────────────────
router.get('/sms', (req, res) => {
  const store = req.app.locals.jsonStore('comms-sms.json');
  const messages = store.read();
  res.json({ messages });
});

router.get('/sms/:id', (req, res) => {
  const store = req.app.locals.jsonStore('comms-sms.json');
  const messages = store.read();
  const msg = messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  res.json(msg);
});

// ── Sync messages (from Relay bridge) ───────────────────────
router.get('/sync', async (req, res) => {
  try {
    const relayBridge = req.app.locals.relayBridge;
    if (!relayBridge) return res.json({ messages: [] });

    // Peek messages from multiple relay queues
    const results = await Promise.allSettled([
      relayBridge.peekMessages('genesis'),
      relayBridge.peekMessages('hub'),
      relayBridge.peekMessages('z'),
    ]);

    const messages = [];
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        const msgs = r.value?.messages || (Array.isArray(r.value) ? r.value : []);
        msgs.forEach(m => {
          messages.push({
            id: m.id || m.ts || Date.now().toString(),
            from: m.from || m.sender || 'Relay',
            device: m.node || m.from || 'unknown',
            text: m.body || m.text || m.message || '',
            ts: m.ts || m.timestamp || new Date().toISOString(),
            task: m.task || null,
            status: m.status || null,
          });
        });
      }
    });

    messages.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
    res.json({ messages });
  } catch (err) {
    res.json({ messages: [], error: err.message });
  }
});

// ── POST endpoints for ingesting messages ───────────────────

// Ingest a Facebook message
router.post('/facebook', (req, res) => {
  const store = req.app.locals.jsonStore('comms-facebook.json');
  const messages = store.read();

  const msg = {
    id: req.body.messageId || 'fb-' + Date.now(),
    messageId: req.body.messageId || '',
    from: req.body.from || { name: 'Facebook User' },
    senderName: req.body.senderName || req.body.from?.name || 'Facebook User',
    senderId: req.body.senderId || '',
    message: req.body.message || req.body.text || '',
    created_time: req.body.created_time || req.body.timestamp || new Date().toISOString(),
    unread: true,
    type: req.body.type || 'message',
    pageId: req.body.pageId || '',
    postId: req.body.postId || '',
    commentId: req.body.commentId || '',
    attachments: req.body.attachments || [],
  };

  messages.unshift(msg);
  if (messages.length > 500) messages.length = 500;
  store.write(messages);

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'facebook:message', data: msg });

  res.json({ ok: true, message: msg });
});

// Ingest an SMS message
router.post('/sms', (req, res) => {
  const store = req.app.locals.jsonStore('comms-sms.json');
  const messages = store.read();

  const msg = {
    id: req.body.id || 'sms-' + Date.now(),
    from: req.body.from || 'Unknown',
    to: req.body.to || '',
    message: req.body.message || req.body.text || '',
    timestamp: req.body.timestamp || new Date().toISOString(),
    unread: true,
    direction: req.body.direction || 'inbound',
  };

  messages.unshift(msg);
  if (messages.length > 500) messages.length = 500;
  store.write(messages);

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'sms:message', data: msg });

  res.json({ ok: true, message: msg });
});

// ── Outbound SMS compose ────────────────────────────────────
router.post('/sms/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to and message required' });

  const smsService = req.app.locals.smsService;
  if (!smsService) return res.status(503).json({ error: 'SMS service not available' });

  // Send via Twilio (outbound to customer, not ADB notification)
  let result;
  if (smsService.twilioConfigured) {
    // Direct Twilio send to arbitrary number
    const https = require('https');
    const body = new URLSearchParams({
      To: to,
      From: smsService.from,
      Body: message.slice(0, 1600)
    }).toString();

    result = await new Promise((resolve) => {
      const options = {
        hostname: 'api.twilio.com', port: 443,
        path: `/2010-04-01/Accounts/${smsService.sid}/Messages.json`,
        method: 'POST',
        auth: `${smsService.sid}:${smsService.token}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      };
      const r = https.request(options, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            resolve({ sent: true, method: 'twilio', sid: JSON.parse(data).sid });
          } else {
            resolve({ sent: false, reason: `Twilio HTTP ${resp.statusCode}`, detail: data });
          }
        });
      });
      r.on('error', (err) => resolve({ sent: false, reason: err.message }));
      r.setTimeout(10000, () => { r.destroy(); resolve({ sent: false, reason: 'timeout' }); });
      r.write(body);
      r.end();
    });
  } else {
    result = { sent: false, reason: 'Twilio not configured — cannot send outbound SMS' };
  }

  // Log outbound message
  const store = req.app.locals.jsonStore('comms-sms.json');
  const messages = store.read();
  const msg = {
    id: 'sms-out-' + Date.now(),
    from: smsService.from || 'SweepNspect',
    to,
    message,
    timestamp: new Date().toISOString(),
    unread: false,
    direction: 'outbound',
    deliveryStatus: result.sent ? 'sent' : 'failed',
  };
  messages.unshift(msg);
  store.write(messages);

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'sms:sent', data: msg });

  res.json({ ok: result.sent, message: msg, delivery: result });
});

// ── Outbound email compose ──────────────────────────────────
router.post('/email/send', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });

  const poller = req.app.locals.emailPoller;
  if (!poller) return res.status(503).json({ error: 'Email service not configured' });

  try {
    const smtpConfig = poller.getSmtpConfig();
    const transport = nodemailer.createTransport(smtpConfig);

    await transport.sendMail({
      from: `"SweepNspect" <${smtpConfig.auth.user}>`,
      to,
      subject: subject || '(no subject)',
      text: body,
    });

    // Log outbound
    const store = req.app.locals.jsonStore('comms-email-sent.json');
    const emails = store.read();
    const msg = {
      id: 'email-out-' + Date.now(),
      to,
      subject: subject || '(no subject)',
      body,
      sentAt: new Date().toISOString(),
      status: 'sent',
    };
    emails.unshift(msg);
    store.write(emails);

    const broadcast = req.app.locals.broadcast;
    broadcast({ type: 'email:sent', data: msg });

    res.json({ ok: true, message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Broadcast — send to a segment ──────────────────────────
router.post('/broadcast', async (req, res) => {
  const { channel, segment, subject, message } = req.body;
  if (!channel || !message) return res.status(400).json({ error: 'channel and message required' });
  if (!['sms', 'email'].includes(channel)) return res.status(400).json({ error: 'channel must be sms or email' });

  const subs = req.app.locals.jsonStore('subscribers.json').read();
  let recipients = subs;

  // Filter by segment
  if (segment === 'active') recipients = subs.filter(s => s.status === 'active' || s.status === 'founding');
  else if (segment === 'trial') recipients = subs.filter(s => s.status === 'trial');
  else if (segment === 'churned') recipients = subs.filter(s => s.status === 'churned');
  // else 'all' — send to everyone

  const results = { total: recipients.length, sent: 0, failed: 0, errors: [] };

  if (channel === 'email') {
    const poller = req.app.locals.emailPoller;
    if (!poller) return res.status(503).json({ error: 'Email not configured' });
    const smtpConfig = poller.getSmtpConfig();
    const transport = nodemailer.createTransport(smtpConfig);

    for (const sub of recipients) {
      if (!sub.email) { results.failed++; continue; }
      try {
        await transport.sendMail({
          from: `"SweepNspect" <${smtpConfig.auth.user}>`,
          to: sub.email,
          subject: subject || 'Update from SweepNspect',
          text: message,
        });
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push({ email: sub.email, error: err.message });
      }
    }
  } else if (channel === 'sms') {
    const smsService = req.app.locals.smsService;
    if (!smsService?.twilioConfigured) return res.status(503).json({ error: 'Twilio not configured' });

    for (const sub of recipients) {
      if (!sub.phone) { results.failed++; continue; }
      try {
        // Use the same Twilio send as /sms/send
        const https = require('https');
        const body = new URLSearchParams({
          To: sub.phone, From: smsService.from, Body: message.slice(0, 1600)
        }).toString();
        await new Promise((resolve, reject) => {
          const options = {
            hostname: 'api.twilio.com', port: 443,
            path: `/2010-04-01/Accounts/${smsService.sid}/Messages.json`,
            method: 'POST', auth: `${smsService.sid}:${smsService.token}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
          };
          const r = https.request(options, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => resp.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${resp.statusCode}`)));
          });
          r.on('error', reject);
          r.write(body);
          r.end();
        });
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push({ phone: sub.phone, error: err.message });
      }
    }
  }

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'broadcast:sent', data: { channel, segment, ...results } });
  broadcast({ type: 'activity', data: { icon: 'comms', text: `Broadcast: ${results.sent} ${channel}s sent to ${segment || 'all'}`, time: new Date().toISOString() } });

  res.json({ ok: true, ...results });
});

// ── Channel stats ───────────────────────────────────────────
router.get('/stats', (req, res) => {
  const jsonStore = req.app.locals.jsonStore;
  const fb = jsonStore('comms-facebook.json').read();
  const sms = jsonStore('comms-sms.json').read();
  const lc = jsonStore('livechat-sessions.json').read();
  const activeLc = lc.filter(s => s.status === 'active');

  res.json({
    facebook: { total: fb.length, unread: fb.filter(m => m.unread).length },
    sms: { total: sms.length, unread: sms.filter(m => m.unread).length },
    livechat: { total: lc.length, active: activeLc.length },
  });
});

module.exports = router;
