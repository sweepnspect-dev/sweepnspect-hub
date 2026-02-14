const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('tickets.json'); }
function broadcast(req, msg) { req.app.locals.broadcast(msg); }

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
