const express = require('express');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('revenue.json'); }
function broadcast(req, msg) { req.app.locals.broadcast(msg); }

// List all (filterable: ?type=subscription&month=2026-02)
router.get('/', (req, res) => {
  let entries = store(req).read();
  if (req.query.type) entries = entries.filter(r => r.type === req.query.type);
  if (req.query.month) entries = entries.filter(r => r.date && r.date.startsWith(req.query.month));
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(entries);
});

// Create
router.post('/', (req, res) => {
  const s = store(req);
  const entries = s.read();
  const entry = {
    id: s.nextId('r'),
    type: req.body.type || 'subscription',
    amount: req.body.amount || 0,
    subscriberId: req.body.subscriberId || '',
    date: req.body.date || new Date().toISOString(),
    note: req.body.note || ''
  };
  entries.push(entry);
  s.write(entries);
  broadcast(req, { type: 'revenue:new', data: entry });
  const label = entry.type === 'refund' ? 'Refund' : 'Payment';
  broadcast(req, { type: 'activity', data: { icon: 'revenue', text: `${label}: $${entry.amount}`, time: entry.date } });
  res.status(201).json(entry);
});

// Update
router.put('/:id', (req, res) => {
  const s = store(req);
  const entries = s.read();
  const idx = entries.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found' });

  const allowed = ['type', 'amount', 'subscriberId', 'date', 'note'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) entries[idx][key] = req.body[key];
  }
  s.write(entries);
  broadcast(req, { type: 'revenue:updated', data: entries[idx] });
  res.json(entries[idx]);
});

// Delete
router.delete('/:id', (req, res) => {
  const s = store(req);
  let entries = s.read();
  entries = entries.filter(r => r.id !== req.params.id);
  s.write(entries);
  broadcast(req, { type: 'revenue:deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
