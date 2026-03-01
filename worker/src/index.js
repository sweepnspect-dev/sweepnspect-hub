/**
 * SweepNspect HQ Worker — Full API
 * GitHub Pages dashboard + Cloudflare Worker + KV
 *
 * Endpoints:
 *   Webhooks (public):
 *     POST /api/founding         — founding application
 *     GET  /api/founding         — list applications
 *     POST /api/webhooks/tawk    — Tawk.to webhook (deprecated)
 *     GET  /api/webhooks/facebook — FB verify
 *     POST /api/webhooks/facebook — FB events
 *
 *   Live Chat (public — visitors):
 *     POST /api/chat/start       — start chat session
 *     POST /api/chat/message     — visitor sends message
 *     GET  /api/chat/messages    — visitor polls for replies
 *
 *   Dashboard API (auth required):
 *     POST /api/chat/:id/reply   — agent/AI pushes reply to visitor
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

    // ── Static assets ─────────────────────────────────────
    if (path === '/chat-widget.js' && method === 'GET') return serveChatWidget();

    // ── Public webhook endpoints (no auth) ──────────────
    if (path === '/api/founding' && method === 'POST') return handleFoundingApplication(request, env);
    if (path === '/api/founding' && method === 'GET') return handleGetApplications(request, env);
    if (path === '/api/webhooks/tawk' && method === 'POST') return handleTawkWebhook(request, env);
    if (path === '/api/webhooks/facebook' && method === 'GET') return handleFacebookVerify(request, env);
    if (path === '/api/webhooks/facebook' && method === 'POST') return handleFacebookWebhook(request, env);
    if (path === '/api/webhooks/ticket' && method === 'POST') return handleWebhookTicket(request, env);
    if (path === '/health') return json({ status: 'ok', service: 'sweepnspect-hq', timestamp: Date.now() });

    // ── Live Chat (public — visitors use these) ──────────
    if (path === '/api/chat/start' && method === 'POST') return handleChatStart(request, env);
    if (path === '/api/chat/message' && method === 'POST') return handleChatMessage(request, env);
    if (path === '/api/chat/messages' && method === 'GET') return handleChatPoll(request, env);
    if (path === '/api/chat/dnd' && method === 'GET') return handleGetDnd(env);
    // Chat reply + DND toggle are auth-required — handled below

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

    // Live Chat (auth required — Hub pushes replies)
    if (path === '/api/chat/dnd' && method === 'POST') return handleSetDnd(request, env);
    if (path === '/api/chat/kb-sync' && method === 'POST') return handleKbSync(request, env);
    if (path.match(/^\/api\/chat\/[^/]+\/reply$/) && method === 'POST') return handleChatReply(request, env, path.split('/')[3]);
    if (path.match(/^\/api\/chat\/[^/]+\/ai-draft$/) && method === 'POST') return handleAiDraft(request, env, path.split('/')[3]);
    if (path.match(/^\/api\/chat\/session\/[^/]+\/mode$/) && method === 'POST') return handleSetMode(request, env, path.split('/')[4]);

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
// MARKETING — Cloudflare Web Analytics proxy + cached data
// ══════════════════════════════════════════════════════════════

async function handleGetMarketing(env) {
  // Check KV cache first (5-minute TTL)
  const cached = await env.EVENTS.get('marketing:_cache');
  if (cached) return json(JSON.parse(cached));

  // Try to fetch live analytics from CF GraphQL API
  const token = env.CF_ANALYTICS_TOKEN;
  const accountId = env.CF_ACCOUNT_ID;
  const siteTag = env.CF_ANALYTICS_SITE_TAG;

  let website = { daily: [], sources: [], topPages: [] };

  if (token && accountId && siteTag) {
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const dateGt = weekAgo.toISOString().split('T')[0];
      const dateLt = now.toISOString().split('T')[0];

      // Query pageloads by day + referrers + paths
      const query = `query {
        viewer {
          accounts(filter: { accountTag: "${accountId}" }) {
            daily: rumPageloadEventsAdaptiveGroups(
              filter: { AND: [
                { siteTag: "${siteTag}" },
                { date_gt: "${dateGt}" },
                { date_leq: "${dateLt}" }
              ]}
              limit: 10
              orderBy: [date_ASC]
            ) {
              count
              sum { visits }
              dimensions { date }
            }
            referrers: rumPageloadEventsAdaptiveGroups(
              filter: { AND: [
                { siteTag: "${siteTag}" },
                { date_gt: "${dateGt}" },
                { date_leq: "${dateLt}" }
              ]}
              limit: 10
              orderBy: [sum_visits_DESC]
            ) {
              count
              sum { visits }
              dimensions { refererHost }
            }
            paths: rumPageloadEventsAdaptiveGroups(
              filter: { AND: [
                { siteTag: "${siteTag}" },
                { date_gt: "${dateGt}" },
                { date_leq: "${dateLt}" }
              ]}
              limit: 10
              orderBy: [count_DESC]
            ) {
              count
              sum { visits }
              dimensions { requestPath }
            }
          }
        }
      }`;

      const gqlRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (gqlRes.ok) {
        const gql = await gqlRes.json();
        const acct = gql.data?.viewer?.accounts?.[0];

        if (acct) {
          // Daily pageviews + visitors
          website.daily = (acct.daily || []).map(d => ({
            date: d.dimensions.date,
            visitors: d.sum?.visits || 0,
            pageViews: d.count || 0,
            bounceRate: 0, // Web Analytics doesn't track bounce
          }));

          // Referrer sources
          const totalReferrerVisits = (acct.referrers || []).reduce((s, r) => s + (r.sum?.visits || 0), 0);
          website.sources = (acct.referrers || []).map(r => {
            const host = r.dimensions?.refererHost || 'Direct';
            const visits = r.sum?.visits || 0;
            return {
              source: host || 'Direct',
              visitors: visits,
              percent: totalReferrerVisits > 0 ? Math.round((visits / totalReferrerVisits) * 100) : 0,
            };
          });

          // Top pages
          website.topPages = (acct.paths || []).map(p => ({
            title: p.dimensions?.requestPath || '/',
            path: p.dimensions?.requestPath || '/',
            views: p.count || 0,
            avgTime: 0, // Not available in Web Analytics
          }));
        }
      }
    } catch (e) {
      // Analytics fetch failed — fall through to cached/empty data
    }
  }

  // Fallback: if GraphQL returned nothing, try static KV data
  if (website.daily.length === 0) {
    const raw = await env.EVENTS.get('marketing:_data');
    if (raw) return json(JSON.parse(raw));
  }

  const result = {
    website,
    app: { daily: [], overview: { appRating: 0, reviewCount: 0, dailyActive: 0 }, topScreens: [] },
    campaigns: [],
  };

  // Cache for 5 minutes
  await env.EVENTS.put('marketing:_cache', JSON.stringify(result), { expirationTtl: 300 });

  return json(result);
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
  return json({ configured: false, status: 'deprecated', note: 'Replaced by custom live chat' });
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
// LIVE CHAT — Custom Chat Relay
// ══════════════════════════════════════════════════════════════

async function handleChatStart(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const sessionId = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const session = {
    id: sessionId,
    visitor: {
      name: body.name || 'Visitor',
      email: body.email || '',
    },
    messages: [],
    status: 'active',
    mode: 'ai',
    startedAt: now,
    lastActivity: now,
  };

  await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 }); // 24h TTL

  // Queue event for Hub polling
  const evtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const evt = {
    id: evtId,
    event: 'livechat:start',
    receivedAt: now,
    summary: `Live chat started: ${session.visitor.name}`,
    priority: 'high',
    sessionId,
    visitor: session.visitor,
  };
  await env.EVENTS.put(evtId, JSON.stringify(evt), { expirationTtl: 2592000 });
  const unacked = await getUnackedList(env);
  unacked.push(evtId);
  await env.EVENTS.put('_unacked', JSON.stringify(unacked));

  console.log(`[CHAT] Session started: ${sessionId} — ${session.visitor.name}`);
  return json({ ok: true, sessionId });
}

async function handleChatMessage(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { sessionId, text } = body;
  if (!sessionId || !text) return json({ error: 'sessionId and text required' }, 400);

  const raw = await env.EVENTS.get(`chat:${sessionId}`);
  if (!raw) return json({ error: 'Session not found' }, 404);

  const session = JSON.parse(raw);
  if (session.status !== 'active') return json({ error: 'Session ended' }, 400);

  const now = new Date().toISOString();
  const msgId = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
  const message = { id: msgId, from: 'visitor', text, ts: now };

  session.messages.push(message);
  session.lastActivity = now;
  await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });

  // Queue event for Hub polling
  const evtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const evt = {
    id: evtId,
    event: 'livechat:message',
    receivedAt: now,
    summary: `Chat message from ${session.visitor.name}: ${text.substring(0, 80)}`,
    priority: 'normal',
    sessionId,
    message,
    visitor: session.visitor,
  };
  await env.EVENTS.put(evtId, JSON.stringify(evt), { expirationTtl: 2592000 });
  const unacked = await getUnackedList(env);
  unacked.push(evtId);
  await env.EVENTS.put('_unacked', JSON.stringify(unacked));

  // Transferring timeout stages: 1min → check in, 2min → take a message
  if (session.mode === 'transferring' && session.transferredAt) {
    const elapsed = Date.now() - new Date(session.transferredAt).getTime();
    if (elapsed > 120000) {
      console.log(`[AI] Transfer timeout (${Math.round(elapsed/1000)}s) — resuming as message-taker`);
      session.mode = 'ai';
      session.takeMessageMode = true;
      await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });
    } else if (elapsed > 60000 && !session.checkedIn) {
      console.log(`[AI] 1min check-in for ${sessionId}`);
      session.checkedIn = true;
      // Send a check-in message from AI
      const checkInMsg = {
        id: `m-${Date.now().toString(36)}-checkin`,
        from: 'ai',
        text: "J's still on the way — would you like to keep waiting, or can I take a message and have him reach out to you directly?",
        ts: now,
      };
      session.messages.push(checkInMsg);
      await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });
      // Queue event so Hub/widget see it
      const ciEvtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await env.EVENTS.put(ciEvtId, JSON.stringify({
        id: ciEvtId, event: 'livechat:message', receivedAt: now,
        summary: `AI check-in: asked if visitor wants to keep waiting`,
        priority: 'normal', sessionId, message: checkInMsg, visitor: session.visitor,
      }), { expirationTtl: 2592000 });
      const ciUnacked = await getUnackedList(env);
      ciUnacked.push(ciEvtId);
      await env.EVENTS.put('_unacked', JSON.stringify(ciUnacked));
    }
  }

  // Generate AI reply inline — skip when transferring (waiting for J) or agent has taken over
  if (env.ANTHROPIC_API_KEY && session.mode === 'ai') {
    await generateAiReply(env, sessionId, session);
  }

  return json({ ok: true, messageId: msgId });
}

// ── DND (Do Not Disturb) Mode ─────────────────────────────
async function handleGetDnd(env) {
  const raw = await env.EVENTS.get('chat:dnd');
  return json({ enabled: raw === 'true' });
}

async function handleSetDnd(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }
  const enabled = !!body.enabled;
  await env.EVENTS.put('chat:dnd', String(enabled));
  console.log(`[DND] Mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  return json({ ok: true, enabled });
}

const CHAT_SYSTEM_PROMPT = `You are SweepNspect's chat assistant on sweepnspect.com. You help chimney professionals learn about the app and answer their questions. You talk like a real person — direct, knowledgeable, no fluff. You understand the chimney trade because SweepNspect was built by someone who does this work.

RESPONSE FORMAT — NON-NEGOTIABLE:
- 1-3 sentences max. This is a phone chat bubble.
- Plain text only. NO markdown, NO bold, NO asterisks, NO bullets, NO emojis.
- Sound like a coworker texting back — direct, confident, not salesy.
- Only answer what was asked. Do NOT volunteer extra info unprompted.

WHAT SWEEPNSPECT IS:
Professional chimney inspection documentation app for Android. Built by a working sweep with 20 yrs experience. Zone-by-zone NFPA 211 workflow, branded PDF reports generated on-site, works fully offline. Scheduling, invoicing, customer management built in. Android only.

What it is NOT: not inspection training, not a safety determination tool, not a code compliance judge, not a generic field service app, not available on iPhone.

PRICING:
Trial: Free 14 days, up to 5 inspections, no credit card needed.
Solo: $49/mo — unlimited inspections, PDF reports, booking, scheduling, invoicing, offline-first, full data ownership.
Pro: $149/mo (coming soon) — everything in Solo plus customer portal, online booking, client report viewer, analytics, priority support.

FOUNDING 25:
25 working sweeps get Solo plan FREE FOR LIFE. Not a discount — completely free forever. In exchange: install the app, use it on a real inspection, give honest feedback. Also get: name in app credits, direct line to developer, first access to new features. Apply at sweepnspect.com/founding. Every application reviewed by hand.

KEY FEATURES:
9 inspection zones: Exterior, Attic, Appliance ID, Firebox, Smoke Chamber, Flue, Connector/Venting, Findings. Dynamic questions that adapt based on findings. Photo documentation and annotation per zone. PDF reports: professional, branded, NFPA 211 structure, emailed to customer from the field. Offline-first: every feature works without cell service, syncs when back online. Data stays on device, no vendor lock-in, export anytime.

DIFFERENTIATOR:
Built by a sweep, not a tech company. Chimney-specific NFPA 211 workflow, not a generic form builder. Offline-first by design. On-site PDF reports before leaving the job. Your data stays yours.

SUPPORT: Live chat (that's you), email contact@sweepnspect.com, Founding 25 members get direct line to developer.

WHEN YOU DON'T KNOW: Say "Good question — let me get J (our founder) to help with that one." Don't make things up.

HAND OFF TO FOUNDER: custom integrations, enterprise pricing, partnerships, detailed technical internals, anything not covered here.

NEVER DISCUSS: competitor pricing/features, specific future dates for features, legal/liability advice, code compliance determinations, anything outside SweepNspect.`;

async function generateAiReply(env, sessionId, session) {
  try {
    // Check DND mode
    const dndRaw = await env.EVENTS.get('chat:dnd');
    const dndEnabled = dndRaw === 'true';

    // Re-read session from KV to check if AI already replied (prevents duplicates)
    // Add a small delay to let any concurrent writes settle
    await new Promise(r => setTimeout(r, 500));
    const freshRaw = await env.EVENTS.get(`chat:${sessionId}`);
    if (!freshRaw) return;
    const freshSession = JSON.parse(freshRaw);
    const msgs = freshSession.messages;
    if (msgs.length === 0 || msgs[msgs.length - 1].from !== 'visitor') {
      console.log(`[AI] Skipping — last message is not from visitor (${msgs[msgs.length-1]?.from})`);
      return;
    }

    const chatHistory = freshSession.messages
      .slice(-10)
      .map(m => `${m.from === 'visitor' ? 'Visitor' : m.from === 'ai' ? 'AI' : 'Agent'}: ${m.text}`)
      .join('\n');

    const visitorName = session.visitor?.name || 'a visitor';

    // Check if session is in transferring mode — modify system prompt accordingly
    const sessionMode = freshSession.mode || 'ai';

    // Load learned KB entries to enhance AI knowledge
    let learnedKbSection = '';
    try {
      const kbRaw = await env.EVENTS.get('kb:learned');
      if (kbRaw) {
        const kbEntries = JSON.parse(kbRaw);
        if (kbEntries.length > 0) {
          learnedKbSection = '\n\nLEARNED FROM PREVIOUS CONVERSATIONS:\n' +
            kbEntries.map(e => `- ${e.text}`).join('\n');
        }
      }
    } catch {}

    // When DND is on or J didn't respond in time, take a message instead of deferring
    let systemPrompt = CHAT_SYSTEM_PROMPT + learnedKbSection + `\n\nYou are chatting with ${visitorName}.`;

    if (freshSession.takeMessageMode) {
      systemPrompt += `\n\nIMPORTANT — TAKE A MESSAGE MODE:
J was notified but hasn't joined yet. Do NOT say "let me get J" or try to transfer again.
Instead, apologize for the wait and offer to take a message: "Sorry about the wait! J's tied up at the moment — can I grab your name and best number so he can get back to you personally?"
If they already gave contact info, say: "Got it, I'll make sure J sees this and reaches out. Anything else I can help with in the meantime?"
Continue answering knowledgebase questions normally.`;
    } else if (dndEnabled) {
      systemPrompt += `\n\nIMPORTANT — DND MODE IS ON (founder is offline):
When you don't know the answer or would normally hand off to J, DO NOT say "let me get J" or anything about connecting with the founder.
Instead say something like: "Great question — J will want to get back to you on that personally. Can I grab your name and best number so he can reach out?"
If they already gave contact info, say: "Got it, I'll make sure J sees your question and gets back to you."
Continue answering knowledgebase questions normally.`;
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: 'user', content: `CONVERSATION SO FAR:\n${chatHistory}\n\nReply to the visitor's last message:` }],
      }),
    });

    if (!resp.ok) {
      console.log(`[AI] Anthropic error: ${resp.status} ${await resp.text()}`);
      return;
    }

    const result = await resp.json();
    let aiText = result.content?.[0]?.text;
    if (!aiText) return;
    // Strip any markdown bold/italic that Sonnet likes to add
    aiText = aiText.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_/g, ' ').replace(/  +/g, ' ').trim();

    // Save AI reply to session
    const now = new Date().toISOString();
    const aiMsg = {
      id: `m-${Date.now().toString(36)}-ai`,
      from: 'ai',
      text: aiText,
      ts: now,
    };

    // Re-read session (may have changed)
    const raw = await env.EVENTS.get(`chat:${sessionId}`);
    if (!raw) return;
    const fresh = JSON.parse(raw);
    fresh.messages.push(aiMsg);
    fresh.lastActivity = now;
    await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(fresh), { expirationTtl: 86400 });

    // Queue event so Hub sees the AI reply
    const evtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const evt = {
      id: evtId,
      event: 'livechat:message',
      receivedAt: now,
      summary: `AI replied to ${visitorName}: ${aiText.substring(0, 80)}`,
      priority: 'normal',
      sessionId,
      message: aiMsg,
      visitor: session.visitor,
    };
    await env.EVENTS.put(evtId, JSON.stringify(evt), { expirationTtl: 2592000 });
    const unacked = await getUnackedList(env);
    unacked.push(evtId);
    await env.EVENTS.put('_unacked', JSON.stringify(unacked));

    console.log(`[AI] Auto-replied to ${sessionId}: ${aiText.substring(0, 60)}`);

    // Detect AI deferring to founder — queue urgent notification (only when DND is OFF)
    const deferPhrases = ['let me get j', 'get j (our founder)', 'connect you with j', 'grab j'];
    const takeMessagePhrases = ['can i grab your name', 'grab your name', 'best number', 'reach out', 'gets back to you', 'j sees your question'];
    const isDefer = deferPhrases.some(p => aiText.toLowerCase().includes(p));
    const isTakeMessage = takeMessagePhrases.some(p => aiText.toLowerCase().includes(p));

    if (isDefer && !dndEnabled) {
      // Normal mode: notify J immediately + set mode to transferring
      fresh.mode = 'transferring';
      fresh.transferredAt = now;
      await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(fresh), { expirationTtl: 86400 });

      const deferEvtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const lastVisitorMsg = fresh.messages.filter(m => m.from === 'visitor').pop();
      const deferEvt = {
        id: deferEvtId,
        event: 'livechat:defer',
        receivedAt: now,
        summary: `AI deferred to founder — ${visitorName} asked: "${(lastVisitorMsg?.text || '').substring(0, 80)}"`,
        priority: 'high',
        sessionId,
        visitor: session.visitor,
        question: lastVisitorMsg?.text || '',
      };
      await env.EVENTS.put(deferEvtId, JSON.stringify(deferEvt), { expirationTtl: 2592000 });
      const deferUnacked = await getUnackedList(env);
      deferUnacked.push(deferEvtId);
      await env.EVENTS.put('_unacked', JSON.stringify(deferUnacked));
      console.log(`[AI] DEFER — ${visitorName} needs founder for: ${lastVisitorMsg?.text?.substring(0, 60)}`);
    } else if (isTakeMessage && dndEnabled) {
      // DND mode: store the message quietly (normal priority, no phone ping)
      const dndEvtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const lastVisitorMsg = fresh.messages.filter(m => m.from === 'visitor').pop();
      const dndEvt = {
        id: dndEvtId,
        event: 'livechat:dnd-message',
        receivedAt: now,
        summary: `[DND] AI took message from ${visitorName}: "${(lastVisitorMsg?.text || '').substring(0, 80)}"`,
        priority: 'normal',
        sessionId,
        visitor: session.visitor,
        question: lastVisitorMsg?.text || '',
      };
      await env.EVENTS.put(dndEvtId, JSON.stringify(dndEvt), { expirationTtl: 2592000 });
      const dndUnacked = await getUnackedList(env);
      dndUnacked.push(dndEvtId);
      await env.EVENTS.put('_unacked', JSON.stringify(dndUnacked));
      console.log(`[AI] DND — took message from ${visitorName}: ${lastVisitorMsg?.text?.substring(0, 60)}`);
    }
  } catch (err) {
    console.log(`[AI] Auto-reply error: ${err.message}`);
  }
}

async function handleChatPoll(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  const after = url.searchParams.get('after') || '1970-01-01T00:00:00.000Z';

  if (!sessionId) return json({ error: 'session param required' }, 400);

  const raw = await env.EVENTS.get(`chat:${sessionId}`);
  if (!raw) return json({ error: 'Session not found' }, 404);

  const session = JSON.parse(raw);
  const newMessages = session.messages.filter(m => m.ts > after);

  return json({
    sessionId,
    status: session.status,
    mode: session.mode || 'ai',
    messages: newMessages,
    visitor: session.visitor,
  });
}

async function handleChatReply(request, env, sessionId) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { text, from } = body;
  if (!text) return json({ error: 'text required' }, 400);

  const raw = await env.EVENTS.get(`chat:${sessionId}`);
  if (!raw) return json({ error: 'Session not found' }, 404);

  const session = JSON.parse(raw);
  const now = new Date().toISOString();

  // Handoff: first agent reply transitions mode to 'agent'
  const isAgent = (from || 'agent') === 'agent';
  if (isAgent && session.mode !== 'agent') {
    // Inject handoff message from AI before J's reply
    const handoffMsg = {
      id: `m-${Date.now().toString(36)}-handoff`,
      from: 'ai',
      text: "Here he is now — you're in good hands!",
      ts: now,
    };
    session.messages.push(handoffMsg);
    session.mode = 'agent';
  }

  const msgId = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
  const message = { id: msgId, from: from || 'agent', text, ts: now };

  session.messages.push(message);
  session.lastActivity = now;
  await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });

  // Queue note extraction in background (survives after response is sent)
  if (isAgent && session.mode === 'agent' && env.ANTHROPIC_API_KEY) {
    console.log(`[AI-NOTES] Starting extraction for ${sessionId} (waitUntil: ${!!env.waitUntil})`);
    if (env.waitUntil) {
      env.waitUntil(extractAgentNotes(env, sessionId, session));
    } else {
      await extractAgentNotes(env, sessionId, session);
    }
  }

  return json({ ok: true, messageId: msgId });
}

// ── AI Draft — Hub requests an AI reply on J's behalf ──
async function handleAiDraft(request, env, sessionId) {
  const raw = await env.EVENTS.get(`chat:${sessionId}`);
  if (!raw) return json({ error: 'Session not found' }, 404);

  const session = JSON.parse(raw);
  let body = {};
  try { body = await request.json(); } catch {}

  // Temporarily force AI mode to generate a reply
  const prevMode = session.mode;
  session.mode = 'ai';

  // If J provided context, inject it as a system hint
  if (body.context) {
    const contextMsg = { id: `m-${Date.now().toString(36)}-ctx`, from: 'system', text: body.context, ts: new Date().toISOString() };
    session.messages.push(contextMsg);
  }

  await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });
  await generateAiReply(env, sessionId, session);

  // Read back to get the AI message that was appended
  const updatedRaw = await env.EVENTS.get(`chat:${sessionId}`);
  const updated = JSON.parse(updatedRaw);
  const aiMsg = updated.messages.filter(m => m.from === 'ai').pop();

  // Restore previous mode
  updated.mode = prevMode;
  await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(updated), { expirationTtl: 86400 });

  return json({ ok: true, message: aiMsg });
}

// ── Set Session Mode (Hub pushes mode changes, e.g. decline → back to 'ai') ──
async function handleSetMode(request, env, sessionId) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { mode } = body;
  if (!['ai', 'transferring', 'agent'].includes(mode)) return json({ error: 'Invalid mode' }, 400);

  const raw = await env.EVENTS.get(`chat:${sessionId}`);
  if (!raw) return json({ error: 'Session not found' }, 404);

  const session = JSON.parse(raw);
  session.mode = mode;
  await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });

  console.log(`[MODE] Session ${sessionId} mode set to '${mode}'`);
  return json({ ok: true, mode });
}

// ── AI Note-Taking — extracts learnable info from agent replies ──
async function extractAgentNotes(env, sessionId, session) {
  try {
    const chatHistory = session.messages
      .slice(-15)
      .map(m => `${m.from === 'visitor' ? 'Visitor' : m.from === 'ai' ? 'AI' : 'Agent (J)'}: ${m.text}`)
      .join('\n');

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: `You analyze customer support conversations. The agent (J) just responded. Extract NEW information that should be added to a knowledgebase for an AI chat assistant about SweepNspect (a chimney inspection app).

Look for:
- New product details, pricing changes, feature info the agent shared
- Corrections to what the AI previously said
- Common questions that the AI should handle next time instead of deferring

Return ONLY valid JSON with no markdown formatting, no code blocks, no explanation — just raw JSON:
{ "notes": [{ "type": "new_info", "text": "...", "confidence": 0.8 }] }
Type must be one of: "new_info", "correction", "faq". Max 3 notes. Keep text under 100 chars.
If nothing new, return: { "notes": [] }`,
        messages: [{ role: 'user', content: `CONVERSATION:\n${chatHistory}\n\nExtract any new learnable information from the agent's responses:` }],
      }),
    });

    if (!resp.ok) {
      console.log(`[AI-NOTES] Anthropic error: ${resp.status} ${await resp.text()}`);
      return;
    }
    const result = await resp.json();
    const content = result.content?.[0]?.text;
    if (!content) { console.log('[AI-NOTES] No content in response'); return; }

    console.log(`[AI-NOTES] Raw response: ${content.substring(0, 300)}`);

    // Strip markdown code blocks and extract JSON object
    let jsonStr = content.trim();
    // Remove code fences
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/g, '').replace(/\n?```\s*$/g, '').trim();
    // If there's trailing text after the JSON, extract just the JSON object
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (e) {
      console.log(`[AI-NOTES] JSON parse failed: ${e.message} — input: ${jsonStr.substring(0, 200)}`);
      return;
    }
    if (!parsed.notes || parsed.notes.length === 0) { console.log('[AI-NOTES] No notes extracted'); return; }

    // Store notes on the session
    const freshRaw = await env.EVENTS.get(`chat:${sessionId}`);
    if (!freshRaw) return;
    const fresh = JSON.parse(freshRaw);
    if (!fresh.agentNotes) fresh.agentNotes = [];
    for (const note of parsed.notes) {
      note.id = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
      note.status = 'pending';
      note.extractedAt = new Date().toISOString();
      fresh.agentNotes.push(note);
    }
    await env.EVENTS.put(`chat:${sessionId}`, JSON.stringify(fresh), { expirationTtl: 86400 });

    // Queue event so Hub gets the notes
    const noteEvtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const noteEvt = {
      id: noteEvtId,
      event: 'livechat:notes',
      receivedAt: new Date().toISOString(),
      summary: `AI extracted ${parsed.notes.length} notes from agent conversation`,
      priority: 'normal',
      sessionId,
      notes: parsed.notes,
    };
    await env.EVENTS.put(noteEvtId, JSON.stringify(noteEvt), { expirationTtl: 2592000 });
    const unacked = await getUnackedList(env);
    unacked.push(noteEvtId);
    await env.EVENTS.put('_unacked', JSON.stringify(unacked));

    console.log(`[AI-NOTES] Extracted ${parsed.notes.length} notes from session ${sessionId}`);
  } catch (err) {
    console.log(`[AI-NOTES] Error: ${err.message}`);
  }
}

// ── KB Sync — Hub pushes approved learned entries ──
async function handleKbSync(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const entries = body.entries || [];
  await env.EVENTS.put('kb:learned', JSON.stringify(entries));
  console.log(`[KB] Synced ${entries.length} learned entries`);
  return json({ ok: true, count: entries.length });
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
// CHAT WIDGET (served as static JS)
// ══════════════════════════════════════════════════════════════

function serveChatWidget() {
  // Serve the readable source file directly from the Hub or fall back to inline
  // For now, redirect to the readable file served by the Hub
  // This avoids hand-minification drift — the worker just proxies the source
  const JS = `(function(){'use strict';var W='https://sweepnspect-webhook.sweepnspect.workers.dev',P=4000,s={open:false,phase:'intro',sid:null,v:{name:'',email:''},msgs:[],lastTs:'1970-01-01T00:00:00.000Z',pt:null,sending:false};function inj(){var st=document.createElement('style');st.textContent='#snsp-chat-bubble{position:fixed;bottom:20px;right:20px;z-index:99999;width:60px;height:60px;border-radius:50%;background:#ea580c;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(234,88,12,0.45);transition:transform .2s,box-shadow .2s,background .2s}#snsp-chat-bubble:hover{transform:scale(1.08);background:#c2410c;box-shadow:0 6px 28px rgba(234,88,12,0.55)}#snsp-chat-bubble .badge{position:absolute;top:-4px;right:-4px;background:#dc2626;color:#fff;font-size:11px;width:20px;height:20px;border-radius:50%;display:none;align-items:center;justify-content:center}#snsp-chat-window{position:fixed;bottom:92px;right:20px;z-index:99998;width:310px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:linear-gradient(165deg,#28282e 0%,#1a1a1e 12%,#101012 35%,#0c0c0e 65%,#141416 88%,#222226 100%);border-radius:40px;padding:6px;border:3px solid;border-color:#606068 #48484e #2a2a30 #48484e;box-shadow:-12px 16px 45px rgba(0,0,0,0.6),0 8px 30px rgba(0,0,0,0.4),0 0 0 1px rgba(140,140,150,0.2),inset 2px 2px 0 rgba(255,255,255,0.12),inset 0 2px 6px rgba(255,255,255,0.06),inset -2px -2px 0 rgba(0,0,0,0.6),inset 0 -3px 8px rgba(0,0,0,0.3);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}#snsp-chat-window.open{display:flex}#snsp-chat-window::before{content:\\'\\';position:absolute;right:-5px;top:100px;width:3px;height:40px;background:linear-gradient(180deg,#5a5a62 0%,#3c3c42 40%,#3c3c42 60%,#5a5a62 100%);border-radius:0 3px 3px 0;box-shadow:1px 0 3px rgba(0,0,0,0.5)}#snsp-chat-window::after{content:\\'\\';position:absolute;left:-5px;top:80px;width:3px;height:28px;background:linear-gradient(180deg,#5a5a62 0%,#3c3c42 40%,#3c3c42 60%,#5a5a62 100%);border-radius:3px 0 0 3px;box-shadow:-1px 0 3px rgba(0,0,0,0.5)}.snsp-screen{flex:1;display:flex;flex-direction:column;background:#1e3a5f;border-radius:34px;overflow:hidden;position:relative}.snsp-camera{width:10px;height:10px;background:#06060a;border-radius:50%;position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:10;border:1.5px solid #1c1c22;box-shadow:inset 0 1px 3px rgba(0,0,0,0.9),0 0 3px rgba(0,0,0,0.4)}.snsp-statusbar{display:flex;align-items:center;justify-content:space-between;padding:8px 20px 2px;font-size:10px;color:#cbd5e1;background:#1e3a5f;min-height:26px}.snsp-statusbar-time{font-weight:600;color:#fff}.snsp-statusbar-icons{display:flex;gap:4px;align-items:center}.snsp-statusbar-icons svg{opacity:.8}.snsp-header{background:#1e3a5f;padding:8px 14px 12px;display:flex;align-items:center;justify-content:space-between}.snsp-header-left{display:flex;align-items:center;gap:8px}.snsp-header-logo{height:24px;width:auto;display:block}.snsp-header-title{font-weight:600;font-size:14px;color:#fff;display:flex;align-items:center;gap:6px}.snsp-header-title .dot{width:7px;height:7px;border-radius:50%;background:#4ade80}.snsp-close{background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;padding:2px 6px;border-radius:6px;line-height:1}.snsp-close:hover{color:#fff;background:rgba(255,255,255,.1)}.snsp-body{flex:1;overflow-y:auto;padding:12px 10px;display:flex;flex-direction:column;gap:8px;background:#eaeff4;color:#0f172a}.snsp-home{display:flex;flex-direction:column;gap:10px;justify-content:center;flex:1;padding:0 4px}.snsp-home h3{margin:0;font-size:16px;color:#1e293b}.snsp-home p{margin:0;font-size:13px;color:#64748b;line-height:1.4}.snsp-menu-card{background:#fff;border:1px solid #cbd5e1;border-radius:14px;padding:14px 16px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04)}.snsp-menu-card:hover{border-color:#ea580c;box-shadow:0 2px 8px rgba(234,88,12,0.12)}.snsp-menu-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.snsp-menu-icon.kb{background:#eef2ff}.snsp-menu-icon.chat{background:#fff7ed}.snsp-menu-label{font-size:14px;font-weight:600;color:#1e293b}.snsp-menu-desc{font-size:11px;color:#64748b;margin-top:2px}.snsp-contact{display:flex;flex-direction:column;gap:10px;justify-content:center;flex:1;padding:0 4px}.snsp-contact h3{margin:0;font-size:16px;color:#1e293b}.snsp-contact p{margin:0;font-size:13px;color:#64748b;line-height:1.4}.snsp-contact input{background:#fff;border:1px solid #cbd5e1;color:#1e293b;padding:11px 14px;border-radius:12px;font-size:14px;outline:none;width:100%;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,0.04)}.snsp-contact input:focus{border-color:#ea580c;box-shadow:0 0 0 2px rgba(234,88,12,0.15)}.snsp-contact input::placeholder{color:#94a3b8}.snsp-start-btn{background:#ea580c;color:#fff;border:none;padding:12px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;transition:background .2s;box-shadow:0 2px 8px rgba(234,88,12,0.25)}.snsp-start-btn:hover{background:#c2410c}.snsp-start-btn:disabled{opacity:.5;cursor:not-allowed}.snsp-back-link{background:none;border:none;color:#64748b;font-size:12px;cursor:pointer;padding:4px 0;text-align:left}.snsp-back-link:hover{color:#ea580c}.snsp-kb{display:flex;flex-direction:column;gap:8px;padding:0 2px}.snsp-kb-item{background:#fff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)}.snsp-kb-q{padding:10px 14px;font-size:13px;font-weight:600;color:#1e293b;cursor:pointer;display:flex;justify-content:space-between;align-items:center}.snsp-kb-q:hover{color:#ea580c}.snsp-kb-q .chevron{font-size:11px;color:#94a3b8;transition:transform .2s}.snsp-kb-q.open .chevron{transform:rotate(90deg)}.snsp-kb-a{padding:0 14px 12px;font-size:12px;color:#475569;line-height:1.5;display:none}.snsp-kb-a.open{display:block}.snsp-input-spacer{height:52px;background:#1e3a5f}.snsp-msg{max-width:82%;padding:10px 14px;font-size:13px;line-height:1.5;word-wrap:break-word}.snsp-msg-visitor{align-self:flex-end;background:#ea580c;color:#fff;border-radius:16px 16px 4px 16px;box-shadow:0 1px 4px rgba(234,88,12,0.2)}.snsp-msg-agent,.snsp-msg-ai{align-self:flex-start;background:#fff;color:#1e293b;border-radius:16px 16px 16px 4px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}.snsp-input-area{padding:8px 10px;background:#1e3a5f;display:flex;gap:8px;align-items:center}.snsp-input-area input{flex:1;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);color:#fff;padding:9px 14px;border-radius:20px;font-size:13px;outline:none}.snsp-input-area input:focus{border-color:#ea580c;background:rgba(255,255,255,0.18)}.snsp-input-area input::placeholder{color:rgba(255,255,255,0.5)}.snsp-send-btn{background:#ea580c;border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;flex-shrink:0;box-shadow:0 2px 6px rgba(234,88,12,0.3)}.snsp-send-btn:hover{background:#c2410c}.snsp-send-btn:disabled{opacity:.4;cursor:not-allowed}.snsp-footer{background:#1e3a5f;text-align:center;padding:4px 0 2px;font-size:9px;color:rgba(255,255,255,0.35)}.snsp-footer a{color:rgba(255,255,255,0.5);text-decoration:none}.snsp-footer a:hover{color:rgba(255,255,255,0.7)}.snsp-homebar{display:flex;justify-content:center;padding:4px 0 8px;background:#1e3a5f}.snsp-homebar-pill{width:90px;height:4px;border-radius:2px;background:rgba(255,255,255,0.2)}.snsp-faq-tiles{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0}.snsp-faq-tile{background:#fff;color:#334155;border:1px solid #cbd5e1;padding:7px 12px;border-radius:20px;font-size:11px;cursor:pointer;transition:all .15s;line-height:1.3;box-shadow:0 1px 3px rgba(0,0,0,0.04)}.snsp-faq-tile:hover{background:#f1f5f9;border-color:#ea580c;color:#ea580c}@media(max-width:500px){#snsp-chat-window{width:100vw;max-width:100vw;height:100vh;max-height:100vh;bottom:0;right:0;border-radius:0;padding:0;border:none;box-shadow:none;background:#1e3a5f;z-index:100000}#snsp-chat-window::before,#snsp-chat-window::after{display:none}.snsp-screen{border-radius:0}.snsp-camera{display:none}.snsp-statusbar{padding-top:12px}.snsp-header{padding:10px 16px 14px}.snsp-header-logo{height:28px}.snsp-header-title{font-size:16px}.snsp-body{padding:14px 14px;font-size:15px}.snsp-home h3{font-size:19px}.snsp-home p{font-size:15px}.snsp-menu-label{font-size:16px}.snsp-menu-desc{font-size:13px}.snsp-menu-card{padding:16px 18px}.snsp-menu-icon{width:42px;height:42px}.snsp-contact h3{font-size:19px}.snsp-contact p{font-size:15px}.snsp-contact input{font-size:16px;padding:13px 16px}.snsp-start-btn{font-size:16px;padding:14px}.snsp-back-link{font-size:14px}.snsp-kb-q{font-size:15px;padding:12px 16px}.snsp-kb-a{font-size:14px;padding:0 16px 14px}.snsp-msg{font-size:15px;padding:12px 16px;max-width:85%}.snsp-input-area{padding:10px 14px}.snsp-input-area input{font-size:15px;padding:11px 16px}.snsp-send-btn{width:40px;height:40px}.snsp-faq-tile{font-size:13px;padding:9px 14px}.snsp-footer{font-size:10px;padding:6px 0 3px}.snsp-homebar{padding:6px 0 10px}}';document.head.appendChild(st)}function esc(t){var d=document.createElement('div');d.textContent=t||'';return d.innerHTML}function create(){var b=document.createElement('div');b.id='snsp-chat-bubble';b.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.837 1.37 5.378 3.527 7.09L4 22l4.322-2.16C9.478 20.27 10.707 20.486 12 20.486c5.523 0 10-4.145 10-9.243S17.523 2 12 2z"/></svg><span class="badge" id="snspBadge">0</span>';b.onclick=function(){var w=document.getElementById('snsp-chat-window');s.open=!w.classList.contains('open');w.classList.toggle('open',s.open)};document.body.appendChild(b);var w=document.createElement('div');w.id='snsp-chat-window';w.innerHTML='<div class="snsp-screen"><div class="snsp-camera"></div><div class="snsp-statusbar"><span class="snsp-statusbar-time">9:41</span><span class="snsp-statusbar-icons"><svg width="12" height="12" fill="#cbd5e1" viewBox="0 0 24 24"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 00-6 0zm-4-4l2 2a7.074 7.074 0 0110 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg><svg width="12" height="12" fill="#cbd5e1" viewBox="0 0 24 24"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg></span></div><div class="snsp-header"><div class="snsp-header-left"><img src="https://sweepnspect.com/images/sweepnspect-logo-TransBG.png" alt="" class="snsp-header-logo"><div class="snsp-header-title"><span class="dot"></span> Live Chat</div></div><button class="snsp-close" onclick="document.getElementById(\\'snsp-chat-window\\').classList.remove(\\'open\\')">&times;</button></div><div class="snsp-body" id="snspBody"></div><div id="snspInputWrap"></div><div class="snsp-footer">Powered by <a href="https://sweepnspect.com" target="_blank">SweepNspect</a></div><div class="snsp-homebar"><div class="snsp-homebar-pill"></div></div></div>';document.body.appendChild(w);homeUI()}var KB=[{q:'How much does it cost?',a:'Solo plan: $49/mo (1 device, unlimited inspections, PDF reports). Pro plan: $149/mo (up to 5 devices + team management). 14-day free trial, no credit card required.'},{q:'What is the Founding 25?',a:'The first 25 paying users get the Solo plan at $29/mo locked for life, plus priority support, a direct line to the founder, and their name on the Founding Members page.'},{q:'Does it work offline?',a:'Yes! Full offline capability \\u2014 inspect, photograph, and generate PDF reports without cell signal. Everything syncs automatically when you\\u2019re back online.'},{q:'What devices are supported?',a:'Android phones and tablets. Minimum Android 8.0. No iOS at this time.'},{q:'How do PDF reports work?',a:'NFPA 211 zone-by-zone reports are generated on-site, branded with your company logo, and can be emailed directly to the customer.'},{q:'Is my data safe?',a:'All inspection data stays on your device. No cloud storage of your data \\u2014 you own it completely. Syncs only when you choose to.'}];function spc(){document.getElementById('snspInputWrap').innerHTML='<div class="snsp-input-spacer"></div>'}function homeUI(){spc();document.getElementById('snspBody').innerHTML='<div class="snsp-home"><h3>Hi there! \\u{1F44B}</h3><p>Have a question about SweepNspect? We\\u2019re here to help.</p><div class="snsp-menu-card" onclick="window._snspShowKB()"><div class="snsp-menu-icon kb"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg></div><div><div class="snsp-menu-label">Browse FAQ</div><div class="snsp-menu-desc">Pricing, features, and more</div></div></div><div class="snsp-menu-card" onclick="window._snspShowContact()"><div class="snsp-menu-icon chat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div><div><div class="snsp-menu-label">Chat with us</div><div class="snsp-menu-desc">Talk to our team or AI assistant</div></div></div></div>'}window._snspShowKB=function(){spc();document.getElementById('snspBody').innerHTML='<button class="snsp-back-link" onclick="window._snspGoHome()">\\u2190 Back</button><div class="snsp-kb" id="snspKB"></div>';var kb=document.getElementById('snspKB');KB.forEach(function(item,i){var div=document.createElement('div');div.className='snsp-kb-item';div.innerHTML='<div class="snsp-kb-q" data-i="'+i+'">'+esc(item.q)+'<span class="chevron">\\u203A</span></div><div class="snsp-kb-a">'+esc(item.a)+'</div>';div.querySelector('.snsp-kb-q').onclick=function(){this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')};kb.appendChild(div)})};window._snspShowContact=function(){spc();document.getElementById('snspBody').innerHTML='<div class="snsp-contact"><button class="snsp-back-link" onclick="window._snspGoHome()">\\u2190 Back</button><h3>Start a conversation</h3><p>Enter your name to chat with our team.</p><input type="text" id="snspName" placeholder="Your name"><input type="email" id="snspEmail" placeholder="Email (optional)"><button class="snsp-start-btn" id="snspStartBtn" onclick="window._snspStart()">Start Chat</button></div>'};window._snspGoHome=function(){homeUI()};window._snspStart=async function(){var n=document.getElementById('snspName'),b=document.getElementById('snspStartBtn');var name=(n.value||'').trim();if(!name){n.style.borderColor='#ea580c';n.focus();return}s.v.name=name;s.v.email=(document.getElementById('snspEmail').value||'').trim();b.disabled=true;b.textContent='Connecting...';try{var r=await post('/api/chat/start',{name:s.v.name,email:s.v.email});if(r.ok&&r.sessionId){s.sid=r.sessionId;s.phase='chat';chatUI();startPoll()}else{b.textContent='Error - retry';b.disabled=false}}catch(x){b.textContent='Connection failed - retry';b.disabled=false}};function chatUI(){document.getElementById('snspBody').innerHTML='<div id="snspMessages" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-bottom:4px"></div>';document.getElementById('snspInputWrap').innerHTML='<div class="snsp-input-area"><input type="text" id="snspInput" placeholder="Message..." onkeydown="if(event.key===\\'Enter\\')window._snspSend()"><button class="snsp-send-btn" onclick="window._snspSend()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>';addMsg('agent','Hi '+esc(s.v.name)+'! How can we help you today?');showFaq();document.getElementById('snspInput').focus()}function showFaq(){var ms=document.getElementById('snspMessages');if(!ms)return;var t=document.createElement('div');t.className='snsp-faq-tiles';t.id='snspFaqTiles';['How much does it cost?','What is the Founding 25?','Does it work offline?','What devices supported?'].forEach(function(q){var ti=document.createElement('span');ti.className='snsp-faq-tile';ti.textContent=q;ti.onclick=function(){var inp=document.getElementById('snspInput');if(inp)inp.value=q;window._snspSend()};t.appendChild(ti)});ms.appendChild(t)}window._snspSend=async function(){var i=document.getElementById('snspInput');if(!i||s.sending)return;var t=i.value.trim();if(!t)return;i.value='';s.sending=true;addMsg('visitor',t);try{await post('/api/chat/message',{sessionId:s.sid,text:t})}catch(x){}s.sending=false;i.focus()};function addMsg(f,t){s.msgs.push({from:f,text:t,ts:new Date().toISOString()});renderMsgs()}function renderMsgs(){var el=document.getElementById('snspMessages');if(!el)return;el.innerHTML=s.msgs.map(function(m){var c=m.from==='visitor'?'snsp-msg-visitor':m.from==='ai'?'snsp-msg-ai':'snsp-msg-agent';var l=m.from==='visitor'?'':m.from==='ai'?'<div style="font-size:10px;color:#94a3b8;margin-bottom:2px">AI Assistant</div>':'<div style="font-size:10px;color:#94a3b8;margin-bottom:2px">Support</div>';return'<div class="snsp-msg '+c+'">'+l+esc(m.text)+'</div>'}).join('');var bs=el.querySelectorAll('.snsp-msg');if(bs.length>0)bs[bs.length-1].scrollIntoView({behavior:'smooth',block:'start'})}function startPoll(){if(s.pt)return;s.pt=setInterval(poll,P)}async function poll(){if(!s.sid)return;try{var d=await get('/api/chat/messages?session='+s.sid+'&after='+encodeURIComponent(s.lastTs));if(d.messages&&d.messages.length>0){for(var i=0;i<d.messages.length;i++){var m=d.messages[i];if(m.from==='visitor'){if(m.ts>s.lastTs)s.lastTs=m.ts;continue}if(!s.msgs.find(function(x){return x.id===m.id}))s.msgs.push(m);if(m.ts>s.lastTs)s.lastTs=m.ts}renderMsgs()}if(d.status==='ended'){clearInterval(s.pt);s.pt=null;addMsg('agent','Chat ended. Thanks for reaching out!')}}catch(x){}}async function post(p,b){var r=await fetch(W+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json()}async function get(p){var r=await fetch(W+p);return r.json()}function init(){inj();create()}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init()})();`;

  return new Response(JS, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  });
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
