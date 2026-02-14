// AI Proxy — runs on Windows host, pipes requests through claude CLI
// The VM Hub calls this instead of the Anthropic API directly
const http = require('http');
const { exec } = require('child_process');
const path = require('path');

const PORT = 8889;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /status
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: true, authType: 'claude-cli', model: 'claude-subscription' }));
    return;
  }

  // POST /ask
  if (req.method === 'POST' && req.url === '/ask') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let prompt;
      try {
        prompt = JSON.parse(body).prompt;
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No prompt provided' }));
        return;
      }

      // Write prompt to temp file to avoid shell escaping issues
      const fs = require('fs');
      const os = require('os');
      const tmpFile = path.join(os.tmpdir(), 'ai-prompt-' + Date.now() + '.txt');
      fs.writeFileSync(tmpFile, prompt, 'utf8');

      // Use claude CLI with --print flag, pipe from temp file
      const env = Object.assign({}, process.env);
      delete env.CLAUDECODE;

      const cmd = `type "${tmpFile}" | claude --print`;
      console.log('[AI Proxy] Running claude CLI...');

      exec(cmd, {
        env,
        timeout: 90000,
        maxBuffer: 2 * 1024 * 1024,
        shell: 'cmd.exe'
      }, (err, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch {}

        if (err) {
          console.error('[AI Proxy] Error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        console.log('[AI Proxy] Response:', stdout.substring(0, 80) + '...');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answer: stdout.trim() }));
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AI Proxy listening on port ${PORT}`);
  console.log(`  VM endpoint: http://10.0.2.2:${PORT}\n`);
});
