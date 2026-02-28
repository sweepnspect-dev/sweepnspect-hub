const express = require('express');
const http = require('http');
const router = express.Router();

// AI Proxy on the Windows host — uses claude CLI with subscription auth
const PROXY_HOST = process.env.AI_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = process.env.AI_PROXY_PORT || 8889;

// ══════════════════════════════════════════════════════════
// SYSTEM PROMPT — AI Ops Manager
// ══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are the SweepNspect Ops Manager — an AI embedded in a chimney inspection business operations dashboard. You talk to J, the owner. You can see everything happening in the business AND take actions.

## Your Data Access
You receive LIVE HUB DATA with every message. This includes:
- **Tickets**: full list with status, priority, customer, dates
- **Subscribers**: all customers with plan, MRR, status, history
- **Revenue**: MRR, MTD, all-time, individual entries
- **Communications**: unread counts across Live Chat, Facebook, SMS channels
- **Marketing**: recent posts, engagement, scheduled content
- **Alerts**: unacknowledged alerts, recent critical/high events
- **System**: service status (worker-poller, email, facebook, SMS, AI, relay)
- **Activity**: recent activity feed

## Actions You Can Take
When the user asks you to DO something (not just report), embed action blocks in your response. Use this exact format:

<<<ACTION>>>
{"action":"update-ticket","id":"t-001","fields":{"status":"resolved","resolution":"Fixed via chat"}}
<<<END_ACTION>>>

### Supported Actions:

**update-ticket** — Update a ticket's status, priority, or resolution
  Fields: status (new|open|ai-working|review|resolved|closed), priority (critical|high|normal|low), resolution (string)
  Example: {"action":"update-ticket","id":"t-003","fields":{"status":"resolved","resolution":"Handled via chat with J"}}

**update-subscriber** — Update subscriber status, plan, or notes
  Fields: status (active|trial|churned|lead|cancelled), plan (string), notes (string)
  Example: {"action":"update-subscriber","id":"s-001","fields":{"status":"active","notes":"Upgraded after demo call"}}

**create-alert** — Create a new alert
  Fields: type (string), severity (critical|high|normal|low), message (string)
  Example: {"action":"create-alert","fields":{"type":"ops-ai","severity":"high","message":"Detected churn risk for Heritage Chimney"}}

**send-sms** — Send an ADB push notification to J's phone
  Fields: message (string)
  Example: {"action":"send-sms","fields":{"message":"Urgent: Heritage Chimney escalated to critical"}}

**add-revenue** — Add a revenue entry
  Fields: amount (number), type (subscription|one-time|refund), description (string), subscriberId (string, optional)
  Example: {"action":"add-revenue","fields":{"amount":250,"type":"subscription","description":"Metro Services monthly","subscriberId":"s-002"}}

## Proactive Intelligence
When you see concerning patterns, flag them WITHOUT being asked:
- **Churn risk**: subscriber with multiple unresolved tickets, long time since last payment, status changes
- **SLA breach**: tickets open > 48h without resolution, especially high/critical priority
- **Revenue trends**: MRR drops, refund spikes, overdue payments
- **Engagement drops**: no Facebook activity, fewer chats, subscriber silence
- **System issues**: services offline, worker disconnected, email errors

## OUTPUT FORMAT
You MUST produce TWO versions of every response, separated by <<<DISPLAY>>>

FIRST: Your spoken conversational response. Talk naturally like you're speaking to J face-to-face. No markdown, no bullets, no asterisks, no hashtags, no formatting at all. Just natural speech. Use numbers, be specific, be direct. This is what J will HEAR through text-to-speech.

<<<DISPLAY>>>

SECOND: The same information formatted with markdown for the screen. Use bold, bullets, code blocks, headers — whatever makes it scannable. This is what J will SEE on the dashboard.

Action blocks go AFTER the <<<DISPLAY>>> section, at the very end.

Example with action:
Hey J, I resolved ticket t-003 for you. It was the scheduling conflict with Heritage — marked it as handled. Just so you know, Heritage now has zero open tickets, so they're in good shape.

