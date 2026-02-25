// ── Inbox API ────────────────────────────────────────────
const router = require('express').Router();
const nodemailer = require('nodemailer');

router.get('/', (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.json({ status: 'disabled', emails: [] });

  const data = poller.getInbox();

  // Filter by category if requested
  if (req.query.category) {
    data.emails = data.emails.filter(e => e.route?.category === req.query.category);
  }

  // Hide archived (system) by default unless ?archived=true
  if (req.query.archived !== 'true') {
    data.emails = data.emails.filter(e => e.route?.category !== 'system');
  }

  res.json(data);
});

router.post('/check', async (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.status(503).json({ error: 'Email poller not configured' });
  await poller.check();
  res.json(poller.getInbox());
});

// Get route categories metadata (for frontend filter bar)
router.get('/categories', (req, res) => {
  const emailRouter = req.app.locals.emailRouter;
  if (!emailRouter) return res.json({});
  res.json(emailRouter.getCategories());
});

// Fetch full email by UID
router.get('/:uid', async (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.status(503).json({ error: 'Email poller not configured' });
  try {
    const uid = parseInt(req.params.uid);
    const email = await poller.fetchOne(uid);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    // Include route classification
    const emailRouter = req.app.locals.emailRouter;
    if (emailRouter) {
      email.route = emailRouter.classify({ uid, subject: email.subject, from: email.from });
    }

    // Include linked record if auto-created
    if (email.route?.autoCreate === 'ticket') {
      const tickets = req.app.locals.jsonStore('tickets.json').read();
      const linked = tickets.find(t => t.emailUid === uid);
      if (linked) email.linkedTicket = { id: linked.id, status: linked.status };
    } else if (email.route?.autoCreate === 'subscriber') {
      const subs = req.app.locals.jsonStore('subscribers.json').read();
      const linked = subs.find(s => s.emailUid === uid);
      if (linked) email.linkedSubscriber = { id: linked.id, status: linked.status, name: linked.name };
    }

    res.json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reply to an email
router.post('/:uid/reply', async (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.status(503).json({ error: 'Email poller not configured' });

  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body required' });

  try {
    const uid = parseInt(req.params.uid);
    const email = await poller.fetchOne(uid);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const smtpConfig = poller.getSmtpConfig();
    const transport = nodemailer.createTransport(smtpConfig);

    const replyTo = email.replyTo || email.from.address;
    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;

    await transport.sendMail({
      from: `"SweepNspect" <${smtpConfig.auth.user}>`,
      to: replyTo,
      subject,
      inReplyTo: email.messageId,
      references: email.messageId,
      text: body,
    });

    // Broadcast reply activity
    const broadcast = req.app.locals.broadcast;
    broadcast({
      type: 'activity',
      data: {
        type: 'email-reply',
        text: `Reply sent to ${email.from.name || email.from.address}: "${subject}"`,
        timestamp: new Date().toISOString(),
      }
    });

    console.log(`[EMAIL] Reply sent to ${replyTo}: ${subject}`);
    res.json({ ok: true, to: replyTo, subject });
  } catch (err) {
    console.error(`[EMAIL] Reply failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
