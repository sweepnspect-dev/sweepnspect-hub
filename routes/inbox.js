// ── Inbox API ────────────────────────────────────────────
const router = require('express').Router();
const nodemailer = require('nodemailer');

router.get('/', (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.json({ status: 'disabled', emails: [] });
  res.json(poller.getInbox());
});

router.post('/check', async (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.status(503).json({ error: 'Email poller not configured' });
  await poller.check();
  res.json(poller.getInbox());
});

// Fetch full email by UID
router.get('/:uid', async (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.status(503).json({ error: 'Email poller not configured' });
  try {
    const uid = parseInt(req.params.uid);
    const email = await poller.fetchOne(uid);
    if (!email) return res.status(404).json({ error: 'Email not found' });
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
