const express = require('express');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('tickets.json'); }
function broadcast(req, msg) { req.app.locals.broadcast(msg); }

// List all tickets (filterable: ?status=review&priority=high)
router.get('/', (req, res) => {
  let tickets = store(req).read();
  if (req.query.status) tickets = tickets.filter(t => t.status === req.query.status);
  if (req.query.priority) tickets = tickets.filter(t => t.priority === req.query.priority);
  // Sort: newest first
  tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(tickets);
});

// Get single ticket
router.get('/:id', (req, res) => {
  const tickets = store(req).read();
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Create ticket
router.post('/', (req, res) => {
  const s = store(req);
  const tickets = s.read();
  const ticket = {
    id: s.nextId('t'),
    status: req.body.status || 'new',
    priority: req.body.priority || 'normal',
    source: req.body.source || '',
    emailUid: req.body.emailUid || null,
    customer: req.body.customer || { name: '', email: '', subscriberId: '' },
    subject: req.body.subject || '',
    description: req.body.description || '',
    aiAnalysis: null,
    resolution: '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    messages: []
  };
  tickets.push(ticket);
  s.write(tickets);
  broadcast(req, { type: 'ticket:new', data: ticket });
  broadcast(req, { type: 'activity', data: { icon: 'ticket', text: `New ticket: ${ticket.subject}`, time: ticket.createdAt } });

  // Alert for critical/high priority tickets
  const alertRouter = req.app.locals.alertRouter;
  if (alertRouter && ['critical', 'high'].includes(ticket.priority)) {
    alertRouter.send('ticket-created', ticket.priority,
      `New ${ticket.priority} ticket: ${ticket.subject}`,
      { ticketId: ticket.id, customer: ticket.customer?.name }
    );
  }

  res.status(201).json(ticket);
});

// Update ticket (status, priority, resolution, aiAnalysis)
router.put('/:id', (req, res) => {
  const s = store(req);
  const tickets = s.read();
  const idx = tickets.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });

  const allowed = ['status', 'priority', 'resolution', 'aiAnalysis', 'subject', 'description', 'customer', 'source'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) tickets[idx][key] = req.body[key];
  }

  // Auto-set resolvedAt
  if (req.body.status === 'resolved' && !tickets[idx].resolvedAt) {
    tickets[idx].resolvedAt = new Date().toISOString();
  }

  s.write(tickets);
  broadcast(req, { type: 'ticket:updated', data: tickets[idx] });

  // Activity feed
  if (req.body.status) {
    const labels = { 'ai-working': 'AI analyzing', review: 'Ready for review', resolved: 'Resolved', escalated: 'Escalated' };
    broadcast(req, { type: 'activity', data: { icon: 'status', text: `${tickets[idx].subject} — ${labels[req.body.status] || req.body.status}`, time: new Date().toISOString() } });
  }

  // Alert on escalation
  const alertRouter = req.app.locals.alertRouter;
  if (alertRouter && req.body.status === 'escalated') {
    alertRouter.send('ticket-escalated', 'high',
      `Ticket escalated: ${tickets[idx].subject}`,
      { ticketId: tickets[idx].id, customer: tickets[idx].customer?.name }
    );
  }

  res.json(tickets[idx]);
});

// Add message to ticket thread
router.post('/:id/messages', (req, res) => {
  const s = store(req);
  const tickets = s.read();
  const idx = tickets.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });

  const message = {
    id: `msg-${Date.now().toString(36)}`,
    from: req.body.from || 'system',
    text: req.body.text || '',
    timestamp: new Date().toISOString()
  };
  tickets[idx].messages.push(message);
  s.write(tickets);
  broadcast(req, { type: 'ticket:message', data: { ticketId: tickets[idx].id, message } });
  res.json(message);
});

// Delete ticket
router.delete('/:id', (req, res) => {
  const s = store(req);
  let tickets = s.read();
  tickets = tickets.filter(t => t.id !== req.params.id);
  s.write(tickets);
  broadcast(req, { type: 'ticket:deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
