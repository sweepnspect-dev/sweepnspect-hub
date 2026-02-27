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

module.exports = router;
