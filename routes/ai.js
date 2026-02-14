const express = require('express');
const http = require('http');
const router = express.Router();

// AI Proxy on the Windows host — uses claude CLI with subscription auth
const PROXY_HOST = process.env.AI_PROXY_HOST || '10.0.2.2';
const PROXY_PORT = process.env.AI_PROXY_PORT || 8889;

const SYSTEM_PROMPT = `You are the SweepNspect HQ Assistant — an AI embedded in a chimney inspection business operations dashboard.

You have access to LIVE data from the Hub which is provided as context with each question. Use this data to give specific, accurate answers.

Capabilities:
- Answer questions about tickets, subscribers, revenue, and operations
- Provide business insights and recommendations
- Explain how the Hub, VM, API, and architecture work
- Help troubleshoot issues

Style:
- Concise and direct — no fluff
- Use numbers and specifics from the data
- Format with markdown (bold, bullets, code)
- If data shows something concerning (high churn, many open tickets), proactively mention it

Technical context:
- Hub runs on Alpine Linux VM (QEMU) on Windows
- Express.js server on port 8888
- Clauser AI agent processes tickets automatically
- WebSocket for real-time dashboard updates
- JSON file storage (no database)`;

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

// POST /api/ai/ask
router.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'No question provided' });

  // Gather live context
  const jsonStore = req.app.locals.jsonStore;
  let context = '';
  try {
    const tickets = jsonStore('tickets.json').read();
    const subs = jsonStore('subscribers.json').read();
    const rev = jsonStore('revenue.json').read();
    const cmds = jsonStore('commands.json').read();

    const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
    const activeSubs = subs.filter(s => s.status === 'active');
    const mrr = activeSubs.reduce((sum, s) => sum + (s.mrr || 0), 0);

    context = `
LIVE HUB DATA (as of ${new Date().toISOString()}):

TICKETS (${tickets.length} total):
- Open: ${openTickets.length}
- AI-Working: ${tickets.filter(t => t.status === 'ai-working').length}
- Needs Review: ${tickets.filter(t => t.status === 'review').length}
- Resolved: ${tickets.filter(t => t.status === 'resolved').length}
${openTickets.length > 0 ? '\nOpen tickets:\n' + openTickets.map(t =>
  `  [${t.id}] ${t.priority} — ${t.subject} (${t.customer?.name || 'Unknown'})`
).join('\n') : ''}

SUBSCRIBERS (${subs.length} total):
- Active: ${activeSubs.length}
- Trial: ${subs.filter(s => s.status === 'trial').length}
- Churned: ${subs.filter(s => s.status === 'churned').length}
${subs.map(s => `  [${s.id}] ${s.name} — ${s.status} — $${s.mrr || 0}/mo`).join('\n')}

REVENUE:
- MRR: $${mrr}
- Entries this month: ${rev.length}
- Total all-time: $${rev.filter(r => r.type !== 'refund').reduce((s, r) => s + r.amount, 0)}

RECENT COMMANDS: ${cmds.length > 0 ? cmds.slice(-5).map(c => c.text).join('; ') : 'None'}
`;
  } catch (e) {
    context = '\n[Could not load Hub data: ' + e.message + ']\n';
  }

  const fullPrompt = SYSTEM_PROMPT + '\n\n' + context + '\n\nUser question: ' + question;

  try {
    const answer = await callProxy(fullPrompt);
    res.json({ answer });
  } catch (err) {
    console.error('[AI] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
