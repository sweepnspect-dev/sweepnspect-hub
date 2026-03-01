// ── Global Search — scans all JSON stores ────────────────
const router = require('express').Router();

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json({ results: [], total: 0 });

  const jsonStore = req.app.locals.jsonStore;
  const results = [];
  const limit = parseInt(req.query.limit) || 30;

  // Helper — check if any field matches
  function matches(text) {
    return text && text.toLowerCase().includes(q);
  }

  // ── Subscribers ──
  try {
    const subs = jsonStore('subscribers.json').read();
    for (const s of subs) {
      if (matches(s.name) || matches(s.email) || matches(s.phone)) {
        results.push({
          type: 'subscriber', id: s.id,
          title: s.name || s.email,
          subtitle: `${s.status} — ${s.plan} — $${s.mrr}/mo`,
          match: [s.name, s.email, s.phone].filter(f => matches(f))[0],
          route: `#customers/${s.id}`,
        });
      }
    }
  } catch {}

  // ── Tickets ──
  try {
    const tickets = jsonStore('tickets.json').read();
    for (const t of tickets) {
      if (matches(t.subject) || matches(t.description) || matches(t.customer?.name) || matches(t.customer?.email)) {
        results.push({
          type: 'ticket', id: t.id,
          title: t.subject,
          subtitle: `${t.status} — ${t.priority}${t.category ? ' — ' + t.category : ''}`,
          match: [t.subject, t.customer?.name, t.customer?.email].filter(f => matches(f))[0],
          route: `#tickets/${t.id}`,
        });
      }
    }
  } catch {}

  // ── SMS ──
  try {
    const sms = jsonStore('comms-sms.json').read();
    for (const m of sms) {
      if (matches(m.from) || matches(m.to) || matches(m.message)) {
        results.push({
          type: 'sms', id: m.id,
          title: m.direction === 'outbound' ? `To: ${m.to}` : `From: ${m.from}`,
          subtitle: (m.message || '').slice(0, 80),
          match: m.message?.slice(0, 60),
          route: `#comms/sms-${m.id}`,
        });
      }
    }
  } catch {}

  // ── Sent Emails ──
  try {
    const emails = jsonStore('comms-email-sent.json').read();
    for (const e of emails) {
      if (matches(e.to) || matches(e.subject) || matches(e.body)) {
        results.push({
          type: 'email', id: e.id,
          title: `To: ${e.to}`,
          subtitle: e.subject || '(no subject)',
          match: [e.subject, e.body?.slice(0, 60)].filter(f => matches(f))[0],
          route: '#comms',
        });
      }
    }
  } catch {}

  // ── Live Chat ──
  try {
    const sessions = jsonStore('livechat-sessions.json').read();
    for (const s of sessions) {
      const nameMatch = matches(s.visitor?.name) || matches(s.visitor?.email);
      const msgMatch = s.messages?.some(m => matches(m.text));
      if (nameMatch || msgMatch) {
        results.push({
          type: 'livechat', id: s.id,
          title: s.visitor?.name || s.visitor?.email || 'Visitor',
          subtitle: `${s.status} — ${s.messages?.length || 0} messages`,
          match: nameMatch
            ? (s.visitor?.name || s.visitor?.email)
            : s.messages?.find(m => matches(m.text))?.text?.slice(0, 60),
          route: `#comms/livechat-${s.id}`,
        });
      }
    }
  } catch {}

  // ── Marketing Posts ──
  try {
    const posts = jsonStore('marketing-posts.json').read();
    for (const p of posts) {
      if (matches(p.message)) {
        results.push({
          type: 'marketing', id: p.id,
          title: (p.message || '').slice(0, 60),
          subtitle: `${p.status} — ${p.platform}`,
          match: p.message?.slice(0, 60),
          route: '#marketing',
        });
      }
    }
  } catch {}

  res.json({ results: results.slice(0, limit), total: results.length });
});

module.exports = router;
