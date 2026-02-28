const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

// ── Load .env ────────────────────────────────────────────
const envFs = require('fs');
const envPath = path.join(__dirname, '.env');
if (envFs.existsSync(envPath)) {
  envFs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length && !process.env[key.trim()]) {
      process.env[key.trim()] = val.join('=').trim();
    }
  });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 8888;

// ── Middleware ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// CORS for localhost dev + production
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = origin && (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /\.sweepnspect\.com$/.test(origin) ||
    /\.railway\.app$/.test(origin)
  );
  if (allowed) {
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

// ── Email Router + Poller ────────────────────────────────
const EmailRouter = require('./lib/email-router');
const EmailPoller = require('./lib/email-poller');
const emailRouter = new EmailRouter(jsonStore, broadcast, alertRouter);
const emailPoller = new EmailPoller(broadcast, alertRouter, emailRouter);

// ── Worker Poller (Cloudflare → HQ bridge) ──────────────
const WorkerPoller = require('./lib/worker-poller');
const workerPoller = new WorkerPoller(jsonStore, broadcast, alertRouter);

// ── Relay Bridge + Automation Rules ─────────────────────
const RelayBridge = require('./lib/relay-bridge');
const AutomationRules = require('./lib/automation-rules');
const relayBridge = new RelayBridge(broadcast);
const automationRules = new AutomationRules(relayBridge, broadcast);

// ── Facebook Service ─────────────────────────────────────
const FacebookService = require('./lib/facebook');
const facebookService = new FacebookService();

// Make store + services available to routes
app.locals.jsonStore = jsonStore;
app.locals.broadcast = broadcast;
app.locals.alertRouter = alertRouter;
app.locals.smsService = smsService;
app.locals.emailPoller = emailPoller;
app.locals.emailRouter = emailRouter;
app.locals.workerPoller = workerPoller;
app.locals.relayBridge = relayBridge;
app.locals.automationRules = automationRules;
app.locals.facebookService = facebookService;

// ── Routes ───────────────────────────────────────────────
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/subscribers', require('./routes/subscribers'));
app.use('/api/revenue', require('./routes/revenue'));
app.use('/api/commands', require('./routes/commands'));
app.use('/api/clauser', require('./routes/clauser'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/comms', require('./routes/comms'));
app.use('/api/livechat', require('./routes/livechat'));
app.use('/api/automation', require('./routes/automation'));

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

app.get('/api/worker/status', (req, res) => {
  res.json(workerPoller.getStatus());
});

// ── System endpoints (for dashboard System view) ─────────
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/system/services', async (req, res) => {
  const inbox = emailPoller.getInbox();
  const worker = workerPoller.getStatus();

  let clauserData = { status: 'offline' };
  try {
    const clauserMod = require('./routes/clauser');
    clauserData = clauserMod.getStatus();
  } catch {}

  let relayOk = false;
  try {
    const health = await relayBridge.getHealth().catch(() => null);
    relayOk = !!health;
  } catch {}

  let aiOk = false;
  try {
    const aiRes = await new Promise((resolve) => {
      const r = require('http').get(`http://${process.env.AI_PROXY_HOST || '127.0.0.1'}:${process.env.AI_PROXY_PORT || 8889}/status`, { timeout: 3000 }, (resp) => {
        resolve(resp.statusCode === 200);
      });
      r.on('error', () => resolve(false));
      r.on('timeout', () => { r.destroy(); resolve(false); });
    });
    aiOk = aiRes;
  } catch {}

  res.json({
    hq:       { status: 'online', detail: 'Port 8888' },
    ws:       { status: 'online', detail: `${wss.clients.size} client${wss.clients.size !== 1 ? 's' : ''}` },
    email:    { status: inbox.status === 'polling' || inbox.status === 'connected' ? 'online' : inbox.status === 'error' ? 'error' : 'offline', detail: inbox.status === 'error' ? inbox.error : `${inbox.checkCount} checks, ${inbox.unread} unread`, lastCheck: inbox.lastCheck },
    livechat: { status: 'online', detail: 'Custom chat relay via CF Worker' },
    facebook: facebookService.configured
      ? { status: 'online', detail: `Page ${facebookService.getStatus().pageId} — ${facebookService.getStatus().requestCount} requests` }
      : { status: 'standby', detail: 'Webhook receiver ready — no page token' },
    clauser:  { status: clauserData.status === 'offline' ? 'offline' : 'online', detail: clauserData.currentTask || (clauserData.status === 'online' ? 'Idle' : clauserData.status) },
    ai:       { status: aiOk ? 'online' : 'offline', detail: aiOk ? 'Claude CLI bridge' : 'AI Proxy not running' },
    relay:    { status: relayOk ? 'online' : 'offline', detail: relayOk ? 'Hive mesh connected' : 'Relay not reachable' },
    worker:   { status: worker.status === 'connected' ? 'online' : worker.status === 'error' ? 'error' : 'offline', detail: worker.status === 'connected' ? `${worker.checkCount} checks` : (worker.error || 'Not connected'), lastCheck: worker.lastCheck },
  });
});

// ADB push notification to Z Fold
app.post('/api/system/notify-phone', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const result = await smsService.send(message);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/worker/health', async (req, res) => {
  const status = workerPoller.getStatus();
  res.json({
    ok: status.status === 'connected',
    status: status.status,
    lastCheck: status.lastCheck,
    workerUrl: status.workerUrl,
  });
});