<<<DISPLAY>>>

**Ticket t-003 Resolved**
- Status: resolved
- Resolution: Scheduling conflict handled via ops chat
- Customer: Heritage Chimney — 0 remaining open tickets

<<<ACTION>>>
{"action":"update-ticket","id":"t-003","fields":{"status":"resolved","resolution":"Scheduling conflict handled via ops chat"}}
<<<END_ACTION>>>

IMPORTANT: Always include both speech and display sections. Be proactive about flagging issues. When taking actions, always confirm what you did in both versions.`;

// ══════════════════════════════════════════════════════════
// CONTEXT BUILDER
// ══════════════════════════════════════════════════════════

function getOpsContext(req) {
  const jsonStore = req.app.locals.jsonStore;
  const sections = [];

  try {
    const now = new Date();
    sections.push(`LIVE HUB DATA (as of ${now.toISOString()}):`);

    // ── Tickets ──
    const tickets = jsonStore('tickets.json').read();
    const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
    const byStatus = {};
    tickets.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
    const byPriority = {};
    openTickets.forEach(t => { byPriority[t.priority || 'normal'] = (byPriority[t.priority || 'normal'] || 0) + 1; });

    sections.push(`\nTICKETS (${tickets.length} total, ${openTickets.length} open):`);
    sections.push(`  By status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    sections.push(`  By priority (open only): ${Object.entries(byPriority).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (openTickets.length > 0) {
      sections.push('  Recent open tickets (up to 10):');
      openTickets.slice(0, 10).forEach(t => {
        const age = Math.round((now - new Date(t.createdAt)) / 3600000);
        sections.push(`    [${t.id}] ${t.priority || 'normal'} | ${t.status} | "${t.subject}" | ${t.customer?.name || 'Unknown'} | ${age}h old`);
      });
    }

    // ── Subscribers ──
    const subs = jsonStore('subscribers.json').read();
    const activeSubs = subs.filter(s => s.status === 'active');
    const trialSubs = subs.filter(s => s.status === 'trial');
    const churnedSubs = subs.filter(s => s.status === 'churned');
    const mrr = activeSubs.reduce((sum, s) => sum + (s.mrr || 0), 0);

    sections.push(`\nSUBSCRIBERS (${subs.length} total):`);
    sections.push(`  Active: ${activeSubs.length} | Trial: ${trialSubs.length} | Churned: ${churnedSubs.length} | Lead: ${subs.filter(s => s.status === 'lead').length}`);
    sections.push(`  MRR: $${mrr}`);
    subs.forEach(s => {
      const ticketCount = tickets.filter(t => t.customer?.subscriberId === s.id && !['resolved', 'closed'].includes(t.status)).length;
      sections.push(`    [${s.id}] ${s.name || 'Unnamed'} — ${s.status} — $${s.mrr || 0}/mo — ${s.plan || 'none'} — ${ticketCount} open tickets${s.email ? ' — ' + s.email : ''}`);
    });

    // ── Revenue ──
    const rev = jsonStore('revenue.json').read();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const mtdRevenue = rev.filter(r => r.date >= monthStart && r.type !== 'refund').reduce((s, r) => s + (r.amount || 0), 0);
    const mtdRefunds = rev.filter(r => r.date >= monthStart && r.type === 'refund').reduce((s, r) => s + (r.amount || 0), 0);
    const allTimeRevenue = rev.filter(r => r.type !== 'refund').reduce((s, r) => s + (r.amount || 0), 0);

    sections.push(`\nREVENUE:`);
    sections.push(`  MRR: $${mrr} | MTD revenue: $${mtdRevenue} | MTD refunds: $${mtdRefunds} | All-time: $${allTimeRevenue}`);
    if (rev.length > 0) {
      sections.push('  Recent entries (last 5):');
      rev.slice(0, 5).forEach(r => {
        sections.push(`    $${r.amount} ${r.type || 'payment'} — ${r.description || 'No desc'} — ${r.date || 'no date'}${r.subscriberId ? ' [' + r.subscriberId + ']' : ''}`);
      });
    }

    // ── Comms (unread counts) ──
    const fbMsgs = jsonStore('comms-facebook.json').read();
    const smsMsgs = jsonStore('comms-sms.json').read();
    const lcSessions = jsonStore('livechat-sessions.json').read();
    const fbUnread = fbMsgs.filter(m => m.unread).length;
    const smsUnread = smsMsgs.filter(m => m.unread).length;
    const lcActive = lcSessions.filter(s => s.status === 'active').length;

    sections.push(`\nCOMMUNICATIONS:`);
    sections.push(`  Live Chat: ${lcSessions.length} total, ${lcActive} active`);
    sections.push(`  Facebook: ${fbMsgs.length} total, ${fbUnread} unread`);
    sections.push(`  SMS: ${smsMsgs.length} total, ${smsUnread} unread`);

    // ── Marketing ──
    try {
      const posts = jsonStore('marketing-posts.json').read();
      const published = posts.filter(p => p.status === 'published');
      const scheduled = posts.filter(p => p.status === 'scheduled');
      const totalEngagement = published.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0) + (p.shares || 0), 0);

      sections.push(`\nMARKETING:`);
      sections.push(`  Posts: ${published.length} published, ${scheduled.length} scheduled`);
      sections.push(`  Total engagement: ${totalEngagement} (likes+comments+shares)`);
      if (published.length > 0) {
        sections.push('  Recent posts (last 3):');
        published.slice(0, 3).forEach(p => {
          sections.push(`    "${(p.message || '').substring(0, 60)}" — ${p.publishedAt || 'unknown date'}`);
        });
      }
    } catch { sections.push('\nMARKETING: [could not load]'); }

    // ── Alerts ──
    const alerts = jsonStore('alerts.json').read();
    const unacked = alerts.filter(a => !a.acknowledged);
    const criticalAlerts = unacked.filter(a => a.severity === 'critical' || a.severity === 'high');

    sections.push(`\nALERTS:`);
    sections.push(`  Unacknowledged: ${unacked.length} (${criticalAlerts.length} critical/high)`);
    if (criticalAlerts.length > 0) {
      sections.push('  Recent critical/high:');
      criticalAlerts.slice(0, 5).forEach(a => {
        sections.push(`    [${a.severity}] ${a.type}: ${a.message} — ${a.timestamp}`);
      });
    }

    // ── System services ──
    const workerStatus = req.app.locals.workerPoller?.getStatus() || {};
    const emailStatus = req.app.locals.emailPoller?.getInbox() || {};
    const fbService = req.app.locals.facebookService;
    const smsService = req.app.locals.smsService;

    sections.push(`\nSYSTEM SERVICES:`);
    sections.push(`  Worker Poller: ${workerStatus.status || 'unknown'} (${workerStatus.checkCount || 0} checks)`);
    sections.push(`  Email: ${emailStatus.status || 'unknown'} (${emailStatus.unread || 0} unread)`);
    sections.push(`  Facebook: ${fbService?.configured ? 'online' : 'standby'}`);
    sections.push(`  SMS/ADB: available`);

    // ── Recent Activity (from automation log) ──
    try {
      const actLog = jsonStore('automation-log.json').read();
      if (actLog.length > 0) {
        sections.push(`\nRECENT AUTOMATION (last 5):`);
        actLog.slice(0, 5).forEach(e => {
          sections.push(`  ${e.rule || 'rule'}: ${e.event || ''} — ${e.timestamp || ''}`);
        });
      }
    } catch {}

    // ── Commands/Tasks ──
    try {
      const cmds = jsonStore('commands.json').read();
      const tasks = cmds.tasks || cmds;
      const schedule = cmds.schedule || [];
      if (tasks.length > 0 || schedule.length > 0) {
        sections.push(`\nTASKS: ${Array.isArray(tasks) ? tasks.length : 0} tasks, ${schedule.length} scheduled`);
        if (Array.isArray(tasks)) {
          tasks.slice(0, 5).forEach(t => {
            sections.push(`  ${t.text || t.title || 'task'} — ${t.status || 'pending'}`);
          });
        }
      }
    } catch {}

  } catch (e) {
    sections.push(`\n[Error loading Hub data: ${e.message}]`);
  }

  return sections.join('\n');
}

// ══════════════════════════════════════════════════════════
// ACTION DISPATCHER
// ══════════════════════════════════════════════════════════

function parseActions(raw) {
  const actions = [];
  const actionRegex = /<<<ACTION>>>\s*([\s\S]*?)\s*<<<END_ACTION>>>/g;
  let match;
  while ((match = actionRegex.exec(raw)) !== null) {
    try {
      actions.push(JSON.parse(match[1].trim()));
    } catch (e) {
      console.error('[AI] Failed to parse action:', match[1], e.message);
    }
  }
  return actions;
}

function stripActions(raw) {
  return raw.replace(/<<<ACTION>>>[\s\S]*?<<<END_ACTION>>>/g, '').trim();
}

async function executeActions(actions, req) {
  const jsonStore = req.app.locals.jsonStore;
  const broadcast = req.app.locals.broadcast;
  const alertRouter = req.app.locals.alertRouter;
  const results = [];

  for (const action of actions) {
    try {
      switch (action.action) {
        case 'update-ticket': {
          const store = jsonStore('tickets.json');
          const tickets = store.read();
          const ticket = tickets.find(t => t.id === action.id);
          if (!ticket) { results.push({ action: action.action, id: action.id, ok: false, error: 'Ticket not found' }); break; }
          const fields = action.fields || {};
          if (fields.status) ticket.status = fields.status;
          if (fields.priority) ticket.priority = fields.priority;
          if (fields.resolution !== undefined) ticket.resolution = fields.resolution;
          if (fields.status === 'resolved' && !ticket.resolvedAt) ticket.resolvedAt = new Date().toISOString();
          store.write(tickets);
          broadcast({ type: 'ticket:updated', data: ticket });
          results.push({ action: action.action, id: action.id, ok: true });
          console.log(`[AI-ACTION] Updated ticket ${action.id}: ${JSON.stringify(fields)}`);
          break;
        }
        case 'update-subscriber': {
          const store = jsonStore('subscribers.json');
          const subs = store.read();
          const sub = subs.find(s => s.id === action.id);
          if (!sub) { results.push({ action: action.action, id: action.id, ok: false, error: 'Subscriber not found' }); break; }
          const fields = action.fields || {};
          if (fields.status) sub.status = fields.status;
          if (fields.plan) sub.plan = fields.plan;
          if (fields.notes !== undefined) sub.notes = fields.notes;
          store.write(subs);
          broadcast({ type: 'subscriber:updated', data: sub });
          results.push({ action: action.action, id: action.id, ok: true });
          console.log(`[AI-ACTION] Updated subscriber ${action.id}: ${JSON.stringify(fields)}`);
          break;
        }
        case 'create-alert': {
          const fields = action.fields || {};
          if (alertRouter && fields.message) {
            alertRouter.send(fields.type || 'ops-ai', fields.severity || 'normal', fields.message, {});
            results.push({ action: action.action, ok: true });
            console.log(`[AI-ACTION] Created alert: ${fields.message}`);
          }
          break;
        }
        case 'send-sms': {
          const fields = action.fields || {};
          const smsService = req.app.locals.smsService;
          if (smsService && fields.message) {
            const result = await smsService.send(fields.message);
            results.push({ action: action.action, ok: result.sent !== false, detail: result });
            console.log(`[AI-ACTION] Sent SMS/ADB: ${fields.message}`);
          }
          break;
        }
        case 'add-revenue': {
          const store = jsonStore('revenue.json');
          const rev = store.read();
          const fields = action.fields || {};
          const entry = {
            id: store.nextId ? store.nextId('r') : `r-${Date.now().toString(36)}`,
            amount: fields.amount || 0,
            type: fields.type || 'payment',
            description: fields.description || '',
            subscriberId: fields.subscriberId || '',
            date: new Date().toISOString(),
          };
          rev.unshift(entry);
          store.write(rev);
          broadcast({ type: 'revenue:new', data: entry });
          results.push({ action: action.action, ok: true, id: entry.id });
          console.log(`[AI-ACTION] Added revenue: $${entry.amount} ${entry.type}`);
          break;
        }
        default:
          results.push({ action: action.action, ok: false, error: 'Unknown action' });
      }
    } catch (e) {
      results.push({ action: action.action, ok: false, error: e.message });
      console.error(`[AI-ACTION] Error executing ${action.action}:`, e.message);
    }
  }

  return results;
}

// ══════════════════════════════════════════════════════════
// PROXY HELPERS
// ══════════════════════════════════════════════════════════

function callProxy(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ prompt });

    const options = {
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      path: '/ask',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.answer) {
            resolve(parsed.answer);
          } else if (parsed.error) {
            reject(new Error(parsed.error));
          } else {
            reject(new Error('Unexpected proxy response'));
          }
        } catch (e) { reject(e); }
      });
    });

    req.on('error', (e) => reject(new Error('AI Proxy unreachable: ' + e.message)));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('AI Proxy timeout')); });
    req.write(postData);
    req.end();
  });
}

function checkProxy() {
  return new Promise((resolve) => {
    const req = http.get(`http://${PROXY_HOST}:${PROXY_PORT}/status`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}

// Split LLM response into speech + display parts
function splitResponse(raw) {
  const marker = '<<<DISPLAY>>>';
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    return { speech: raw, display: raw };
  }
  const speech = raw.slice(0, idx).trim();
  const display = raw.slice(idx + marker.length).trim();
  return {
    speech: speech || display,
    display: display || speech
  };
}

