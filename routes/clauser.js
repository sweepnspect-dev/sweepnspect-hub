const express = require('express');
const router = express.Router();

// ── Clauser Agent State ─────────────────────────────────
let clauserState = {
  status: 'offline',      // online, working, paused, offline
  currentTask: null,
  ticketsProcessed: 0,
  lastHeartbeat: null,
  startedAt: null,
  activities: []
};

const HEARTBEAT_TIMEOUT = 45000; // 45s — agent sends every 15s

function isOnline() {
  if (!clauserState.lastHeartbeat) return false;
  return (Date.now() - clauserState.lastHeartbeat) < HEARTBEAT_TIMEOUT;
}

function getStatus() {
  const online = isOnline();
  return {
    status: online ? clauserState.status : 'offline',
    currentTask: online ? clauserState.currentTask : null,
    ticketsProcessed: clauserState.ticketsProcessed,
    uptime: clauserState.startedAt && online
      ? Math.floor((Date.now() - clauserState.startedAt) / 1000)
      : 0,
    lastHeartbeat: clauserState.lastHeartbeat,
    activities: clauserState.activities.slice(0, 20)
  };
}

// GET /api/clauser/status
router.get('/status', (req, res) => {
  res.json(getStatus());
});

// POST /api/clauser/heartbeat — agent pushes state every 15s
router.post('/heartbeat', (req, res) => {
  const { status, currentTask, ticketsProcessed } = req.body;

  if (!clauserState.startedAt && status !== 'offline') {
    clauserState.startedAt = Date.now();
  }

  clauserState.status = status || 'online';
  clauserState.currentTask = currentTask || null;
  clauserState.lastHeartbeat = Date.now();

  if (typeof ticketsProcessed === 'number') {
    clauserState.ticketsProcessed = ticketsProcessed;
  }

  // Broadcast to all WS clients
  const broadcast = req.app.locals.broadcast;
  if (broadcast) {
    broadcast({ type: 'clauser:status', data: getStatus() });
  }

  res.json({ ok: true });
});

// POST /api/clauser/activity — agent posts activity feed items
router.post('/activity', (req, res) => {
  const { text, icon } = req.body;
  const entry = {
    text: text || 'Clauser activity',
    icon: icon || 'status',
    time: new Date().toISOString(),
    from: 'clauser'
  };

  clauserState.activities.unshift(entry);
  if (clauserState.activities.length > 50) clauserState.activities.length = 50;

  // Broadcast as general activity too
  const broadcast = req.app.locals.broadcast;
  if (broadcast) {
    broadcast({ type: 'activity', data: entry });
  }

  res.json({ ok: true });
});

module.exports = router;
module.exports.isOnline = isOnline;
module.exports.getStatus = getStatus;