app.get('/api/relay/status', async (req, res) => {
  try {
    const health = await relayBridge.getHealth().catch(() => null);
    const heartbeats = health?.heartbeats || {};

    // Build nodes array from heartbeat data
    const nodes = [];

    // Genesis (this machine)
    const hubBeat = heartbeats.hub || {};
    nodes.push({
      name: 'GENESIS',
      id: 'genesis',
      platform: 'Windows',
      ip: '100.73.4.77',
      lastSeen: hubBeat.ts || new Date().toISOString(),
      status: 'online',
      port: 8888,
    });

    // Z Fold (from z heartbeat)
    const zBeat = heartbeats.z || {};
    if (zBeat.ts) {
      nodes.push({
        name: 'Z Fold',
        id: 'z',
        platform: 'Android',
        ip: '100.99.38.96',
        lastSeen: zBeat.ts,
        battery: zBeat.battery,
        status: zBeat.genesis || 'unknown',
      });
    }

    // Event Watcher
    const ewBeat = heartbeats['event-watcher'] || {};
    if (ewBeat.ts) {
      nodes.push({
        name: 'Event Watcher',
        id: 'event-watcher',
        platform: 'Daemon',
        lastSeen: ewBeat.ts,
        status: ewBeat.status || 'unknown',
      });
    }

    res.json({
      status: 'ok',
      nodes,
      relay: {
        uptime: health?.uptime,
        totalMessages: health?.totalMessages,
      },
    });
  } catch (err) {
    res.json({ status: 'error', error: err.message, nodes: [] });
  }
});

app.get('/api/relay/messages', async (req, res) => {
  try {
    // Peek at messages from multiple queues without consuming them
    const results = await Promise.allSettled([
      relayBridge.peekMessages('genesis'),
      relayBridge.peekMessages('hub'),
      relayBridge.peekMessages('z'),
    ]);

    const all = [];
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value?.messages) {
        all.push(...r.value.messages);
      }
    });

    // Sort by timestamp descending
    all.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
    res.json({ messages: all });
  } catch (err) {
    res.json({ messages: [], error: err.message });
  }
});

// ── Data Management ──────────────────────────────────────
const DATA_STORES = {
  tickets:       { file: 'tickets.json',        empty: [],  label: 'Tickets' },
  subscribers:   { file: 'subscribers.json',     empty: [],  label: 'Subscribers' },
  revenue:       { file: 'revenue.json',         empty: [],  label: 'Revenue' },
  alerts:        { file: 'alerts.json',          empty: [],  label: 'Alerts' },
  commands:      { file: 'commands.json',        empty: { tasks: [], schedule: [] }, label: 'Tasks & Schedule' },
  'comms-fb':    { file: 'comms-facebook.json',   empty: [],  label: 'Facebook Messages' },
  'comms-sms':   { file: 'comms-sms.json',       empty: [],  label: 'SMS Messages' },
  marketing:     { file: 'marketing.json',        empty: [],  label: 'Marketing' },
  'marketing-posts': { file: 'marketing-posts.json', empty: [], label: 'Marketing Posts' },
  'auto-log':    { file: 'automation-log.json',   empty: [],  label: 'Automation Log' },
  'livechat':    { file: 'livechat-sessions.json', empty: [], label: 'Live Chat Sessions' },
};

