const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = 8888;

// ── Middleware ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// CORS for localhost dev
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── JSON file storage helper ─────────────────────────────
const fs = require('fs');

function jsonStore(filename) {
  const filepath = path.join(__dirname, 'data', filename);
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
      catch { return []; }
    },
    write(data) {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    },
    nextId(prefix) {
      const items = this.read();
      const nums = items.map(i => {
        const m = i.id.match(/\d+$/);
        return m ? parseInt(m[0]) : 0;
      });
      const next = nums.length ? Math.max(...nums) + 1 : 1;
      return `${prefix}-${String(next).padStart(3, '0')}`;
    }
  };
}

// ── Alert Infrastructure ─────────────────────────────────
const SmsService = require('./lib/sms');
const AlertRouter = require('./lib/alert-router');
const smsService = new SmsService();
const alertRouter = new AlertRouter(broadcast, smsService);

// Make store + alert router available to routes
app.locals.jsonStore = jsonStore;
app.locals.broadcast = broadcast;
app.locals.alertRouter = alertRouter;

// ── Routes ───────────────────────────────────────────────
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/subscribers', require('./routes/subscribers'));
app.use('/api/revenue', require('./routes/revenue'));
app.use('/api/commands', require('./routes/commands'));
app.use('/api/clauser', require('./routes/clauser'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/webhooks', require('./routes/webhooks'));

// ── Alert API ────────────────────────────────────────────
app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(alertRouter.getAlerts(limit));
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
  const alert = alertRouter.acknowledge(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json(alert);
});

app.get('/api/alerts/config', (req, res) => {
  res.json(alertRouter.getConfig());
});

app.put('/api/alerts/config', (req, res) => {
  const updated = alertRouter.updateConfig(req.body);
  res.json(updated);
});

app.get('/api/sms/status', (req, res) => {
  res.json(smsService.getStatus());
});

// Webhook endpoint (separate from CRUD) — with alert trigger
app.post('/api/webhooks/ticket', (req, res) => {
  const store = jsonStore('tickets.json');
  const tickets = store.read();
  const ticket = {
    id: store.nextId('t'),
    status: 'new',
    priority: req.body.priority || 'normal',
    customer: req.body.customer || { name: 'Unknown', email: '', subscriberId: '' },
    subject: req.body.subject || 'No subject',
    description: req.body.description || '',
    aiAnalysis: null,
    resolution: '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    messages: []
  };
  tickets.push(ticket);
  store.write(tickets);
  broadcast({ type: 'ticket:new', data: ticket });

  // Alert for critical webhook tickets
  if (['critical', 'high'].includes(ticket.priority)) {
    alertRouter.send('ticket-webhook', ticket.priority,
      `Webhook ticket (${ticket.priority}): ${ticket.subject}`,
      { ticketId: ticket.id }
    );
  }

  res.json({ ok: true, ticket });
});

// Dashboard stats endpoint
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// ── Stats aggregation ────────────────────────────────────
function getStats() {
  const tickets = jsonStore('tickets.json').read();
  const subs = jsonStore('subscribers.json').read();
  const rev = jsonStore('revenue.json').read();

  const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
  const aiWorking = tickets.filter(t => t.status === 'ai-working');
  const needsReview = tickets.filter(t => t.status === 'review');
  const activeSubs = subs.filter(s => s.status === 'active');
  const mrr = activeSubs.reduce((sum, s) => sum + (s.mrr || 0), 0);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthRevenue = rev
    .filter(r => r.date >= monthStart && r.type !== 'refund')
    .reduce((sum, r) => sum + r.amount, 0);
  const monthRefunds = rev
    .filter(r => r.date >= monthStart && r.type === 'refund')
    .reduce((sum, r) => sum + r.amount, 0);

  return {
    timestamp: Date.now(),
    tickets: {
      open: openTickets.length,
      aiWorking: aiWorking.length,
      needsReview: needsReview.length,
      total: tickets.length,
      resolved: tickets.filter(t => t.status === 'resolved').length
    },
    subscribers: {
      active: activeSubs.length,
      trial: subs.filter(s => s.status === 'trial').length,
      churned: subs.filter(s => s.status === 'churned').length,
      total: subs.length
    },
    revenue: {
      mrr,
      monthRevenue,
      monthRefunds,
      totalAllTime: rev.filter(r => r.type !== 'refund').reduce((s, r) => s + r.amount, 0)
    }
  };
}

// ── WebSocket ────────────────────────────────────────────
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  // Send initial state
  ws.send(JSON.stringify({ type: 'init', data: getStats() }));

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// Heartbeat interval
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Broadcast stats every 5 seconds
setInterval(() => {
  broadcast({ type: 'stats', data: getStats() });
}, 5000);

// ── Clauser Offline Detection ────────────────────────────
const clauserRoute = require('./routes/clauser');
let clauserWasOnline = false;

setInterval(() => {
  const online = clauserRoute.isOnline();
  if (clauserWasOnline && !online) {
    alertRouter.send('clauser-offline', 'high',
      'Clauser AI agent went offline',
      { lastStatus: clauserRoute.getStatus() }
    );
  }
  clauserWasOnline = online;
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ── Start ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║     SWEEPNSPECT HQ — ONLINE          ║`);
  console.log(`  ║     http://localhost:${PORT}            ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  console.log(`  WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`  API:        http://localhost:${PORT}/api/*\n`);
});
