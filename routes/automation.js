// ── Automation + Relay Routes ───────────────────────────────────
// API routes for relay bridge and automation rules.

const { Router } = require('express');
const router = Router();

// ── Relay endpoints ────────────────────────────────────────────

router.get('/relay/status', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const status = await relay.getStatus();
  res.json(status);
});

router.get('/relay/health', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const health = await relay.getHealth();
  res.json(health);
});

router.get('/relay/messages', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const recipient = req.query.for || 'hub';
  const peek = req.query.peek === 'true';
  const messages = peek
    ? await relay.peekMessages(recipient)
    : await relay.getMessages(recipient);
  res.json(messages);
});

router.get('/relay/history', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const last = parseInt(req.query.last) || 20;
  const history = await relay.getHistory(last);
  res.json(history);
});

router.post('/relay/send', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const { from, to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });
  try {
    const result = await relay.sendMessage(from || 'hub', to, body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Relay unreachable', detail: err.message });
  }
});

router.get('/relay/tasks', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const tasks = await relay.getTasks(req.query);
  res.json(tasks);
});

router.post('/relay/tasks', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const { title, assignee, priority, description } = req.body;
  if (!title || !assignee) return res.status(400).json({ error: 'title and assignee required' });
  try {
    const result = await relay.createTask(title, assignee, { priority, description });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Relay unreachable', detail: err.message });
  }
});

router.get('/relay/heartbeats', async (req, res) => {
  const relay = req.app.locals.relayBridge;
  const heartbeats = await relay.getHeartbeats();
  res.json(heartbeats);
});

// ── Automation rules endpoints ─────────────────────────────────

router.get('/rules', (req, res) => {
  const automation = req.app.locals.automationRules;
  res.json(automation.getRules());
});

router.post('/rules', (req, res) => {
  const automation = req.app.locals.automationRules;
  const rule = automation.addRule(req.body);
  res.json({ ok: true, rule });
});

router.put('/rules/:id', (req, res) => {
  const automation = req.app.locals.automationRules;
  const rule = automation.updateRule(req.params.id, req.body);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json({ ok: true, rule });
});

router.delete('/rules/:id', (req, res) => {
  const automation = req.app.locals.automationRules;
  const deleted = automation.deleteRule(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Rule not found' });
  res.json({ ok: true });
});

router.get('/log', (req, res) => {
  const automation = req.app.locals.automationRules;
  const limit = parseInt(req.query.limit) || 50;
  res.json(automation.getLog(limit));
});

module.exports = router;
