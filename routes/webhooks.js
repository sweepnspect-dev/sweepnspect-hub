const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('tickets.json'); }
function subStore(req) { return req.app.locals.jsonStore('subscribers.json'); }
function broadcast(req, msg) { req.app.locals.broadcast(msg); }

// ── Signup Webhook — Website → Subscriber Pipeline ──────
router.post('/signup', (req, res) => {
  const { name, email, phone, plan, source } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const s = subStore(req);
  const subs = s.read();
  const alertRouter = req.app.locals.alertRouter;

  // Dedupe by email
  const existing = subs.find(sub => (sub.email || '').toLowerCase() === email.toLowerCase());
  if (existing) {
    // Update fields if provided
    if (name && !existing.name) existing.name = name;
    if (phone && !existing.phone) existing.phone = phone;
    if (plan && existing.status === 'lead') {
      existing.status = 'trial';
      existing.plan = plan;
      existing.trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString();
    }
    s.write(subs);
    broadcast(req, { type: 'subscriber:updated', data: existing });
    return res.json({ ok: true, action: 'updated', subscriber: existing });
  }

  // New subscriber
  const now = new Date().toISOString();
  const sub = {
    id: s.nextId('s'),
    name: name || '',
    email: email.toLowerCase(),
    phone: phone || '',
    plan: plan || 'trial',
    mrr: 0,
    status: 'trial',
    source: source || 'website',
    startDate: now,
    trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
  };

  subs.push(sub);
  s.write(subs);

  broadcast(req, { type: 'subscriber:new', data: sub });
  broadcast(req, { type: 'activity', data: { icon: 'subscriber', text: `New signup: ${sub.name || sub.email} (${sub.plan})`, time: now } });

  if (alertRouter) {
    alertRouter.send('subscriber-signup', 'medium',
      `New signup: ${sub.name || sub.email} — ${sub.plan} plan`,
      { subscriberId: sub.id, email: sub.email }
    );
  }

  res.status(201).json({ ok: true, action: 'created', subscriber: sub });
});

// ── Feedback Webhook — In-App → Ticket ──────────────────
router.post('/feedback', (req, res) => {
  const { email, category, subject, description, appVersion, deviceInfo } = req.body;
  if (!subject && !description) return res.status(400).json({ error: 'subject or description required' });

  const s = store(req);
  const tickets = s.read();
  const alertRouter = req.app.locals.alertRouter;

  // Auto-detect category from keywords if not provided
  let cat = category || 'support';
  if (!category) {
    const text = ((subject || '') + ' ' + (description || '')).toLowerCase();
    if (/\b(bug|broken|crash|error|fail|wrong|doesn.t work)\b/.test(text)) cat = 'bug';
    else if (/\b(feature|request|wish|add|would be nice|suggestion)\b/.test(text)) cat = 'feature-request';
    else if (/\b(how|help|where|what|can i|tutorial)\b/.test(text)) cat = 'question';
  }

  // Auto-link to subscriber by email
  let customer = { name: 'App User', email: email || '', subscriberId: '' };
  let priority = 'normal';
  if (email) {
    const subs = subStore(req).read();
    const match = subs.find(sub => (sub.email || '').toLowerCase() === email.toLowerCase());
    if (match) {
      customer = { name: match.name, email: match.email, subscriberId: match.id };
      // Priority bump for paying subscribers
      if (match.status === 'active' || match.status === 'founding') priority = 'high';
    }
  }

  const now = new Date().toISOString();
  const ticket = {
    id: s.nextId('t'),
    status: 'new',
    priority,
    category: cat,
    source: 'app-feedback',
    customer,
    subject: subject || `${cat} report`,
    description: [
      description || '',
      appVersion ? `\nApp Version: ${appVersion}` : '',
      deviceInfo ? `\nDevice: ${typeof deviceInfo === 'string' ? deviceInfo : JSON.stringify(deviceInfo)}` : '',
    ].filter(Boolean).join(''),
    aiAnalysis: null,
    resolution: '',
    createdAt: now,
    resolvedAt: null,
    messages: [],
  };

  tickets.push(ticket);
  s.write(tickets);

  broadcast(req, { type: 'ticket:new', data: ticket });
  broadcast(req, { type: 'activity', data: { icon: 'ticket', text: `${cat}: ${ticket.subject}`, time: now } });

  if (alertRouter && (priority === 'high' || priority === 'critical')) {
    alertRouter.send('feedback', priority,
      `${cat} from ${customer.name}: ${ticket.subject}`,
      { ticketId: ticket.id }
    );
  }

  res.status(201).json({ ok: true, ticketId: ticket.id, category: cat });
});

