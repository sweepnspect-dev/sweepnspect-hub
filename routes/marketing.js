const express = require('express');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('marketing.json'); }
function postStore(req) { return req.app.locals.jsonStore('marketing-posts.json'); }
function fb(req) { return req.app.locals.facebookService; }
function broadcast(req) { return req.app.locals.broadcast; }

// ── Existing analytics/campaign endpoints ────────────────────────────

// GET /api/marketing — full marketing data
router.get('/', (req, res) => {
  const data = store(req).read();
  res.json(data);
});

// GET /api/marketing/website — website analytics only
router.get('/website', (req, res) => {
  const data = store(req).read();
  res.json(data.website || {});
});

// GET /api/marketing/app — app analytics only
router.get('/app', (req, res) => {
  const data = store(req).read();
  res.json(data.app || {});
});

// GET /api/marketing/campaigns — campaigns list
router.get('/campaigns', (req, res) => {
  const data = store(req).read();
  res.json(data.campaigns || []);
});

// PUT /api/marketing/campaigns/:index — update a campaign
router.put('/campaigns/:index', (req, res) => {
  const data = store(req).read();
  const idx = parseInt(req.params.index);
  if (!data.campaigns || !data.campaigns[idx]) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const allowed = ['name', 'status', 'spent', 'leads', 'conversions', 'roi'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) data.campaigns[idx][key] = req.body[key];
  }
  store(req).write(data);
  res.json(data.campaigns[idx]);
});

// ── Facebook Page Info ───────────────────────────────────────────────

router.get('/page', async (req, res) => {
  const result = await fb(req).getPageInfo();
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json(result.data);
});

// ── Posts CRUD ────────────────────────────────────────────────────────

// GET /api/marketing/posts — list all local posts
router.get('/posts', (req, res) => {
  const posts = postStore(req).read();
  res.json(posts);
});

// POST /api/marketing/posts — create post (draft, publish, or schedule)
router.post('/posts', async (req, res) => {
  const { message, link, status, scheduledFor } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  const ps = postStore(req);
  const now = new Date().toISOString();
  const post = {
    id: ps.nextId('mp'),
    fbPostId: null,
    platform: 'facebook',
    status: 'draft',
    message: message.trim(),
    link: link || '',
    imageUrl: '',
    scheduledFor: null,
    publishedAt: null,
    engagement: { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 },
    createdAt: now,
    updatedAt: now
  };

  if (status === 'publish') {
    const result = await fb(req).createPost(post.message, post.link || undefined);
    if (!result.ok) {
      post.status = 'failed';
      post.lastError = result.error;
    } else {
      post.status = 'published';
      post.fbPostId = result.data.id;
      post.publishedAt = now;
    }
  } else if (status === 'schedule') {
    if (!scheduledFor) return res.status(400).json({ error: 'scheduledFor is required for scheduling' });
    post.status = 'scheduled';
    post.scheduledFor = scheduledFor;
  }

  const posts = ps.read();
  posts.unshift(post);
  ps.write(posts);

  broadcast(req)({ type: 'marketing:post-created', data: post });
  res.status(201).json(post);
});

// PUT /api/marketing/posts/:id — update draft or scheduled post
router.put('/posts/:id', (req, res) => {
  const ps = postStore(req);
  const posts = ps.read();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const post = posts[idx];
  if (post.status !== 'draft' && post.status !== 'scheduled') {
    return res.status(400).json({ error: 'Can only edit draft or scheduled posts' });
  }

  const allowed = ['message', 'link', 'status', 'scheduledFor'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) post[key] = req.body[key];
  }
  post.updatedAt = new Date().toISOString();
  posts[idx] = post;
  ps.write(posts);
  res.json(post);
});

// DELETE /api/marketing/posts/:id — delete locally + from FB if published
router.delete('/posts/:id', async (req, res) => {
  const ps = postStore(req);
  const posts = ps.read();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const post = posts[idx];
  if (post.fbPostId && post.status === 'published') {
    const result = await fb(req).deletePost(post.fbPostId);
    if (!result.ok) {
      return res.status(502).json({ error: `FB delete failed: ${result.error}` });
    }
  }

  posts.splice(idx, 1);
  ps.write(posts);
  broadcast(req)({ type: 'marketing:post-deleted', data: { id: post.id } });
  res.json({ deleted: true });
});

// POST /api/marketing/posts/:id/publish — publish a draft now
router.post('/posts/:id/publish', async (req, res) => {
  const ps = postStore(req);
  const posts = ps.read();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const post = posts[idx];
  if (post.status !== 'draft' && post.status !== 'scheduled') {
    return res.status(400).json({ error: 'Post is already published or failed' });
  }

  const result = await fb(req).createPost(post.message, post.link || undefined);
  if (!result.ok) {
    post.status = 'failed';
    post.lastError = result.error;
    post.updatedAt = new Date().toISOString();
    posts[idx] = post;
    ps.write(posts);
    return res.status(502).json({ error: result.error, post });
  }

  post.status = 'published';
  post.fbPostId = result.data.id;
  post.publishedAt = new Date().toISOString();
  post.updatedAt = post.publishedAt;
  posts[idx] = post;
  ps.write(posts);

  broadcast(req)({ type: 'marketing:post-published', data: post });
  res.json(post);
});

