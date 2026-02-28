# Tawk.to Removal + AI Proxy Optimization

**Date:** 2026-02-28
**Status:** Approved

## Part 1: Purge Tawk.to

Complete removal — no historical data retention.

### Files to Delete
- `routes/tawk.js`
- `data/comms-tawk.json`

### Files to Modify

| File | Change |
|------|--------|
| `server.js` | Remove route mount (L117), `/api/tawk/status` endpoint (L148-150), `comms-tawk` from DATA_STORES (L316) |
| `routes/comms.js` | Remove GET/POST `/comms/tawk` routes, remove tawk from stats endpoint |
| `lib/worker-poller.js` | Remove `_archiveTawk()` helper + calls in `_handleTicketCreate`/`_handleChatStart`. Remove `tawk:message` broadcast. Change source `'tawk-chat'` → `'chat'` |
| `lib/email-router.js` | Remove `tawk` category, keyword rules, sender patterns, bracket maps. Reclassify chat emails → `livechat` |
| `public/js/views/comms.js` | Remove Tawk tab, `comms/tawk` API call, tawk data normalization, `renderTawkDetail()`, tawk email cross-routing |
| `public/js/views/system.js` | Remove Tawk.to Bridge service card |
| `routes/subscribers.js` | Remove tawk comms aggregation from care endpoint |
| `routes/ai.js` | Remove tawk message reads from AI context |

## Part 2: AI Proxy Optimization

### Problem
`exec()` + `cmd.exe` + temp file + `type` pipe = 45-60s per response.

### Solution
Replace with `spawn()` + direct stdin pipe:
- Eliminate cmd.exe shell startup
- Eliminate temp file I/O
- Pipe prompt directly to claude stdin

### Expected Result
~15-25s response time (down from 45-60s).
