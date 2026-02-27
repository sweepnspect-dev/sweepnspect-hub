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

// ── 360° Subscriber Care Profile ─────────────────────────
// Aggregates tickets, comms, revenue, and health score for a single subscriber
router.get('/:id/care', (req, res) => {
  const jsonStore = req.app.locals.jsonStore;
  const subs = store(req).read();
  const sub = subs.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subscriber not found' });

  const email = (sub.email || '').toLowerCase();
  const subId = sub.id;

  // ── Tickets ──
  const allTickets = jsonStore('tickets.json').read();
  const tickets = allTickets.filter(t =>
    t.customer?.subscriberId === subId ||
    (email && (t.customer?.email || '').toLowerCase() === email)
  );
  tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
  const resolvedTickets = tickets.filter(t => t.status === 'resolved');

  // ── Revenue ──
  const allRevenue = jsonStore('revenue.json').read();
  const revenue = allRevenue.filter(r => r.subscriberId === subId);
  revenue.sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalRevenue = revenue.filter(r => r.type !== 'refund').reduce((s, r) => s + r.amount, 0);
  const totalRefunds = revenue.filter(r => r.type === 'refund').reduce((s, r) => s + r.amount, 0);

  // ── Communications (aggregate all channels) ──
  const comms = [];

  // Email inbox
  try {
    const inbox = jsonStore('inbox.json').read();
    inbox.forEach(m => {
      const from = (m.from || '').toLowerCase();
      if (email && (from.includes(email) || (m.to || '').toLowerCase().includes(email))) {
        comms.push({ channel: 'email', id: m.uid || m.id, subject: m.subject, from: m.from, date: m.date, category: m.category, unread: !m.read });
      }
    });
  } catch {}

  // Tawk
  try {
    const tawk = jsonStore('comms-tawk.json').read();
    tawk.forEach(m => {
      const mEmail = (m.visitorEmail || '').toLowerCase();
      if (email && mEmail === email) {
        comms.push({ channel: 'tawk', id: m.id, subject: m.message, from: m.visitorName, date: m.time, ticketId: m.ticketId, unread: m.unread });
      }
    });
  } catch {}

  // Facebook
  try {
    const fb = jsonStore('comms-facebook.json').read();
    fb.forEach(m => {
      // Match by name since FB doesn't always have email
      const mName = (m.senderName || m.commenterName || '').toLowerCase();
      const subName = (sub.name || '').toLowerCase();
      if (subName && mName.includes(subName.split(' ')[0].toLowerCase())) {
        comms.push({ channel: 'facebook', id: m.id, subject: m.message || m.comment, from: m.senderName || m.commenterName, date: m.time });
      }
    });
  } catch {}

  // SMS
  try {
    const sms = jsonStore('comms-sms.json').read();
    sms.forEach(m => {
      const phone = sub.phone || '';
      if (phone && (m.from === phone || m.to === phone)) {
        comms.push({ channel: 'sms', id: m.id, subject: m.message, from: m.from, date: m.timestamp, direction: m.direction, unread: m.unread });
      }
    });
  } catch {}

  comms.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  // ── Health Score (0-100) ──
  let health = 100;
  // Deduct for open tickets
  health -= openTickets.length * 10;
  // Deduct for critical/high tickets
  health -= openTickets.filter(t => t.priority === 'critical').length * 15;
  health -= openTickets.filter(t => t.priority === 'high').length * 8;
  // Bonus for resolved tickets
  health += Math.min(resolvedTickets.length * 3, 15);
  // Deduct for churn status
  if (sub.status === 'churned') health -= 40;
  // Deduct if trial (still evaluating)
  if (sub.status === 'trial') health -= 10;
  // Bonus for revenue
  if (totalRevenue > 200) health += 5;
  // Clamp
  health = Math.max(0, Math.min(100, health));

  const healthLabel = health >= 80 ? 'healthy' : health >= 50 ? 'at-risk' : 'critical';

  // ── Timeline (all events chronologically) ──
  const timeline = [];
  tickets.forEach(t => {
    timeline.push({ type: 'ticket', id: t.id, text: t.subject, status: t.status, priority: t.priority, date: t.createdAt });
    if (t.resolvedAt) {
      timeline.push({ type: 'resolved', id: t.id, text: `Resolved: ${t.subject}`, date: t.resolvedAt });
    }
  });
  revenue.forEach(r => {
    timeline.push({ type: 'revenue', id: r.id, text: r.note || `${r.type} — $${r.amount}`, amount: r.amount, date: r.date });
  });
  comms.forEach(c => {
    timeline.push({ type: 'comms', channel: c.channel, id: c.id, text: c.subject, date: c.date });
  });
  // Subscriber created
  timeline.push({ type: 'subscriber', text: `${sub.name} joined as ${sub.plan}`, date: sub.startDate });
  timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  res.json({
    subscriber: sub,
    health: { score: health, label: healthLabel },
    tickets: { items: tickets, open: openTickets.length, resolved: resolvedTickets.length, total: tickets.length },
    revenue: { items: revenue, total: totalRevenue, refunds: totalRefunds, mrr: sub.mrr || 0 },
    comms: { items: comms, total: comms.length },
    timeline: timeline.slice(0, 50),
  });
});

// Create
router.post('/', (req, res) => {
  const s = store(req);
  const subs = s.read();
  const sub = {
    id: s.nextId('s'),
    name: req.body.name || '',
    email: req.body.email || '',
    plan: req.body.plan || '',
    mrr: req.body.mrr || 0,
    status: req.body.status || 'trial',
    source: req.body.source || '',
    emailUid: req.body.emailUid || null,
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

  const allowed = ['name', 'email', 'plan', 'mrr', 'status', 'source', 'phone'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) subs[idx][key] = req.body[key];
  }
  s.write(subs);
  broadcast(req, { type: 'subscriber:updated', data: subs[idx] });

  // Alert on churn
  const alertRouter = req.app.locals.alertRouter;
  if (alertRouter && req.body.status === 'churned') {
    alertRouter.send('subscriber-churned', 'critical',
      `Subscriber churned: ${subs[idx].name} ($${subs[idx].mrr || 0}/mo MRR impact)`,
      { subscriberId: subs[idx].id, mrr: subs[idx].mrr }
    );
  }

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