// GET /api/marketing/posts/:id/insights — fetch fresh engagement from FB
router.get('/posts/:id/insights', async (req, res) => {
  const ps = postStore(req);
  const posts = ps.read();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const post = posts[idx];
  if (!post.fbPostId) return res.status(400).json({ error: 'Post not published to Facebook' });

  const result = await fb(req).getPostInsights(post.fbPostId);
  if (!result.ok) return res.status(502).json({ error: result.error });

  // Parse insights from Graph API response
  if (result.data.insights && result.data.insights.data) {
    for (const metric of result.data.insights.data) {
      const val = metric.values && metric.values[0] ? metric.values[0].value : 0;
      if (metric.name === 'post_impressions') post.engagement.impressions = val;
      if (metric.name === 'post_reach') post.engagement.reach = val;
      if (metric.name === 'post_engaged_users') post.engagement.engagedUsers = val;
    }
  }
  post.updatedAt = new Date().toISOString();
  posts[idx] = post;
  ps.write(posts);

  res.json(post);
});

// ── Sync from Facebook ───────────────────────────────────────────────

router.post('/sync', async (req, res) => {
  const result = await fb(req).getPagePosts(50);
  if (!result.ok) return res.status(502).json({ error: result.error });

  const ps = postStore(req);
  const posts = ps.read();
  const existingFbIds = new Set(posts.filter(p => p.fbPostId).map(p => p.fbPostId));
  let added = 0;

  // Calculate next ID from current posts (avoid stale reads during loop)
  const existingNums = posts.map(p => { const m = p.id.match(/\d+$/); return m ? parseInt(m[0]) : 0; });
  let nextNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;

  const fbPosts = result.data.data || [];
  for (const fp of fbPosts) {
    if (existingFbIds.has(fp.id)) {
      // Update engagement on existing
      const existing = posts.find(p => p.fbPostId === fp.id);
      if (existing) {
        existing.engagement.likes = fp.likes?.summary?.total_count || 0;
        existing.engagement.comments = fp.comments?.summary?.total_count || 0;
        existing.engagement.shares = fp.shares?.count || 0;
        existing.updatedAt = new Date().toISOString();
      }
      continue;
    }

    posts.push({
      id: `mp-${String(nextNum++).padStart(3, '0')}`,
      fbPostId: fp.id,
      platform: 'facebook',
      status: 'published',
      message: fp.message || '',
      link: fp.permalink_url || '',
      imageUrl: fp.full_picture || '',
      scheduledFor: null,
      publishedAt: fp.created_time,
      engagement: {
        likes: fp.likes?.summary?.total_count || 0,
        comments: fp.comments?.summary?.total_count || 0,
        shares: fp.shares?.count || 0,
        reach: 0,
        impressions: 0
      },
      createdAt: fp.created_time,
      updatedAt: new Date().toISOString()
    });
    added++;
  }

  ps.write(posts);
  broadcast(req)({ type: 'marketing:synced', data: { added, total: posts.length } });
  res.json({ synced: true, added, total: posts.length });
});

// ── Campaigns CRUD ────────────────────────────────────────────

function campStore(req) { return req.app.locals.jsonStore('campaigns.json'); }

// List campaigns
router.get('/campaigns/list', (req, res) => {
  const campaigns = campStore(req).read();
  campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(campaigns);
});

// Create campaign
router.post('/campaigns/create', (req, res) => {
  const cs = campStore(req);
  const campaigns = cs.read();
  const now = new Date().toISOString();

  const campaign = {
    id: cs.nextId('camp'),
    name: req.body.name || 'Untitled Campaign',
    status: 'draft',
    channels: req.body.channels || {},
    scheduledFor: req.body.scheduledFor || null,
    results: { fbReach: 0, emailsSent: 0, smsSent: 0, emailsFailed: 0, smsFailed: 0 },
    createdAt: now,
    updatedAt: now,
  };

  campaigns.push(campaign);
  cs.write(campaigns);
  broadcast(req)({ type: 'marketing:campaign-created', data: campaign });
  res.status(201).json(campaign);
});

// Update campaign
router.put('/campaigns/:id', (req, res) => {
  const cs = campStore(req);
  const campaigns = cs.read();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Campaign not found' });

  const allowed = ['name', 'channels', 'scheduledFor', 'status'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) campaigns[idx][key] = req.body[key];
  }
  campaigns[idx].updatedAt = new Date().toISOString();
  cs.write(campaigns);
  res.json(campaigns[idx]);
});

