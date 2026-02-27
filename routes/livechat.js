// ── Live Chat Routes — Custom chat session management ────
const express = require('express');
const router = express.Router();

// GET /api/livechat/sessions — list active/recent sessions
router.get('/sessions', (req, res) => {
  const store = req.app.locals.jsonStore('livechat-sessions.json');
  const sessions = store.read();
  const status = req.query.status; // optional filter: active, ended
  const filtered = status ? sessions.filter(s => s.status === status) : sessions;
  res.json({ sessions: filtered });
});

// GET /api/livechat/sessions/:id — single session with messages
router.get('/sessions/:id', (req, res) => {
  const store = req.app.locals.jsonStore('livechat-sessions.json');
  const sessions = store.read();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// POST /api/livechat/sessions/:id/reply — J replies from Hub
router.post('/sessions/:id/reply', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const store = req.app.locals.jsonStore('livechat-sessions.json');
  const sessions = store.read();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const now = new Date().toISOString();
  const message = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`,
    from: 'agent',
    text,
    ts: now,
  };
  session.messages.push(message);
  session.lastActivity = now;
  store.write(sessions);

  // Push reply to CF Worker so visitor receives it
  const workerUrl = req.app.locals.workerPoller?.config?.workerUrl;
  if (workerUrl) {
    try {
      await fetch(`${workerUrl}/api/chat/${req.params.id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUB_API_TOKEN || ''}`,
        },
        body: JSON.stringify({ text, from: 'agent' }),
      });
    } catch (err) {
      console.error('[LIVECHAT] Failed to push reply to worker:', err.message);
    }
  }

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'livechat:reply', data: { sessionId: req.params.id, message } });

  res.json({ ok: true, message });
});

// POST /api/livechat/sessions/:id/ai-reply — AI auto-response
router.post('/sessions/:id/ai-reply', async (req, res) => {
  const store = req.app.locals.jsonStore('livechat-sessions.json');
  const sessions = store.read();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Build context for AI
  const http = require('http');
  const PROXY_HOST = process.env.AI_PROXY_HOST || '127.0.0.1';
  const PROXY_PORT = process.env.AI_PROXY_PORT || 8889;

  const chatHistory = session.messages
    .slice(-10)
    .map(m => `${m.from === 'visitor' ? 'Visitor' : m.from === 'ai' ? 'AI' : 'Agent'}: ${m.text}`)
    .join('\n');

  const prompt = `You are a friendly customer support AI for SweepNspect, a chimney inspection app. You're chatting with a website visitor named ${session.visitor.name || 'a visitor'}.

KNOWLEDGEBASE:
- What: Chimney inspection app for Android, built by a sweep with 20 yrs experience.
- Pricing: Solo $49/mo (1 device, unlimited inspections, PDF reports). Pro $149/mo (up to 5 devices + team management). 14-day free trial, no credit card required.
- Founding 25: First 25 paying users get Solo at $29/mo locked for life, priority support, direct line to founder, name on Founding Members page. Limited spots remain.
- Offline: Full offline capability — inspect, photograph, generate PDF without cell signal. Syncs when back online.
- PDF Reports: NFPA 211 zone-by-zone reports generated on-site, branded with company logo, emailed to customer.
- Devices: Android only (phones + tablets). No iOS. Minimum Android 8.0.
- Data: All data stays on device. No cloud storage of inspection data. User owns their data.
- Workflow: NFPA 211 zone-by-zone inspection (exterior, interior, attic, roof, firebox, smoke chamber, flue, cleanout). Photo capture per zone. Deficiency flagging. PDF generation.
- Support: Email contact@sweepnspect.com, live chat on website, Facebook page.
- NFPA 211: Built around the Standard for Chimneys, Fireplaces, Vents, and Solid Fuel-Burning Appliances. Zone-by-zone approach ensures nothing is missed.
- Differentiation: Built by an actual chimney sweep, not a tech company. Offline-first. No subscription lock-in on data.

RULES:
- Answer ONLY from the KNOWLEDGEBASE above for product questions. Be helpful, professional, and concise.
- If the visitor asks something not covered in the knowledgebase, say "That's a great question! Let me connect you with J (the founder) who can help with that." Do NOT guess or make up information.
- Keep replies short (1-3 sentences) and conversational — this is live chat, not an essay.
- Do NOT use the <<<DISPLAY>>> format. Just respond with plain text suitable for a chat bubble.

CONVERSATION SO FAR:
${chatHistory}

Reply to the visitor's last message:`;

  try {
    const answer = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({ prompt });
      const options = {
        hostname: PROXY_HOST, port: PROXY_PORT, path: '/ask', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      };
      const r = http.request(options, (resp) => {
        let data = '';
        resp.on('data', chunk => { data += chunk; });
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.answer || 'Sorry, I couldn\'t generate a response.');
          } catch { reject(new Error('Invalid proxy response')); }
        });
      });
      r.on('error', (e) => reject(e));
      r.setTimeout(30000, () => { r.destroy(); reject(new Error('timeout')); });
      r.write(postData);
      r.end();
    });

    // Strip any <<<DISPLAY>>> markers if the AI included them
    const cleanAnswer = answer.split('<<<DISPLAY>>>')[0].trim() || answer;

    const now = new Date().toISOString();
    const message = {
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`,
      from: 'ai',
      text: cleanAnswer,
      ts: now,
    };
    session.messages.push(message);
    session.lastActivity = now;
    store.write(sessions);

    // Push to CF Worker
    const workerUrl = req.app.locals.workerPoller?.config?.workerUrl;
    if (workerUrl) {
      try {
        await fetch(`${workerUrl}/api/chat/${req.params.id}/reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.HUB_API_TOKEN || ''}`,
          },
          body: JSON.stringify({ text: cleanAnswer, from: 'ai' }),
        });
      } catch (err) {
        console.error('[LIVECHAT] Failed to push AI reply to worker:', err.message);
      }
    }

    const broadcast = req.app.locals.broadcast;
    broadcast({ type: 'livechat:reply', data: { sessionId: req.params.id, message } });

    res.json({ ok: true, message });
  } catch (err) {
    console.error('[LIVECHAT] AI reply error:', err.message);
    res.status(500).json({ error: 'AI unavailable: ' + err.message });
  }
});

// POST /api/livechat/sessions/:id/end — end a session
router.post('/sessions/:id/end', (req, res) => {
  const store = req.app.locals.jsonStore('livechat-sessions.json');
  const sessions = store.read();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.status = 'ended';
  session.endedAt = new Date().toISOString();
  store.write(sessions);

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'livechat:end', data: { sessionId: req.params.id } });

  res.json({ ok: true });
});

// GET /api/livechat/stats
router.get('/stats', (req, res) => {
  const store = req.app.locals.jsonStore('livechat-sessions.json');
  const sessions = store.read();
  const active = sessions.filter(s => s.status === 'active');

  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaySessions = sessions.filter(s => new Date(s.startedAt) >= today);

  // Avg response time: time between first visitor msg and first agent/ai reply
  const responseTimes = sessions.map(s => {
    const firstVisitor = s.messages.find(m => m.from === 'visitor');
    const firstReply = s.messages.find(m => m.from === 'agent' || m.from === 'ai');
    if (firstVisitor && firstReply) {
      return new Date(firstReply.ts) - new Date(firstVisitor.ts);
    }
    return null;
  }).filter(Boolean);
  const avgResponseMs = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length)
    : null;

  res.json({
    active: active.length,
    today: todaySessions.length,
    total: sessions.length,
    avgResponseMs,
  });
});

module.exports = router;