app.get('/api/data/stores', (req, res) => {
  const stores = {};
  for (const [key, def] of Object.entries(DATA_STORES)) {
    const data = jsonStore(def.file).read();
    const count = Array.isArray(data) ? data.length
      : (data.tasks ? data.tasks.length + (data.schedule?.length || 0) : 0);
    stores[key] = { label: def.label, file: def.file, count };
  }
  res.json(stores);
});

app.delete('/api/data/:store', (req, res) => {
  const def = DATA_STORES[req.params.store];
  if (!def) return res.status(404).json({ error: 'Unknown store: ' + req.params.store });
  const s = jsonStore(def.file);
  s.write(JSON.parse(JSON.stringify(def.empty)));
  broadcast({ type: 'data:purged', data: { store: req.params.store, label: def.label } });
  res.json({ ok: true, store: req.params.store, label: def.label });
});

app.delete('/api/data', (req, res) => {
  const purged = [];
  for (const [key, def] of Object.entries(DATA_STORES)) {
    const s = jsonStore(def.file);
    s.write(JSON.parse(JSON.stringify(def.empty)));
    purged.push(key);
  }
  broadcast({ type: 'data:purged-all', data: { stores: purged } });
  res.json({ ok: true, purged });
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

  const inbox = emailPoller.getInbox();

  const lcSessions = jsonStore('livechat-sessions.json').read();
  const activeLc = lcSessions.filter(s => s.status === 'active');

  return {
    timestamp: Date.now(),
    livechat: { active: activeLc.length, total: lcSessions.length },
    inbox: {
      unread: inbox.unread,
      total: inbox.total,
      status: inbox.status,
      lastCheck: inbox.lastCheck,
      byCategory: inbox.byCategory || {},
    },
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

  // Auto-evaluate automation rules for broadcast events
  // (skip stats/init/relay to avoid loops)
  if (automationRules && msg.type && !['stats', 'init', 'relay:health', 'automation:fired', 'tts:speak'].includes(msg.type)) {
    automationRules.evaluate(msg.type, msg.data).catch(err => {
      console.error('[AUTOMATION] Broadcast rule error:', err.message);
    });
  }
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

// ── Marketing Post Scheduler (publish scheduled posts) ──
setInterval(() => {
  if (!facebookService.configured) return;
  const ps = jsonStore('marketing-posts.json');
  const posts = ps.read();
  const now = Date.now();
  let changed = false;

  posts.forEach(async (post) => {
    if (post.status !== 'scheduled' || !post.scheduledFor) return;
    if (new Date(post.scheduledFor).getTime() > now) return;

    const result = await facebookService.createPost(post.message, post.link || undefined);
    if (result.ok) {
      post.status = 'published';
      post.fbPostId = result.data.id;
      post.publishedAt = new Date().toISOString();
      broadcast({ type: 'marketing:post-published', data: post });
    } else {
      post.status = 'failed';
      post.lastError = result.error;
    }
    post.updatedAt = new Date().toISOString();
    changed = true;
  });

  // Write after all synchronous marking is done (async publishes write individually)
  if (changed) {
    setTimeout(() => ps.write(posts), 2000);
  }
}, 60000);

wss.on('close', () => clearInterval(heartbeat));

// ── Start ────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RAILWAY_PUBLIC_DOMAIN || `localhost:${PORT}`;
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║     SWEEPNSPECT HQ — ONLINE          ║`);
  console.log(`  ║     ${host.padEnd(34)}║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  console.log(`  API:        /api/*`);
  console.log(`  Inbox:      /api/inbox\n`);

  // Start email poller
  emailPoller.start().catch(err => console.error('[EMAIL] Start failed:', err));

  // Start worker poller (Cloudflare → HQ bridge)
  workerPoller.start().catch(err => console.error('[WORKER] Start failed:', err));

  // Start relay health polling (broadcasts mesh status every 30s)
  relayBridge.startHealthPolling(30000);
  console.log(`  Relay:      ${relayBridge.getConnectionStatus().relayUrl}`);
  console.log(`  Automation: ${automationRules.getRules().length} rules loaded`);
});
