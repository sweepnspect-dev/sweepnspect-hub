/**
 * SweepNspect Webhook Worker
 * Receives Tawk.to webhooks, stores in KV, exposes API for HQ polling.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Route handling
    if (url.pathname === '/api/founding' && request.method === 'POST') {
      return handleFoundingApplication(request, env);
    }

    if (url.pathname === '/api/founding' && request.method === 'GET') {
      return handleGetApplications(request, env);
    }

    if (url.pathname === '/api/webhooks/tawk' && request.method === 'POST') {
      return handleTawkWebhook(request, env);
    }

    // Facebook webhook verification (GET) and events (POST)
    if (url.pathname === '/api/webhooks/facebook' && request.method === 'GET') {
      return handleFacebookVerify(request, env);
    }

    if (url.pathname === '/api/webhooks/facebook' && request.method === 'POST') {
      return handleFacebookWebhook(request, env);
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
      return handleGetEvents(request, env);
    }

    if (url.pathname === '/api/events/ack' && request.method === 'POST') {
      return handleAckEvents(request, env);
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'sweepnspect-webhook', timestamp: Date.now() });
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── Founding 25 Application Handler ─────────────────────────

async function handleFoundingApplication(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { name, email, years_sweeping, current_tools, heard_about, referred_by } = body;

  if (!name || !email || !years_sweeping || !heard_about) {
    return json({ error: 'Missing required fields: name, email, years_sweeping, heard_about' }, 400);
  }

  const id = `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const application = {
    id,
    name,
    email,
    years_sweeping: parseInt(years_sweeping) || 0,
    current_tools: current_tools || '',
    heard_about,
    referred_by: referred_by || '',
    status: 'new',
    submittedAt: now,
  };

  // Store in KV (90-day TTL)
  await env.EVENTS.put(id, JSON.stringify(application), { expirationTtl: 7776000 });

  // Add to applications list
  const apps = await getApplicationsList(env);
  apps.push(id);
  await env.EVENTS.put('_applications', JSON.stringify(apps));

  // Also create an event for the HQ dashboard
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

  console.log(`[FOUNDING] New application: ${name} (${email})`);

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

// ── Tawk.to Webhook Handler ─────────────────────────────────

async function handleTawkWebhook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

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

  // Store in KV with 30-day TTL
  await env.EVENTS.put(id, JSON.stringify(processed), { expirationTtl: 2592000 });

  // Add to the unacked events list
  const unacked = await getUnackedList(env);
  unacked.push(id);
  await env.EVENTS.put('_unacked', JSON.stringify(unacked));

  console.log(`[TAWK] ${event}: ${processed.summary}`);

  return json({ ok: true, id });
}

// ── Get Unacknowledged Events (HQ polls this) ──────────────

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

// ── Acknowledge Events (HQ calls after processing) ─────────

async function handleAckEvents(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const idsToAck = body.ids || [];
  if (!idsToAck.length) return json({ error: 'No ids provided' }, 400);

  const unacked = await getUnackedList(env);
  const remaining = unacked.filter(id => !idsToAck.includes(id));
  await env.EVENTS.put('_unacked', JSON.stringify(remaining));

  return json({ ok: true, acknowledged: idsToAck.length, remaining: remaining.length });
}

// ── Facebook Webhook Handlers ───────────────────────────────

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
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const object = body.object;
  if (object !== 'page') {
    return json({ error: 'Not a page event' }, 400);
  }

  const now = new Date().toISOString();

  for (const entry of (body.entry || [])) {
    const pageId = entry.id;

    // Handle messaging events (Page Conversations)
    for (const msg of (entry.messaging || [])) {
      const senderId = msg.sender?.id;
      if (senderId === pageId) continue; // Skip messages sent by the page itself

      const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const evt = {
        id,
        event: 'facebook:message',
        receivedAt: now,
        summary: `FB message from ${senderId}: ${(msg.message?.text || '').substring(0, 80)}`,
        priority: 'high',
        facebook: {
          pageId,
          senderId,
          messageId: msg.message?.mid,
          text: msg.message?.text || '',
          timestamp: msg.timestamp,
        },
      };

      await env.EVENTS.put(id, JSON.stringify(evt), { expirationTtl: 2592000 });
      const unacked = await getUnackedList(env);
      unacked.push(id);
      await env.EVENTS.put('_unacked', JSON.stringify(unacked));
      console.log(`[FB] Message from ${senderId}`);
    }

    // Handle feed changes (comments, posts)
    for (const change of (entry.changes || [])) {
      const field = change.field;
      const value = change.value;

      if (field === 'feed' && value) {
        const item = value.item; // 'comment', 'post', 'reaction', etc.
        const verb = value.verb; // 'add', 'edit', 'remove'

        if (item === 'comment' && verb === 'add') {
          const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const evt = {
            id,
            event: 'facebook:comment',
            receivedAt: now,
            summary: `FB comment by ${value.from?.name || 'someone'}: ${(value.message || '').substring(0, 80)}`,
            priority: 'normal',
            facebook: {
              pageId,
              commentId: value.comment_id,
              postId: value.post_id,
              parentId: value.parent_id,
              from: value.from,
              message: value.message || '',
              timestamp: value.created_time,
            },
          };

          await env.EVENTS.put(id, JSON.stringify(evt), { expirationTtl: 2592000 });
          const unacked = await getUnackedList(env);
          unacked.push(id);
          await env.EVENTS.put('_unacked', JSON.stringify(unacked));
          console.log(`[FB] Comment by ${value.from?.name || 'unknown'}`);

        } else if (item === 'reaction' && verb === 'add') {
          const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const evt = {
            id,
            event: 'facebook:reaction',
            receivedAt: now,
            summary: `FB ${value.reaction_type || 'reaction'} by ${value.from?.name || 'someone'}`,
            priority: 'low',
            facebook: {
              pageId,
              postId: value.post_id,
              from: value.from,
              reactionType: value.reaction_type,
            },
          };

          await env.EVENTS.put(id, JSON.stringify(evt), { expirationTtl: 2592000 });
          const unacked = await getUnackedList(env);
          unacked.push(id);
          await env.EVENTS.put('_unacked', JSON.stringify(unacked));
          console.log(`[FB] Reaction by ${value.from?.name || 'unknown'}`);
        }
      }
    }
  }

  return json({ ok: true });
}

// ── Helpers ─────────────────────────────────────────────────

async function getUnackedList(env) {
  const raw = await env.EVENTS.get('_unacked');
  return raw ? JSON.parse(raw) : [];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
