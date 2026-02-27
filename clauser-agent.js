#!/usr/bin/env node
// ── Clauser Agent — SweepNspect AI Operations ──────────────
// Polls new tickets, analyzes via AI Proxy, monitors subscribers,
// reads @clauser directives, heartbeats to Hub.

const http = require('http');

// ── Config ──────────────────────────────────────────────────
const HUB_URL = process.env.HUB_URL || 'http://127.0.0.1:8888';
const AI_PROXY_URL = process.env.AI_PROXY_URL || 'http://127.0.0.1:8889';
const POLL_INTERVAL = 30000;       // 30s — check for new tickets
const HEARTBEAT_INTERVAL = 15000;  // 15s
const CHURN_INTERVAL = 300000;     // 5min

// ── State ───────────────────────────────────────────────────
let paused = false;
let ticketsProcessed = 0;
let currentTask = null;
let backoffMs = 0;
let proxyAvailable = false;
const MAX_BACKOFF = 120000;
const churnAlerted = new Set(); // track already-alerted subscriber IDs

// ── HTTP helpers ────────────────────────────────────────────
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, HUB_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function api(path) { return apiRequest('GET', `/api/${path}`); }
function apiPost(path, body) { return apiRequest('POST', `/api/${path}`, body); }
function apiPut(path, body) { return apiRequest('PUT', `/api/${path}`, body); }

// ── AI Proxy ────────────────────────────────────────────────
function callProxy(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      prompt: `${systemPrompt}\n\n${userMessage}`
    });

    const url = new URL('/ask', AI_PROXY_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
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

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('AI proxy timeout')); });
    req.write(postData);
    req.end();
  });
}

