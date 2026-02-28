// AI Proxy — direct Anthropic API calls via HTTPS
// Reads API key from ANTHROPIC_API_KEY env var (inject via vw-inject)
const http = require('http');
const https = require('https');

const PORT = 8889;
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';

function callAnthropic(prompt, system) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY not set'));

    const payload = {
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    };
    if (system) payload.system = system;
    const body = JSON.stringify(payload);

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          const text = parsed.content?.map(c => c.text).join('') || '';
          resolve(text);
        } catch (e) { reject(new Error('Bad API response: ' + data.slice(0, 200))); }
      });
    });

    req.on('error', e => reject(e));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('API timeout (30s)')); });
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /status
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      available: !!process.env.ANTHROPIC_API_KEY,
      authType: 'api-key',
      model: MODEL,
    }));
    return;
  }

  // POST /ask
  if (req.method === 'POST' && req.url === '/ask') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let prompt, system;
      try { const parsed = JSON.parse(body); prompt = parsed.prompt; system = parsed.system; } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No prompt provided' }));
        return;
      }

      const start = Date.now();
      try {
        const answer = await callAnthropic(prompt, system);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[AI Proxy] ${elapsed}s — ${answer.substring(0, 80)}...`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answer }));
      } catch (err) {
        console.error(`[AI Proxy] Error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AI Proxy listening on port ${PORT}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Auth: ${process.env.ANTHROPIC_API_KEY ? 'API key loaded' : 'NO API KEY — set ANTHROPIC_API_KEY'}`);
  console.log(`  Endpoint: http://127.0.0.1:${PORT}\n`);
});
