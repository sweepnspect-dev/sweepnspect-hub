const express = require('express');
const router = express.Router();

function store(req) { return req.app.locals.jsonStore('marketing.json'); }

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

module.exports = router;
