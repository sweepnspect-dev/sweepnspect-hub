const express = require('express');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('subscribers.json'); }
function broadcast(req, msg) { req.app.locals.broadcast(msg); }

// List all subscribers (filterable: ?status=active&plan=pro)
router.get('/', (req, res) => {
  let subs = store(req).read();
  if (req.query.status) subs = subs.filter(s => s.status === req.query.status);
  if (req.query.plan) subs = subs.filter(s => s.plan === req.query.plan);
  subs.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  res.json(subs);
});

// Get single
router.get('/:id', (req, res) => {
  const subs = store(req).read();
  const sub = subs.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
  res.json(sub);
});

// Create
router.post('/', (req, res) => {
  const s = store(req);
  const subs = s.read();
  const sub = {
    id: s.nextId('s'),
    name: req.body.name || '',
    email: req.body.email || '',
    plan: req.body.plan || 'solo',
    mrr: req.body.mrr || 0,
    status: req.body.status || 'trial',
    startDate: req.body.startDate || new Date().toISOString(),
    tickets: []
  };
  subs.push(sub);
  s.write(subs);
  broadcast(req, { type: 'subscriber:new', data: sub });
  broadcast(req, { type: 'activity', data: { icon: 'subscriber', text: `New subscriber: ${sub.name} (${sub.plan})`, time: sub.startDate } });
  res.status(201).json(sub);
});

// Update
router.put('/:id', (req, res) => {
  const s = store(req);
  const subs = s.read();
  const idx = subs.findIndex(sub => sub.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Subscriber not found' });

  const allowed = ['name', 'email', 'plan', 'mrr', 'status'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) subs[idx][key] = req.body[key];
  }
  s.write(subs);
  broadcast(req, { type: 'subscriber:updated', data: subs[idx] });
  res.json(subs[idx]);
});

// Delete
router.delete('/:id', (req, res) => {
  const s = store(req);
  let subs = s.read();
  subs = subs.filter(sub => sub.id !== req.params.id);
  s.write(subs);
  broadcast(req, { type: 'subscriber:deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
