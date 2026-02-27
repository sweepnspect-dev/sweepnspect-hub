// ── Tawk.to Webhook — DEPRECATED ──────────────────────────
// Kept for backwards compatibility if any Tawk webhooks still fire.
// Redirects to livechat system.
const router = require('express').Router();

router.post('/', (req, res) => {
  console.log('[TAWK] Deprecated webhook received — Tawk.to replaced by custom live chat');
  res.json({ ok: true, deprecated: true, note: 'Use /api/chat/* endpoints instead' });
});

router.get('/status', (req, res) => {
  res.json({ status: 'deprecated', note: 'Replaced by custom live chat system' });
});

module.exports = router;
