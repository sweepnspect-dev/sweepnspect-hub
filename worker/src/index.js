/**
 * SweepNspect HQ Worker — Full API
 * GitHub Pages dashboard + Cloudflare Worker + KV
 *
 * Endpoints:
 *   Webhooks (public):
 *     POST /api/founding         — founding application
 *     GET  /api/founding         — list applications
 *     POST /api/webhooks/tawk    — Tawk.to webhook
 *     GET  /api/webhooks/facebook — FB verify
 *     POST /api/webhooks/facebook — FB events
 *
 *   Dashboard API (auth required):
 *     GET/POST       /api/tickets
 *     GET/PUT/DELETE /api/tickets/:id
 *     POST           /api/tickets/:id/messages
 *     GET/POST       /api/subscribers
 *     GET/PUT/DELETE /api/subscribers/:id
 *     GET/POST       /api/alerts
 *     POST           /api/alerts/:id/acknowledge
 *     GET            /api/alerts/config
 *     PUT            /api/alerts/config
 *     GET/POST       /api/revenue
 *     PUT/DELETE     /api/revenue/:id
 *     GET            /api/commands
 *     POST/PUT/DELETE /api/commands/tasks[/:id]
 *     POST/DELETE    /api/commands/schedule[/:id]
 *     GET            /api/stats
 *     GET            /api/marketing
 *     GET            /api/inbox
 *     GET            /api/tawk/status
 *     GET            /health
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env, ctx) {
    env.waitUntil = ctx.waitUntil.bind(ctx);
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Public webhook endpoints (no auth) ──────────────
    if (path === '/api/founding' && method === 'POST') return handleFoundingApplication(request, env);
    if (path === '/api/founding' && method === 'GET') return handleGetApplications(request, env);
    if (path === '/api/webhooks/tawk' && method === 'POST') return handleTawkWebhook(request, env);
    if (path === '/api/webhooks/facebook' && method === 'GET') return handleFacebookVerify(request, env);
    if (path === '/api/webhooks/facebook' && method === 'POST') return handleFacebookWebhook(request, env);
    if (path === '/api/webhooks/ticket' && method === 'POST') return handleWebhookTicket(request, env);
    if (path === '/health') return json({ status: 'ok', service: 'sweepnspect-hq', timestamp: Date.now() });

    // ── Legacy event polling (for Hub server compatibility) ──
    if (path === '/api/events' && method === 'GET') return handleGetEvents(request, env);
    if (path === '/api/events/ack' && method === 'POST') return handleAckEvents(request, env);

    // ── Dashboard API (auth required) ───────────────────
    const authErr = checkAuth(request, env);
    if (authErr) return authErr;

    // Tickets
    if (path === '/api/tickets' && method === 'GET') return handleListTickets(request, env);
    if (path === '/api/tickets' && method === 'POST') return handleCreateTicket(request, env);
    if (path.match(/^\/api\/tickets\/[^/]+$/) && method === 'GET') return handleGetTicket(request, env, pathId(path));
    if (path.match(/^\/api\/tickets\/[^/]+$/) && method === 'PUT') return handleUpdateTicket(request, env, pathId(path));
    if (path.match(/^\/api\/tickets\/[^/]+$/) && method === 'DELETE') return handleDeleteRecord(env, 'tickets', pathId(path));
    if (path.match(/^\/api\/tickets\/[^/]+\/messages$/) && method === 'POST') return handleAddMessage(request, env, path.split('/')[3]);

    // Subscribers
    if (path === '/api/subscribers' && method === 'GET') return handleListSubscribers(request, env);
    if (path === '/api/subscribers' && method === 'POST') return handleCreateSubscriber(request, env);
    if (path.match(/^\/api\/subscribers\/[^/]+$/) && method === 'GET') return handleGetRecord(env, 'subs', pathId(path));
    if (path.match(/^\/api\/subscribers\/[^/]+$/) && method === 'PUT') return handleUpdateSubscriber(request, env, pathId(path));
    if (path.match(/^\/api\/subscribers\/[^/]+$/) && method === 'DELETE') return handleDeleteRecord(env, 'subs', pathId(path));

    // Alerts
    if (path === '/api/alerts' && method === 'GET') return handleListAlerts(request, env);
    if (path === '/api/alerts/config' && method === 'GET') return handleGetAlertConfig(env);
    if (path === '/api/alerts/config' && method === 'PUT') return handleUpdateAlertConfig(request, env);
    if (path.match(/^\/api\/alerts\/[^/]+\/acknowledge$/) && method === 'POST') return handleAcknowledgeAlert(env, path.split('/')[3]);

    // Revenue
    if (path === '/api/revenue' && method === 'GET') return handleListRevenue(request, env);
    if (path === '/api/revenue' && method === 'POST') return handleCreateRevenue(request, env);
    if (path.match(/^\/api\/revenue\/[^/]+$/) && method === 'PUT') return handleUpdateRevenue(request, env, pathId(path));
    if (path.match(/^\/api\/revenue\/[^/]+$/) && method === 'DELETE') return handleDeleteRecord(env, 'revenue', pathId(path));

    // Commands (tasks + schedule)
    if (path === '/api/commands' && method === 'GET') return handleGetCommands(env);
    if (path === '/api/commands/tasks' && method === 'POST') return handleCreateTask(request, env);
    if (path.match(/^\/api\/commands\/tasks\/[^/]+$/) && method === 'PUT') return handleUpdateTask(request, env, pathId(path, 4));
    if (path.match(/^\/api\/commands\/tasks\/[^/]+$/) && method === 'DELETE') return handleDeleteTask(env, pathId(path, 4));
    if (path === '/api/commands/schedule' && method === 'POST') return handleCreateSchedule(request, env);
    if (path.match(/^\/api\/commands\/schedule\/[^/]+$/) && method === 'DELETE') return handleDeleteSchedule(env, pathId(path, 4));

    // Stats & Status
    if (path === '/api/stats' && method === 'GET') return handleGetStats(env);
    if (path === '/api/marketing' && method === 'GET') return handleGetMarketing(env);
    if (path === '/api/inbox' && method === 'GET') return handleGetInbox(env);
    if (path === '/api/tawk/status' && method === 'GET') return handleTawkStatus(env);
    if (path === '/api/sms/status' && method === 'GET') return json({ configured: false, provider: 'none' });
    if (path === '/api/worker/status' && method === 'GET') return json({ status: 'edge', provider: 'cloudflare' });

    return json({ error: 'Not found' }, 404);
  },
};

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

function checkAuth(request, env) {
  const token = env.HUB_API_TOKEN;
  if (!token) return null; // No token configured = open access (dev mode)
  const auth = request.headers.get('Authorization');
  if (auth === `Bearer ${token}`) return null;
  return json({ error: 'Unauthorized' }, 401);
}

// ══════════════════════════════════════════════════════════════
// KV HELPERS
// ══════════════════════════════════════════════════════════════

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function pathId(path, segment = 3) {
  return path.split('/')[segment];
}

async function kvGetIndex(env, collection) {
  const raw = await env.EVENTS.get(`${collection}:_index`);
  return raw ? JSON.parse(raw) : [];
}

async function kvPutIndex(env, collection, index) {
  await env.EVENTS.put(`${collection}:_index`, JSON.stringify(index));
}

async function kvGetRecord(env, collection, id) {
  const raw = await env.EVENTS.get(`${collection}:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function kvPutRecord(env, collection, id, data, ttl) {
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await env.EVENTS.put(`${collection}:${id}`, JSON.stringify(data), opts);
}

async function kvDeleteRecord(env, collection, id) {
  await env.EVENTS.delete(`${collection}:${id}`);
}

async function kvNextId(env, collection, prefix) {
  const index = await kvGetIndex(env, collection);
  const nums = index.map(i => {
    const m = i.id.match(/\d+$/);
    return m ? parseInt(m[0]) : 0;
  });
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

// Generic get single record
async function handleGetRecord(env, collection, id) {
  const record = await kvGetRecord(env, collection, id);
  if (!record) return json({ error: 'Not found' }, 404);
  return json(record);
}

// Generic delete
async function handleDeleteRecord(env, collection, id) {
  await kvDeleteRecord(env, collection, id);
  const index = await kvGetIndex(env, collection);
  const updated = index.filter(i => i.id !== id);
  await kvPutIndex(env, collection, updated);
  return json({ ok: true });
}

// ══════════════════════════════════════════════════════════════
// TICKETS
// ══════════════════════════════════════════════════════════════

async function handleListTickets(request, env) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const priorityFilter = url.searchParams.get('priority');

  const index = await kvGetIndex(env, 'tickets');
  let filtered = index;
  if (statusFilter) filtered = filtered.filter(t => t.status === statusFilter);
  if (priorityFilter) filtered = filtered.filter(t => t.priority === priorityFilter);
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Hydrate full records
  const tickets = [];
  for (const entry of filtered) {
    const record = await kvGetRecord(env, 'tickets', entry.id);
    if (record) tickets.push(record);
  }
  return json(tickets);
}

async function handleGetTicket(request, env, id) {
  return handleGetRecord(env, 'tickets', id);
}

async function handleCreateTicket(request, env) {
  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const id = await kvNextId(env, 'tickets', 't');
  const ticket = {
    id,
    status: body.status || 'new',
    priority: body.priority || 'normal',
    source: body.source || 'manual',
    emailUid: body.emailUid || null,
    customer: body.customer || { name: 'Unknown', email: '', subscriberId: '' },
    subject: body.subject || 'No subject',
    description: body.description || '',
    aiAnalysis: null,
    resolution: '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    messages: [],
  };

  await kvPutRecord(env, 'tickets', id, ticket);
  const index = await kvGetIndex(env, 'tickets');
  index.push({ id, status: ticket.status, priority: ticket.priority, createdAt: ticket.createdAt });
  await kvPutIndex(env, 'tickets', index);

  // Alert for high-priority tickets
  if (['critical', 'high'].includes(ticket.priority)) {
    await sendAlert(env, 'ticket-new', ticket.priority,
      `New ticket (${ticket.priority}): ${ticket.subject}`, { ticketId: id });
  }

  await updateStats(env);
  return json(ticket, 201);
}

async function handleUpdateTicket(request, env, id) {
  const ticket = await kvGetRecord(env, 'tickets', id);
  if (!ticket) return json({ error: 'Not found' }, 404);

  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const allowedFields = ['status', 'priority', 'resolution', 'aiAnalysis', 'subject', 'description', 'customer', 'source'];
  for (const field of allowedFields) {
    if (body[field] !== undefined) ticket[field] = body[field];
  }

  if (body.status === 'resolved' && !ticket.resolvedAt) {
    ticket.resolvedAt = new Date().toISOString();
  }

  // Alert on escalation
  if (body.status === 'escalated') {
    await sendAlert(env, 'ticket-escalated', 'critical',
      `Ticket escalated: ${ticket.subject}`, { ticketId: id });
  }

  await kvPutRecord(env, 'tickets', id, ticket);

  // Update index
  const index = await kvGetIndex(env, 'tickets');
  const idx = index.findIndex(i => i.id === id);
  if (idx >= 0) {
    index[idx] = { id, status: ticket.status, priority: ticket.priority, createdAt: ticket.createdAt };
  }
  await kvPutIndex(env, 'tickets', index);
  await updateStats(env);

  return json(ticket);
}

async function handleAddMessage(request, env, ticketId) {
  const ticket = await kvGetRecord(env, 'tickets', ticketId);
  if (!ticket) return json({ error: 'Not found' }, 404);

  const body = await safeJson(request);
  if (!body || !body.text) return json({ error: 'text is required' }, 400);

  const msg = {
    id: `msg-${Date.now().toString(36)}`,
    from: body.from || 'Agent',
    text: body.text,
    timestamp: new Date().toISOString(),
  };

  ticket.messages.push(msg);
  await kvPutRecord(env, 'tickets', ticketId, ticket);
  return json(msg, 201);
}

// ══════════════════════════════════════════════════════════════
// SUBSCRIBERS
// ══════════════════════════════════════════════════════════════

async function handleListSubscribers(request, env) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const planFilter = url.searchParams.get('plan');

  const index = await kvGetIndex(env, 'subs');
  let filtered = index;
  if (statusFilter) filtered = filtered.filter(s => s.status === statusFilter);
  if (planFilter) filtered = filtered.filter(s => s.plan === planFilter);
  filtered.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

  const subs = [];
  for (const entry of filtered) {
    const record = await kvGetRecord(env, 'subs', entry.id);
    if (record) subs.push(record);
  }
  return json(subs);
}

async function handleCreateSubscriber(request, env) {
  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const id = await kvNextId(env, 'subs', 's');
  const sub = {
    id,
    name: body.name || '',
    email: body.email || '',
    plan: body.plan || 'trial',
    mrr: body.mrr || 0,
    status: body.status || 'trial',
    source: body.source || 'manual',
    startDate: body.startDate || new Date().toISOString(),
    tickets: [],
    founding: body.founding || null,
  };

  await kvPutRecord(env, 'subs', id, sub);
  const index = await kvGetIndex(env, 'subs');
  index.push({ id, name: sub.name, email: sub.email, status: sub.status, plan: sub.plan, startDate: sub.startDate });
  await kvPutIndex(env, 'subs', index);
  await updateStats(env);

  return json(sub, 201);
}

async function handleUpdateSubscriber(request, env, id) {
  const sub = await kvGetRecord(env, 'subs', id);
  if (!sub) return json({ error: 'Not found' }, 404);

  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const prevStatus = sub.status;
  const allowedFields = ['name', 'email', 'plan', 'mrr', 'status', 'source'];
  for (const field of allowedFields) {
    if (body[field] !== undefined) sub[field] = body[field];
  }

  // Alert on churn
  if (body.status === 'churned' && prevStatus !== 'churned') {
    await sendAlert(env, 'subscriber-churned', 'critical',
      `Subscriber churned: ${sub.name} ($${sub.mrr}/mo lost)`,
      { subscriberId: id, mrrLost: sub.mrr });
  }

  await kvPutRecord(env, 'subs', id, sub);

  const index = await kvGetIndex(env, 'subs');
  const idx = index.findIndex(i => i.id === id);
  if (idx >= 0) {
    index[idx] = { id, name: sub.name, email: sub.email, status: sub.status, plan: sub.plan, startDate: sub.startDate };
  }
  await kvPutIndex(env, 'subs', index);
  await updateStats(env);

  return json(sub);
}

// ══════════════════════════════════════════════════════════════
// ALERTS
// ══════════════════════════════════════════════════════════════

async function sendAlert(env, type, severity, message, data = {}) {
  const id = genId('alert');
  const alert = {
    id, type, severity, message, data,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };

  await kvPutRecord(env, 'alerts', id, alert, 2592000); // 30 day TTL
  const index = await kvGetIndex(env, 'alerts');
  index.push({ id, type, severity, timestamp: alert.timestamp, acknowledged: false });
  await kvPutIndex(env, 'alerts', index);

  // Notify via Tawk for high-priority
  if (['critical', 'high'].includes(severity)) {
    const evt = { event: type, priority: severity, summary: message, receivedAt: alert.timestamp, ...data };
    env.waitUntil(notifyTawk(evt, env));
  }

  return alert;
}

async function handleListAlerts(request, env) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit')) || 50;

  const index = await kvGetIndex(env, 'alerts');
  const recent = index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);

  const alerts = [];
  for (const entry of recent) {
    const record = await kvGetRecord(env, 'alerts', entry.id);
    if (record) alerts.push(record);
  }
  return json(alerts);
}

async function handleAcknowledgeAlert(env, id) {
  const alert = await kvGetRecord(env, 'alerts', id);
  if (!alert) return json({ error: 'Not found' }, 404);

  alert.acknowledged = true;
  await kvPutRecord(env, 'alerts', id, alert, 2592000);

  const index = await kvGetIndex(env, 'alerts');
  const idx = index.findIndex(i => i.id === id);
  if (idx >= 0) index[idx].acknowledged = true;
  await kvPutIndex(env, 'alerts', index);

  return json(alert);
}

async function handleGetAlertConfig(env) {
  const raw = await env.EVENTS.get('alerts:_config');
  const config = raw ? JSON.parse(raw) : { smsEnabled: false, tawkEnabled: true, cooldownMs: 300000 };
  return json(config);
}

async function handleUpdateAlertConfig(request, env) {
  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  await env.EVENTS.put('alerts:_config', JSON.stringify(body));
  return json(body);
}

// ══════════════════════════════════════════════════════════════
// REVENUE
// ══════════════════════════════════════════════════════════════

async function handleListRevenue(request, env) {
  const url = new URL(request.url);
  const typeFilter = url.searchParams.get('type');
  const monthFilter = url.searchParams.get('month');

  const index = await kvGetIndex(env, 'revenue');
  let filtered = index;
  if (typeFilter) filtered = filtered.filter(r => r.type === typeFilter);
  if (monthFilter) filtered = filtered.filter(r => r.date && r.date.startsWith(monthFilter));
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  const entries = [];
  for (const entry of filtered) {
    const record = await kvGetRecord(env, 'revenue', entry.id);
    if (record) entries.push(record);
  }
  return json(entries);
}

async function handleCreateRevenue(request, env) {
  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const id = await kvNextId(env, 'revenue', 'r');
  const entry = {
    id,
    type: body.type || 'subscription',
    amount: parseFloat(body.amount) || 0,
    subscriberId: body.subscriberId || '',
    date: body.date || new Date().toISOString(),
    note: body.note || '',
  };

  await kvPutRecord(env, 'revenue', id, entry);
  const index = await kvGetIndex(env, 'revenue');
  index.push({ id, type: entry.type, amount: entry.amount, date: entry.date });
  await kvPutIndex(env, 'revenue', index);
  await updateStats(env);

  return json(entry, 201);
}

async function handleUpdateRevenue(request, env, id) {
  const entry = await kvGetRecord(env, 'revenue', id);
  if (!entry) return json({ error: 'Not found' }, 404);

  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  for (const field of ['type', 'amount', 'subscriberId', 'date', 'note']) {
    if (body[field] !== undefined) entry[field] = body[field];
  }
  if (body.amount !== undefined) entry.amount = parseFloat(body.amount) || 0;

  await kvPutRecord(env, 'revenue', id, entry);

  const index = await kvGetIndex(env, 'revenue');
  const idx = index.findIndex(i => i.id === id);
  if (idx >= 0) {
    index[idx] = { id, type: entry.type, amount: entry.amount, date: entry.date };
  }
  await kvPutIndex(env, 'revenue', index);
  await updateStats(env);

  return json(entry);
}

// ══════════════════════════════════════════════════════════════
// COMMANDS (Tasks + Schedule)
// ══════════════════════════════════════════════════════════════

async function getCommands(env) {
  const raw = await env.EVENTS.get('commands:_data');
  return raw ? JSON.parse(raw) : { tasks: [], schedule: [] };
}

async function putCommands(env, data) {
  await env.EVENTS.put('commands:_data', JSON.stringify(data));
}

async function handleGetCommands(env) {
  return json(await getCommands(env));
}

async function handleCreateTask(request, env) {
  const body = await safeJson(request);
  if (!body || !body.text) return json({ error: 'text is required' }, 400);

  const commands = await getCommands(env);
  const task = {
    id: `task-${Date.now().toString(36)}`,
    text: body.text,
    done: false,
    priority: body.priority || 'normal',
    createdAt: new Date().toISOString(),
  };
  commands.tasks.push(task);
  await putCommands(env, commands);
  return json(task, 201);
}

async function handleUpdateTask(request, env, id) {
  const commands = await getCommands(env);
  const task = commands.tasks.find(t => t.id === id);
  if (!task) return json({ error: 'Not found' }, 404);

  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  if (body.done !== undefined) task.done = body.done;
  if (body.text !== undefined) task.text = body.text;
  if (body.priority !== undefined) task.priority = body.priority;
  await putCommands(env, commands);
  return json(task);
}

async function handleDeleteTask(env, id) {
  const commands = await getCommands(env);
  commands.tasks = commands.tasks.filter(t => t.id !== id);
  await putCommands(env, commands);
  return json({ ok: true });
}

async function handleCreateSchedule(request, env) {
  const body = await safeJson(request);
  if (!body || !body.title) return json({ error: 'title is required' }, 400);

  const commands = await getCommands(env);
  const entry = {
    id: `sched-${Date.now().toString(36)}`,
    title: body.title,
    time: body.time || '',
    date: body.date || new Date().toISOString().slice(0, 10),
    type: body.type || 'reminder',
    createdAt: new Date().toISOString(),
  };
  commands.schedule.push(entry);
  await putCommands(env, commands);
  return json(entry, 201);
}

async function handleDeleteSchedule(env, id) {
  const commands = await getCommands(env);
  commands.schedule = commands.schedule.filter(s => s.id !== id);
  await putCommands(env, commands);
  return json({ ok: true });
}

// ══════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════

async function computeStats(env) {
  const ticketIndex = await kvGetIndex(env, 'tickets');
  const subIndex = await kvGetIndex(env, 'subs');
  const revenueIndex = await kvGetIndex(env, 'revenue');
  const alertIndex = await kvGetIndex(env, 'alerts');

  const openTickets = ticketIndex.filter(t => !['resolved', 'closed'].includes(t.status));
  const aiWorking = ticketIndex.filter(t => t.status === 'ai-working');
  const needsReview = ticketIndex.filter(t => t.status === 'review');
  const activeSubs = subIndex.filter(s => s.status === 'active');
  const trialSubs = subIndex.filter(s => s.status === 'trial');

  // Get MRR from full records (index doesn't have mrr)
  let mrr = 0;
  for (const s of activeSubs) {
    const full = await kvGetRecord(env, 'subs', s.id);
    if (full) mrr += full.mrr || 0;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthRevEntries = revenueIndex.filter(r => r.date >= monthStart);
  const monthRevenue = monthRevEntries.filter(r => r.type !== 'refund').reduce((sum, r) => sum + (r.amount || 0), 0);
  const monthRefunds = monthRevEntries.filter(r => r.type === 'refund').reduce((sum, r) => sum + (r.amount || 0), 0);
  const totalAllTime = revenueIndex.filter(r => r.type !== 'refund').reduce((sum, r) => sum + (r.amount || 0), 0);

  const unackedAlerts = alertIndex.filter(a => !a.acknowledged).length;

  return {
    timestamp: Date.now(),
    inbox: { unread: 0, total: 0, status: 'edge', lastCheck: null, byCategory: {} },
    tickets: {
      open: openTickets.length,
      aiWorking: aiWorking.length,
      needsReview: needsReview.length,
      total: ticketIndex.length,
      resolved: ticketIndex.filter(t => t.status === 'resolved').length,
    },
    subscribers: {
      active: activeSubs.length,
      trial: trialSubs.length,
      churned: subIndex.filter(s => s.status === 'churned').length,
      total: subIndex.length,
    },
    revenue: { mrr, monthRevenue, monthRefunds, totalAllTime },
    alerts: { unacknowledged: unackedAlerts, total: alertIndex.length },
  };
}

async function updateStats(env) {
  try {
    const stats = await computeStats(env);
    await env.EVENTS.put('stats:latest', JSON.stringify(stats));
  } catch (err) {
    console.error('[STATS] Update failed:', err.message);
  }
}

async function handleGetStats(env) {
  // Try cached first (updated on every write)
  const cached = await env.EVENTS.get('stats:latest');
  if (cached) {
    const stats = JSON.parse(cached);
    // If cached stats are less than 10s old, use them
    if (Date.now() - stats.timestamp < 10000) return json(stats);
  }
  // Recompute
  const stats = await computeStats(env);
  await env.EVENTS.put('stats:latest', JSON.stringify(stats));
  return json(stats);
}

// ══════════════════════════════════════════════════════════════
// MARKETING (read-only for now)
// ══════════════════════════════════════════════════════════════

async function handleGetMarketing(env) {
  const raw = await env.EVENTS.get('marketing:_data');
  if (raw) return json(JSON.parse(raw));
  // Default empty structure
  return json({
    website: { daily: [], sources: [], topPages: [] },
    app: { daily: [], overview: { appRating: 0, reviewCount: 0, dailyActive: 0 }, topScreens: [] },
    campaigns: [],
  });
}

// ══════════════════════════════════════════════════════════════
// INBOX (email events stored in KV)
// ══════════════════════════════════════════════════════════════

async function handleGetInbox(env) {
  const raw = await env.EVENTS.get('inbox:_latest');
  if (raw) return json(JSON.parse(raw));
  return json({
    status: 'edge',
    account: 'contact@sweepnspect.com',
    total: 0,
    unread: 0,
    emails: [],
    byCategory: {},
  });
}

// ══════════════════════════════════════════════════════════════
// TAWK STATUS
// ══════════════════════════════════════════════════════════════

async function handleTawkStatus(env) {
  const email = env.TAWK_TICKET_EMAIL;
  const hasResend = !!env.RESEND_API_KEY;
  return json({
    configured: !!(email && hasResend),
    tawkEmail: email || null,
    resendConfigured: hasResend,
    provider: 'resend-edge',
  });
}

// ══════════════════════════════════════════════════════════════
// WEBHOOK TICKET (external systems can create tickets)
// ══════════════════════════════════════════════════════════════

async function handleWebhookTicket(request, env) {
  const body = await safeJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const id = await kvNextId(env, 'tickets', 't');
  const ticket = {
    id,
    status: 'new',
    priority: body.priority || 'normal',
    source: 'webhook',
    customer: body.customer || { name: 'Unknown', email: '' },
    subject: body.subject || 'No subject',
    description: body.description || '',
    aiAnalysis: null,
    resolution: '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    messages: [],
  };

  await kvPutRecord(env, 'tickets', id, ticket);
  const index = await kvGetIndex(env, 'tickets');
  index.push({ id, status: ticket.status, priority: ticket.priority, createdAt: ticket.createdAt });
  await kvPutIndex(env, 'tickets', index);

  if (['critical', 'high'].includes(ticket.priority)) {
    await sendAlert(env, 'ticket-webhook', ticket.priority,
      `Webhook ticket (${ticket.priority}): ${ticket.subject}`, { ticketId: id });
  }

  await updateStats(env);
  return json({ ok: true, ticket });
}

// ══════════════════════════════════════════════════════════════
// FOUNDING 25 APPLICATION
// ══════════════════════════════════════════════════════════════

async function handleFoundingApplication(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name, email, years_sweeping, current_tools, heard_about, referred_by } = body;
  if (!name || !email || !years_sweeping || !heard_about) {
    return json({ error: 'Missing required fields: name, email, years_sweeping, heard_about' }, 400);
  }

  const id = `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const application = {
    id, name, email,
    years_sweeping: parseInt(years_sweeping) || 0,
    current_tools: current_tools || '',
    heard_about,
    referred_by: referred_by || '',
    status: 'new',
    submittedAt: now,
  };

  await env.EVENTS.put(id, JSON.stringify(application), { expirationTtl: 7776000 });

  const apps = await getApplicationsList(env);
  apps.push(id);
  await env.EVENTS.put('_applications', JSON.stringify(apps));

  // Create event for HQ polling
  const evt = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event: 'founding:application',
    receivedAt: now,
    summary: `Founding 25 application: ${name} (${email}) — ${years_sweeping} years`,
    priority: 'high',
    application,
  };
  await env.EVENTS.put(evt.id, JSON.stringify(evt), { expirationTtl: 2592000 });
  const unacked = await getUnackedList(env);
  unacked.push(evt.id);
  await env.EVENTS.put('_unacked', JSON.stringify(unacked));

  // Also create subscriber in KV
  const subId = await kvNextId(env, 'subs', 's');
  const sub = {
    id: subId, name, email, plan: 'founding', mrr: 0, status: 'lead',
    source: 'founding-form', startDate: now, tickets: [],
    founding: { yearsSweeping: application.years_sweeping, currentTools: application.current_tools, heardAbout: application.heard_about, referredBy: application.referred_by },
  };
  await kvPutRecord(env, 'subs', subId, sub);
  const subIndex = await kvGetIndex(env, 'subs');
  subIndex.push({ id: subId, name, email, status: 'lead', plan: 'founding', startDate: now });
  await kvPutIndex(env, 'subs', subIndex);

  // Alert
  await sendAlert(env, 'founding-application', 'high',
    `Founding 25 application: ${name} (${email}) — ${years_sweeping} years`,
    { subscriberId: subId, email });

  console.log(`[FOUNDING] New application: ${name} (${email})`);
  env.waitUntil(notifyTawk(evt, env));
  await updateStats(env);

  return json({ ok: true, id, message: 'Application received' });
}

async function handleGetApplications(request, env) {
  const apps = await getApplicationsList(env);
  const results = [];
  for (const id of apps) {
    const data = await env.EVENTS.get(id);
    if (data) results.push(JSON.parse(data));
  }
  results.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  return json({ applications: results, total: results.length });
}

async function getApplicationsList(env) {
  const raw = await env.EVENTS.get('_applications');
  return raw ? JSON.parse(raw) : [];
}

// ══════════════════════════════════════════════════════════════
// TAWK.TO WEBHOOK
// ══════════════════════════════════════════════════════════════

async function handleTawkWebhook(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const event = body.event || body.type || 'unknown';
  const now = new Date().toISOString();
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let processed = { id, event, receivedAt: now, raw: body };

  switch (event) {
    case 'chat:start': {
      const visitor = body.visitor || body.requester || {};
      processed.summary = `Live chat: ${visitor.name || 'Visitor'}${visitor.city ? ' from ' + visitor.city : ''}`;
      processed.priority = 'high';
      processed.visitor = { name: visitor.name, city: visitor.city, email: visitor.email };
      processed.chatId = body.chatId || body.id;
      break;
    }
    case 'chat:end': {
      const visitor = body.visitor || body.requester || {};
      processed.summary = `Chat ended: ${visitor.name || 'Visitor'}`;
      processed.priority = 'low';
      processed.visitor = { name: visitor.name };
      processed.chatId = body.chatId || body.id;
      break;
    }
    case 'ticket:create': {
      const name = body.requester?.name || body.visitor?.name || 'Visitor';
      const email = body.requester?.email || body.visitor?.email || '';
      const subject = body.subject || body.message?.substring(0, 80) || 'Chat inquiry';
      processed.summary = `Chat ticket from ${name}: ${subject}`;
      processed.priority = 'normal';
      processed.ticket = { name, email, subject, message: body.message || '' };
      break;
    }
    default:
      processed.summary = `Unknown event: ${event}`;
      processed.priority = 'low';
  }

  await env.EVENTS.put(id, JSON.stringify(processed), { expirationTtl: 2592000 });
  const unacked = await getUnackedList(env);
  unacked.push(id);
  await env.EVENTS.put('_unacked', JSON.stringify(unacked));

  // Also create alert in KV for dashboard
  await sendAlert(env, `tawk-${event}`, processed.priority === 'high' ? 'high' : 'normal',
    processed.summary, { chatId: processed.chatId });

  console.log(`[TAWK] ${event}: ${processed.summary}`);
  env.waitUntil(notifyTawk(processed, env));
  await updateStats(env);

  return json({ ok: true, id });
}

// ══════════════════════════════════════════════════════════════
// FACEBOOK WEBHOOKS
// ══════════════════════════════════════════════════════════════

async function handleFacebookVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = env.FB_VERIFY_TOKEN || 'sweepnspect-fb-verify-2026';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[FB] Webhook verified');
    return new Response(challenge, { status: 200, headers: CORS_HEADERS });
  }
  return json({ error: 'Verification failed' }, 403);
}

async function handleFacebookWebhook(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  if (body.object !== 'page') return json({ error: 'Not a page event' }, 400);

  const now = new Date().toISOString();

  for (const entry of (body.entry || [])) {
    const pageId = entry.id;

    for (const msg of (entry.messaging || [])) {
      const senderId = msg.sender?.id;
      if (senderId === pageId) continue;

      const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const evt = {
        id, event: 'facebook:message', receivedAt: now,
        summary: `FB message from ${senderId}: ${(msg.message?.text || '').substring(0, 80)}`,
        priority: 'high',
        facebook: { pageId, senderId, messageId: msg.message?.mid, text: msg.message?.text || '', timestamp: msg.timestamp },
      };

      await env.EVENTS.put(id, JSON.stringify(evt), { expirationTtl: 2592000 });
      const unacked = await getUnackedList(env);
      unacked.push(id);
      await env.EVENTS.put('_unacked', JSON.stringify(unacked));

      await sendAlert(env, 'facebook-message', 'high', evt.summary, { senderId });
      env.waitUntil(notifyTawk(evt, env));
    }

    for (const change of (entry.changes || [])) {
      if (change.field !== 'feed' || !change.value) continue;
      const value = change.value;

      if (value.item === 'comment' && value.verb === 'add') {
        const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const evt = {
          id, event: 'facebook:comment', receivedAt: now,
          summary: `FB comment by ${value.from?.name || 'someone'}: ${(value.message || '').substring(0, 80)}`,
          priority: 'normal',
          facebook: { pageId, commentId: value.comment_id, postId: value.post_id, parentId: value.parent_id, from: value.from, message: value.message || '', timestamp: value.created_time },
        };
        await env.EVENTS.put(id, JSON.stringify(evt), { expirationTtl: 2592000 });
        const unacked = await getUnackedList(env);
        unacked.push(id);
        await env.EVENTS.put('_unacked', JSON.stringify(unacked));
        await sendAlert(env, 'facebook-comment', 'normal', evt.summary, { from: value.from?.name });
      } else if (value.item === 'reaction' && value.verb === 'add') {
        const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const evt = {
          id, event: 'facebook:reaction', receivedAt: now,
          summary: `FB ${value.reaction_type || 'reaction'} by ${value.from?.name || 'someone'}`,
          priority: 'low',
          facebook: { pageId, postId: value.post_id, from: value.from, reactionType: value.reaction_type },
        };
        await env.EVENTS.put(id, JSON.stringify(evt), { expirationTtl: 2592000 });
        const unacked = await getUnackedList(env);
        unacked.push(id);
        await env.EVENTS.put('_unacked', JSON.stringify(unacked));
      }
    }
  }

  await updateStats(env);
  return json({ ok: true });
}

// ══════════════════════════════════════════════════════════════
// LEGACY EVENT POLLING
// ══════════════════════════════════════════════════════════════

async function handleGetEvents(request, env) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const unacked = await getUnackedList(env);
  const recent = unacked.slice(-limit);
  const events = [];
  for (const id of recent) {
    const data = await env.EVENTS.get(id);
    if (data) events.push(JSON.parse(data));
  }
  return json({ events, total: unacked.length });
}

async function handleAckEvents(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const idsToAck = body.ids || [];
  if (!idsToAck.length) return json({ error: 'No ids provided' }, 400);
  const unacked = await getUnackedList(env);
  const remaining = unacked.filter(id => !idsToAck.includes(id));
  await env.EVENTS.put('_unacked', JSON.stringify(remaining));
  return json({ ok: true, acknowledged: idsToAck.length, remaining: remaining.length });
}

// ══════════════════════════════════════════════════════════════
// TAWK NOTIFICATION (Resend)
// ══════════════════════════════════════════════════════════════

const PRIORITY_EMOJI = { critical: '\u{1F534}', high: '\u{1F7E0}', normal: '\u{1F7E1}', low: '\u{1F7E2}' };
const EVENT_LABELS = {
  'founding:application': 'FOUNDING', 'founding-application': 'FOUNDING',
  'chat:start': 'LIVE CHAT', 'tawk-chat:start': 'LIVE CHAT',
  'facebook:message': 'FB MESSAGE', 'facebook-message': 'FB MESSAGE',
  'facebook:comment': 'FB COMMENT', 'facebook-comment': 'FB COMMENT',
  'ticket:create': 'CHAT TICKET', 'ticket-new': 'NEW TICKET',
  'ticket-webhook': 'WEBHOOK TICKET', 'ticket-escalated': 'ESCALATED',
  'subscriber-churned': 'CHURN',
};

async function notifyTawk(evt, env) {
  const tawkEmail = env.TAWK_TICKET_EMAIL;
  const resendKey = env.RESEND_API_KEY;
  if (!tawkEmail || !resendKey) return;
  if (!['critical', 'high'].includes(evt.priority)) return;

  const cooldownKey = `_cooldown:${evt.event}`;
  const lastSent = await env.EVENTS.get(cooldownKey);
  if (lastSent && (Date.now() - parseInt(lastSent)) < 300000) return;

  const emoji = PRIORITY_EMOJI[evt.priority] || '';
  const label = EVENT_LABELS[evt.event] || evt.event.toUpperCase();
  const subject = `${emoji} [${label}] ${(evt.summary || '').substring(0, 120)}`;

  const lines = [
    `Priority: ${evt.priority.toUpperCase()}`,
    `Source: ${evt.event}`,
    `Time: ${evt.receivedAt || new Date().toISOString()}`,
    '', evt.summary || '', '',
  ];

  if (evt.application) {
    lines.push(`Name: ${evt.application.name}`, `Email: ${evt.application.email}`,
      `Years: ${evt.application.years_sweeping}`, `Tools: ${evt.application.current_tools}`);
  }
  if (evt.visitor) {
    if (evt.visitor.name) lines.push(`Visitor: ${evt.visitor.name}`);
    if (evt.visitor.city) lines.push(`City: ${evt.visitor.city}`);
  }
  if (evt.facebook) {
    if (evt.facebook.text) lines.push(`Message: ${evt.facebook.text}`);
    if (evt.facebook.senderId) lines.push(`Sender: ${evt.facebook.senderId}`);
  }

  lines.push('', '— SweepNspect Alert System (Cloudflare Edge)');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SweepNspect Alerts <alerts@sweepnspect.com>',
        to: [tawkEmail],
        subject, text: lines.join('\n'),
      }),
    });
    if (res.ok) {
      await env.EVENTS.put(cooldownKey, String(Date.now()), { expirationTtl: 600 });
      console.log(`[TAWK-NOTIFY] Sent: ${subject}`);
    } else {
      console.error(`[TAWK-NOTIFY] Failed (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[TAWK-NOTIFY] Error: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

async function getUnackedList(env) {
  const raw = await env.EVENTS.get('_unacked');
  return raw ? JSON.parse(raw) : [];
}

async function safeJson(request) {
  try { return await request.json(); }
  catch { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