async function checkProxyAvailability() {
  try {
    const result = await new Promise((resolve, reject) => {
      const url = new URL('/status', AI_PROXY_URL);
      const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname, timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    proxyAvailable = result;
    return result;
  } catch {
    proxyAvailable = false;
    return false;
  }
}

const SYSTEM_PROMPT = `You are Clauser, SweepNspect's AI operations agent for a chimney inspection business.

Your job is to analyze support tickets and provide actionable recommendations.

For each ticket, provide:
1. **Root Cause**: What likely caused this issue
2. **Severity Assessment**: How urgent this is (critical/high/medium/low)
3. **Recommended Action**: Specific steps to resolve
4. **Customer Impact**: How this affects the customer's experience

Keep responses concise and professional. Focus on chimney inspection domain knowledge:
- Scheduling issues, inspection delays
- Equipment problems, safety concerns
- Billing/subscription questions
- Service quality complaints
- Weather-related rescheduling`;

// ── Core Functions ──────────────────────────────────────────
async function processNewTickets() {
  try {
    const tickets = await api('tickets?status=new');
    if (!Array.isArray(tickets) || tickets.length === 0) return;

    for (const ticket of tickets) {
      if (paused) break;

      currentTask = `Analyzing: ${ticket.subject}`;
      log(`Processing ticket ${ticket.id}: ${ticket.subject}`);

      // Set status to ai-working
      await apiPut(`tickets/${ticket.id}`, { status: 'ai-working' });

      try {
        // Build context for AI
        const prompt = [
          `Ticket ID: ${ticket.id}`,
          `Priority: ${ticket.priority}`,
          `Customer: ${ticket.customer?.name || 'Unknown'}`,
          `Subject: ${ticket.subject}`,
          `Description: ${ticket.description}`,
          ticket.messages?.length ? `Messages:\n${ticket.messages.map(m => `  [${m.from}]: ${m.text}`).join('\n')}` : ''
        ].filter(Boolean).join('\n');

        let analysis;
        try {
          analysis = await callProxy(SYSTEM_PROMPT, prompt);
        } catch (proxyErr) {
          log(`Proxy error: ${proxyErr.message} — using fallback`);
          analysis = generateFallbackAnalysis(ticket);
        }

        // Write analysis back to ticket
        await apiPut(`tickets/${ticket.id}`, {
          status: 'review',
          aiAnalysis: {
            text: analysis,
            analyzedAt: new Date().toISOString(),
            model: proxyAvailable ? 'proxy' : 'fallback'
          }
        });

        // Post message as clauser
        const messages = ticket.messages || [];
        messages.push({
          from: 'ai',
          name: 'Clauser',
          text: analysis,
          time: new Date().toISOString()
        });
        await apiPut(`tickets/${ticket.id}`, { messages });

        ticketsProcessed++;
        backoffMs = 0;

        // Post activity
        await apiPost('clauser/activity', {
          text: `Analyzed ticket ${ticket.id}: ${ticket.subject}`,
          icon: 'status'
        });

        // Voice notification for critical/high tickets
        if (['critical', 'high'].includes(ticket.priority)) {
          await apiPost('ai/tts', {
            text: `Clauser finished analyzing ${ticket.priority} ticket: ${ticket.subject}`,
            priority: ticket.priority === 'critical' ? 'critical' : null
          }).catch(() => {});
        }

        log(`Ticket ${ticket.id} analyzed and moved to review`);
      } catch (err) {
        log(`Error analyzing ticket ${ticket.id}: ${err.message}`);
        // Revert to new so it can be retried
        await apiPut(`tickets/${ticket.id}`, { status: 'new' }).catch(() => {});
        applyBackoff();
      }
    }
  } catch (err) {
    log(`Error fetching tickets: ${err.message}`);
    applyBackoff();
  } finally {
    currentTask = null;
  }
}

function generateFallbackAnalysis(ticket) {
  const severity = ticket.priority === 'critical' ? 'Critical' :
                   ticket.priority === 'high' ? 'High' : 'Medium';
  return [
    `**Root Cause**: Ticket requires human review — ${ticket.subject}`,
    `**Severity Assessment**: ${severity} priority`,
    `**Recommended Action**: Review ticket details and respond to customer within ${ticket.priority === 'critical' ? '1 hour' : '24 hours'}`,
    `**Customer Impact**: ${ticket.customer?.name || 'Customer'} is awaiting resolution`,
    '',
    '_Note: Running in fallback mode (AI proxy unavailable). Analysis will improve when proxy is online._'
  ].join('\n');
}

async function checkChurnSignals() {
  try {
    const subs = await api('subscribers');
    if (!Array.isArray(subs)) return;

    const tickets = await api('tickets');
    if (!Array.isArray(tickets)) return;

    for (const sub of subs) {
      if (sub.status !== 'active') continue;

      // Count open tickets for this subscriber
      const openTickets = tickets.filter(t =>
        t.customer?.subscriberId === sub.id &&
        !['resolved', 'closed'].includes(t.status)
      );

      if (openTickets.length >= 3) {
        // Only alert once per subscriber until their tickets change
        const key = `${sub.id}:${openTickets.length}`;
        if (churnAlerted.has(key)) continue;

        churnAlerted.add(key);
        log(`Churn signal: ${sub.name} has ${openTickets.length} open tickets`);
        await apiPost('clauser/activity', {
          text: `Churn risk: ${sub.name} has ${openTickets.length} unresolved tickets`,
          icon: 'subscriber'
        });
        await apiPost('ai/tts', {
          text: `Churn warning: ${sub.name} has ${openTickets.length} unresolved tickets`,
          priority: 'critical'
        }).catch(() => {});
      } else {
        // Clear old alerts if tickets resolved below threshold
        for (const existing of churnAlerted) {
          if (existing.startsWith(sub.id + ':')) churnAlerted.delete(existing);
        }
      }
    }
  } catch (err) {
    log(`Error checking churn: ${err.message}`);
  }
}

async function checkDirectives() {
  try {
    const tasks = await api('commands');
    if (!Array.isArray(tasks)) return;

    for (const task of tasks) {
      if (task.done) continue;
      const text = (task.text || '').toLowerCase().trim();

      if (text.includes('@clauser')) {
        if (text.includes('pause')) {
          paused = true;
          log('Directive received: PAUSED');
          await apiPost('clauser/activity', {
            text: 'Agent paused by directive',
            icon: 'system'
          });
        } else if (text.includes('resume')) {
          paused = false;
          log('Directive received: RESUMED');
          await apiPost('clauser/activity', {
            text: 'Agent resumed by directive',
            icon: 'system'
          });
        }
      }
    }
  } catch (err) {
    log(`Error checking directives: ${err.message}`);
  }
}

async function heartbeat() {
  try {
    await apiPost('clauser/heartbeat', {
      status: paused ? 'paused' : (currentTask ? 'working' : 'online'),
      currentTask,
      ticketsProcessed
    });
  } catch (err) {
    // Heartbeat failures are expected when hub is down — silent
  }
}

// ── Utilities ───────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function applyBackoff() {
  backoffMs = Math.min(MAX_BACKOFF, (backoffMs || 1000) * 2);
  log(`Backing off for ${backoffMs / 1000}s`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main Loop ───────────────────────────────────────────────
async function mainLoop() {
  log('Clauser agent starting...');

  // Check proxy availability
  const proxyOk = await checkProxyAvailability();
  if (proxyOk) {
    log(`AI Proxy available at ${AI_PROXY_URL}`);
  } else {
    log(`WARNING: AI Proxy not available at ${AI_PROXY_URL} — running in fallback mode`);
  }

  // Initial heartbeat
  await heartbeat();

  await apiPost('clauser/activity', {
    text: `Clauser agent started (proxy: ${proxyOk ? 'online' : 'offline'})`,
    icon: 'system'
  }).catch(() => {});

  // Heartbeat timer
  const hbInterval = setInterval(heartbeat, HEARTBEAT_INTERVAL);

  // Re-check proxy every 2 minutes
  setInterval(async () => {
    await checkProxyAvailability();
  }, 120000);

  // Churn check timer
  let lastChurnCheck = 0;

  // Main poll loop
  while (true) {
    if (backoffMs > 0) {
      await sleep(backoffMs);
    }

    if (!paused) {
      await processNewTickets();

      // Churn check every 5 min
      if (Date.now() - lastChurnCheck > CHURN_INTERVAL) {
        await checkChurnSignals();
        lastChurnCheck = Date.now();
      }
    }

    await checkDirectives();
    await sleep(POLL_INTERVAL);
  }
}

// ── Graceful Shutdown ───────────────────────────────────────
function shutdown(signal) {
  log(`Received ${signal}, shutting down...`);
  apiPost('clauser/heartbeat', { status: 'offline', currentTask: null, ticketsProcessed })
    .catch(() => {})
    .finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start ───────────────────────────────────────────────────
mainLoop().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