// ══════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════

// POST /api/ai/ask — Quick question with full context (Home tab widget)
router.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'No question provided' });

  const context = getOpsContext(req);
  const fullPrompt = SYSTEM_PROMPT + '\n\n' + context + '\n\nUser question: ' + question;

  try {
    const raw = await callProxy(fullPrompt);
    // Parse and execute any actions
    const actions = parseActions(raw);
    const actionResults = actions.length > 0 ? await executeActions(actions, req) : [];
    // Strip actions from display
    const cleaned = stripActions(raw);
    const { speech, display } = splitResponse(cleaned);
    res.json({ answer: display, speech, actions: actionResults });
  } catch (err) {
    console.error('[AI] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — Full chat with context + conversation history (Chat tab)
router.post('/chat', async (req, res) => {
  const { prompt, messages } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const context = getOpsContext(req);

  // Build conversation history
  let conversationBlock = '';
  if (messages && Array.isArray(messages) && messages.length > 0) {
    // Include last 10 messages for context window management
    const recent = messages.slice(-10);
    conversationBlock = '\n\nCONVERSATION HISTORY:\n' +
      recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
  }

  const fullPrompt = SYSTEM_PROMPT + '\n\n' + context + conversationBlock + '\n\nUser: ' + prompt;

  try {
    const raw = await callProxy(fullPrompt);
    const actions = parseActions(raw);
    const actionResults = actions.length > 0 ? await executeActions(actions, req) : [];
    const cleaned = stripActions(raw);
    const { speech, display } = splitResponse(cleaned);
    res.json({ answer: display, speech, actions: actionResults });
  } catch (err) {
    console.error('[AI] Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/tts — LLM or automation triggers voice notification
router.post('/tts', (req, res) => {
  const { text, priority, rate } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const broadcast = req.app.locals.broadcast;
  broadcast({ type: 'tts:speak', data: { text, priority: priority || null, rate: rate || null } });

  res.json({ ok: true, spoken: text });
});

// GET /api/ai/status — check if AI proxy is reachable
router.get('/status', async (req, res) => {
  const proxy = await checkProxy();
  res.json({
    available: !!proxy,
    authType: proxy ? 'claude-cli' : null,
    model: proxy ? 'claude-subscription' : null,
    hint: proxy ? null : 'AI Proxy not running. Start ai-proxy.js on Windows host.'
  });
});

module.exports = router;