// ── Crash Fingerprinting ─────────────────────────────────
function fingerprint(errorStack, appVersion) {
  // Take first 3 lines of stack + version for fingerprinting
  const stackLines = (errorStack || '').split('\n').slice(0, 3).join('\n');
  const input = `${stackLines}|${appVersion || ''}`;
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 12);
}

// POST /api/webhooks/crash — accepts crash reports from mobile app
router.post('/crash', (req, res) => {
  const { errorStack, deviceInfo, appVersion, severity, userContext } = req.body;

  if (!errorStack) {
    return res.status(400).json({ error: 'errorStack is required' });
  }

  const fp = fingerprint(errorStack, appVersion);
  const s = store(req);
  const tickets = s.read();
  const alertRouter = req.app.locals.alertRouter;

  // Check for existing ticket with same fingerprint within 24h
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const existing = tickets.find(t =>
    t.crashFingerprint === fp &&
    t.createdAt > dayAgo &&
    !['resolved', 'closed'].includes(t.status)
  );

  if (existing) {
    // Merge as new occurrence
    const idx = tickets.findIndex(t => t.id === existing.id);
    tickets[idx].crashCount = (tickets[idx].crashCount || 1) + 1;
    tickets[idx].lastCrashAt = new Date().toISOString();

    // Add occurrence to messages
    tickets[idx].messages = tickets[idx].messages || [];
    tickets[idx].messages.push({
      from: 'system',
      text: `Crash occurrence #${tickets[idx].crashCount} — ${deviceInfo?.model || 'unknown device'}, v${appVersion || '?'}`,
      timestamp: new Date().toISOString()
    });

    // Auto-escalate after 5 occurrences
    if (tickets[idx].crashCount >= 5 && tickets[idx].priority !== 'critical') {
      tickets[idx].priority = 'critical';
      tickets[idx].messages.push({
        from: 'system',
        text: `Auto-escalated to CRITICAL — ${tickets[idx].crashCount} crash occurrences`,
        timestamp: new Date().toISOString()
      });

      if (alertRouter) {
        alertRouter.send('crash-escalation', 'critical',
          `Crash auto-escalated: ${tickets[idx].subject} (${tickets[idx].crashCount} occurrences)`,
          { ticketId: tickets[idx].id, crashCount: tickets[idx].crashCount }
        );
      }
    }

    s.write(tickets);
    broadcast(req, { type: 'ticket:updated', data: tickets[idx] });

    return res.json({
      ok: true,
      action: 'merged',
      ticketId: tickets[idx].id,
      crashCount: tickets[idx].crashCount
    });
  }

  // Create new crash ticket
  const crashSeverity = severity || 'high';
  const ticket = {
    id: s.nextId('t'),
    status: 'new',
    priority: crashSeverity,
    customer: { name: userContext?.userName || 'App User', email: userContext?.email || '', subscriberId: userContext?.subscriberId || '' },
    subject: `App Crash: ${(errorStack || '').split('\n')[0].slice(0, 80)}`,
    description: [
      `**Crash Report**`,
      `Device: ${deviceInfo?.model || 'Unknown'} (${deviceInfo?.os || '?'})`,
      `App Version: ${appVersion || 'Unknown'}`,
      userContext?.screen ? `Screen: ${userContext.screen}` : '',
      '',
      '```',
      errorStack,
      '```'
    ].filter(Boolean).join('\n'),
    source: 'crash-webhook',
    crashFingerprint: fp,
    crashCount: 1,
    lastCrashAt: new Date().toISOString(),
    aiAnalysis: null,
    resolution: '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    messages: []
  };

  tickets.push(ticket);
  s.write(tickets);
  broadcast(req, { type: 'ticket:new', data: ticket });
  broadcast(req, { type: 'activity', data: { icon: 'ticket', text: `Crash report: ${ticket.subject}`, time: ticket.createdAt } });

  // Alert for critical crashes
  if (crashSeverity === 'critical' && alertRouter) {
    alertRouter.send('crash', 'critical', `Critical app crash: ${ticket.subject}`, { ticketId: ticket.id });
  }

  res.status(201).json({ ok: true, action: 'created', ticketId: ticket.id, fingerprint: fp });
});

module.exports = router;
