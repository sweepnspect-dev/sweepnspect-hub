// ── Comms API — Facebook, Sync, SMS ─────────────────
const router = require('express').Router();

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