// Delete campaign
router.delete('/campaigns/:id', (req, res) => {
  const cs = campStore(req);
  let campaigns = cs.read();
  campaigns = campaigns.filter(c => c.id !== req.params.id);
  cs.write(campaigns);
  broadcast(req)({ type: 'marketing:campaign-deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

// Execute campaign — fire all channels
router.post('/campaigns/:id/execute', async (req, res) => {
  const cs = campStore(req);
  const campaigns = cs.read();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Campaign not found' });

  const campaign = campaigns[idx];
  if (campaign.status === 'completed') return res.status(400).json({ error: 'Campaign already completed' });

  campaign.status = 'running';
  campaign.updatedAt = new Date().toISOString();
  cs.write(campaigns);

  const results = { fbReach: 0, emailsSent: 0, smsSent: 0, emailsFailed: 0, smsFailed: 0 };
  const ch = campaign.channels;

  // ── Facebook ──
  if (ch.facebook?.enabled && ch.facebook?.message) {
    try {
      const fbResult = await fb(req).createPost(ch.facebook.message, ch.facebook.link || undefined);
      if (fbResult.ok) {
        results.fbPostId = fbResult.data.id;
        // Also save as a marketing post
        const ps = postStore(req);
        const posts = ps.read();
        posts.unshift({
          id: ps.nextId('mp'),
          fbPostId: fbResult.data.id,
          platform: 'facebook',
          status: 'published',
          message: ch.facebook.message,
          link: ch.facebook.link || '',
          imageUrl: '',
          scheduledFor: null,
          publishedAt: new Date().toISOString(),
          engagement: { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          campaignId: campaign.id,
        });
        ps.write(posts);
      }
    } catch {}
  }

  // ── Email blast ──
  if (ch.email?.enabled && ch.email?.body) {
    const nodemailer = require('nodemailer');
    const poller = req.app.locals.emailPoller;
    if (poller) {
      try {
        const smtpConfig = poller.getSmtpConfig();
        const transport = nodemailer.createTransport(smtpConfig);
        const subs = req.app.locals.jsonStore('subscribers.json').read();
        let recipients = subs;
        if (ch.email.segment === 'active') recipients = subs.filter(s => s.status === 'active' || s.status === 'founding');
        else if (ch.email.segment === 'trial') recipients = subs.filter(s => s.status === 'trial');

        for (const sub of recipients) {
          if (!sub.email) { results.emailsFailed++; continue; }
          try {
            await transport.sendMail({
              from: `"SweepNspect" <${smtpConfig.auth.user}>`,
              to: sub.email,
              subject: ch.email.subject || campaign.name,
              text: ch.email.body,
            });
            results.emailsSent++;
          } catch { results.emailsFailed++; }
        }
      } catch {}
    }
  }

  // ── SMS blast ──
  if (ch.sms?.enabled && ch.sms?.message) {
    const smsService = req.app.locals.smsService;
    if (smsService?.twilioConfigured) {
      const https = require('https');
      const subs = req.app.locals.jsonStore('subscribers.json').read();
      let recipients = subs;
      if (ch.sms.segment === 'active') recipients = subs.filter(s => s.status === 'active' || s.status === 'founding');
      else if (ch.sms.segment === 'trial') recipients = subs.filter(s => s.status === 'trial');

      for (const sub of recipients) {
        if (!sub.phone) { results.smsFailed++; continue; }
        try {
          const body = new URLSearchParams({
            To: sub.phone, From: smsService.from, Body: ch.sms.message.slice(0, 1600)
          }).toString();
          await new Promise((resolve, reject) => {
            const options = {
              hostname: 'api.twilio.com', port: 443,
              path: `/2010-04-01/Accounts/${smsService.sid}/Messages.json`,
              method: 'POST', auth: `${smsService.sid}:${smsService.token}`,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
            };
            const r = https.request(options, (resp) => {
              let data = '';
              resp.on('data', c => data += c);
              resp.on('end', () => resp.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${resp.statusCode}`)));
            });
            r.on('error', reject);
            r.write(body);
            r.end();
          });
          results.smsSent++;
        } catch { results.smsFailed++; }
      }
    }
  }

  // Update campaign with results
  campaign.status = 'completed';
  campaign.results = results;
  campaign.executedAt = new Date().toISOString();
  campaign.updatedAt = campaign.executedAt;
  cs.write(campaigns);

  broadcast(req)({ type: 'marketing:campaign-executed', data: campaign });
  broadcast(req)({ type: 'activity', data: { icon: 'marketing', text: `Campaign "${campaign.name}" executed — ${results.emailsSent} emails, ${results.smsSent} SMS`, time: campaign.executedAt } });

  res.json({ ok: true, campaign });
});

module.exports = router;
