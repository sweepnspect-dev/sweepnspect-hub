const express = require('express');
const http = require('http');
const router = express.Router();

// AI Proxy on the Windows host — uses claude CLI with subscription auth
const PROXY_HOST = process.env.AI_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = process.env.AI_PROXY_PORT || 8889;

const SYSTEM_PROMPT = `You are the SweepNspect HQ Assistant — an AI embedded in a chimney inspection business operations dashboard. You talk to J, the owner.

You have access to LIVE data from the Hub which is provided as context with each question. Use this data to give specific, accurate answers.

Capabilities:
- Answer questions about tickets, subscribers, revenue, and operations
- Provide business insights and recommendations
- Explain how the Hub, VM, API, and architecture work
- Help troubleshoot issues

Technical context:
- Hub runs on Genesis (Windows machine) with Express.js on port 8888
- Clauser AI agent processes tickets automatically
- WebSocket for real-time dashboard updates
- JSON file storage (no database)

OUTPUT FORMAT — You MUST produce TWO versions of every response, separated by <<<DISPLAY>>>

FIRST: Your spoken conversational response. Talk naturally like you're speaking to J face-to-face. No markdown, no bullets, no asterisks, no hashtags, no formatting at all. Just natural speech. Use numbers, be specific, be direct. This is what J will HEAR through text-to-speech.

<<<DISPLAY>>>

SECOND: The same information formatted with markdown for the screen. Use bold, bullets, code blocks, headers — whatever makes it scannable. This is what J will SEE on the dashboard.

Example:
Hey J, you've got 3 open tickets right now. Two are high priority — the scheduling conflict for Heritage Chimney and the billing dispute from Metro Services. MRR is sitting at twenty-two fifty. One thing I'd flag, Heritage has 5 unresolved tickets total which puts them in churn territory.

<<<DISPLAY>>>

**3 Open Tickets**
- **High** — Scheduling conflict (Heritage Chimney)
- **High** — Billing dispute (Metro Services)
- **Medium** — Equipment question (Riverside)

**MRR:** $2,250

> **Churn Risk:** Heritage Chimney has 5 unresolved tickets

IMPORTANT: Always include both sections. The spoken part comes FIRST. Keep the spoken version conversational — contractions, natural phrasing, like you're talking. If data shows something concerning, mention it proactively in both versions.`;

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
    const raw = await callProxy(fullPrompt);
    const { speech, display } = splitResponse(raw);
    res.json({ answer: display, speech });
  } catch (err) {
    console.error('[AI] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — direct chat from dashboard Chat tab
router.post('/chat', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const fullPrompt = SYSTEM_PROMPT + '\n\nUser: ' + prompt;

  try {
    const raw = await callProxy(fullPrompt);
    const { speech, display } = splitResponse(raw);
    res.json({ answer: display, speech });
  } catch (err) {
    console.error('[AI] Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Split LLM response into speech + display parts
function splitResponse(raw) {
  const marker = '<<<DISPLAY>>>';
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    // No marker — use raw for both, strip md for speech
    return { speech: raw, display: raw };
  }
  const speech = raw.slice(0, idx).trim();
  const display = raw.slice(idx + marker.length).trim();
  return {
    speech: speech || display,
    display: display || speech
  };
}

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
