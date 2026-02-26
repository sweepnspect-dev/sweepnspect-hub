# SweepNspect Hub — JAMstack Migration Design

**Date:** 2026-02-25
**Status:** Approved
**Author:** Cody (Claude Opus) + Jonathan

## Problem

The SweepNspect Hub runs as a Node.js Express server on Jonathan's laptop. It must be manually started (`node server.js`), is only accessible locally or via ngrok, and goes offline when the laptop sleeps. For a 24/7 business operations dashboard, this is unacceptable.

## Decision

Migrate to JAMstack: **GitHub Pages** (static dashboard) + **Cloudflare Workers** (API) + **KV** (storage).

### Why This Architecture

- **GitHub Pages** — free, always up (even if Cloudflare has issues), auto-deploys on push
- **Cloudflare Workers** — already running the webhook worker, free tier covers our volume
- **KV** — already provisioned (namespace EVENTS), fast reads, adequate for < 1000 records
- **No server to maintain** — zero DevOps, zero monthly cost

### Alternatives Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A: Single Worker + KV** | Simplest, free, already partly built | 5s polling instead of WebSocket | **Selected** |
| B: Worker + Durable Objects | Real-time WebSocket support | $5/mo, overkill for solo user | Rejected |
| C: Worker + D1 (SQL) | Complex queries, joins | D1 still beta, more migration work | Rejected |

5-second polling is indistinguishable from WebSocket at this scale (one user, < 100 records).

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────────────┐
│   GitHub Pages      │     │   Cloudflare Worker              │
│   (Static SPA)      │────▶│   sweepnspect-webhook            │
│                     │     │                                  │
│   index.html        │     │   GET  /api/stats                │
│   dashboard.js      │     │   GET  /api/tickets              │
│   tickets.js        │     │   POST /api/tickets              │
│   subscribers.js    │     │   PUT  /api/tickets/:id          │
│   alerts.js         │     │   GET  /api/subscribers          │
│   inbox.js          │     │   POST /api/subscribers          │
│   revenue.js        │     │   GET  /api/alerts               │
│   commands.js       │     │   POST /api/alerts/:id/ack       │
│   styles.css        │     │   GET  /api/revenue              │
│                     │     │   GET  /api/inbox                │
│   Polls /api/stats  │     │   POST /api/webhooks/ticket      │
│   every 5 seconds   │     │   POST /api/webhooks/tawk        │
│                     │     │   POST /api/webhooks/facebook    │
└─────────────────────┘     │   POST /api/founding             │
                            │   GET  /api/tawk/status          │
┌─────────────────────┐     │   GET  /health                   │
│   External Sources  │────▶│                                  │
│   - Facebook        │     │   notifyTawk() → Resend API      │
│   - Tawk.to         │     │   notifySms()  → Twilio API      │
│   - Email (CF)      │     │                                  │
│   - Founding form   │     └──────────┬───────────────────────┘
│   - Website chat    │                │
└─────────────────────┘                ▼
                            ┌──────────────────────┐
                            │   Cloudflare KV      │
                            │   Namespace: EVENTS  │
                            │                      │
                            │   tickets:{id}       │
                            │   tickets:_index     │
                            │   subs:{id}          │
                            │   subs:_index        │
                            │   alerts:{id}        │
                            │   alerts:_index      │
                            │   revenue:{id}       │
                            │   revenue:_index     │
                            │   stats:latest       │
                            │   inbox:_latest      │
                            │   _cooldown:{type}   │
                            └──────────────────────┘

┌─────────────────────┐
│   Cloudflare Email  │
│   Workers           │──▶ contact@sweepnspect.com
│   (replaces IMAP)   │    inbound → parse → KV + alert
└─────────────────────┘

┌─────────────────────┐
│   Cloudflare Web    │
│   Analytics         │──▶ Beacon on sweepnspect.com
│   (already live)    │    Dashboard embeds analytics data
└─────────────────────┘
```

## KV Schema

All data stored in the existing `EVENTS` KV namespace.

```
Key Pattern              Value                           TTL
─────────────────────────────────────────────────────────────
tickets:{id}             Full ticket JSON                 none
tickets:_index           [{id, status, priority, date}]   none
subs:{id}                Full subscriber JSON             none
subs:_index              [{id, name, email, status}]      none
alerts:{id}              Full alert JSON                  30 days
alerts:_index            [{id, type, severity, ts, ack}]  none
revenue:{id}             Revenue entry JSON               none
revenue:_index           [{id, date, amount, type}]       none
stats:latest             Computed stats snapshot           none
inbox:_latest            Last 50 email events             none
_cooldown:{type}         Timestamp string                 10 min
founding:{id}            Application JSON                 90 days (existing)
event:{id}               Webhook event JSON               90 days (existing)
```

**Index pattern:** Lightweight `_index` keys contain just enough fields for list views. Full records fetched by ID on detail views. This avoids KV's 25MB value limit and keeps list reads fast.

**Stats computation:** `stats:latest` is recomputed on every write operation (ticket create/update, subscriber change, etc.) by reading the indexes. Cached for 5s on reads.

## Component Mapping

### API Routes (server.js → Worker)

| Current (Express)          | Worker Endpoint              | Data Source    |
|----------------------------|------------------------------|----------------|
| `routes/tickets.js`        | `GET/POST/PUT /api/tickets`  | KV tickets:*   |
| `routes/subscribers.js`    | `GET/POST/PUT /api/subscribers` | KV subs:*   |
| `routes/revenue.js`        | `GET /api/revenue`           | KV revenue:*   |
| `routes/inbox.js`          | `GET /api/inbox`             | KV inbox:*     |
| `routes/webhooks.js`       | Already in Worker            | —              |
| `routes/tawk.js`           | Already in Worker            | —              |
| `routes/commands.js`       | `POST /api/commands`         | Direct action  |
| `routes/marketing.js`      | `GET /api/marketing/stats`   | KV computed    |
| `routes/ai.js`             | Defer (Clauser integration)  | —              |
| `routes/clauser.js`        | Defer (local-only feature)   | —              |
| Alert API (server.js)      | `GET/POST /api/alerts`       | KV alerts:*    |
| Stats (server.js)          | `GET /api/stats`             | KV stats:latest|

### Library Modules

| Current Module           | Replacement                              |
|--------------------------|------------------------------------------|
| `lib/alert-router.js`   | Inline in Worker (persist→KV, notify→Resend/Twilio) |
| `lib/tawk-notifier.js`  | Already in Worker (`notifyTawk()`)       |
| `lib/email-poller.js`   | Cloudflare Email Workers                 |
| `lib/email-router.js`   | Inline classification in Email Worker    |
| `lib/worker-poller.js`  | Eliminated (Worker IS the source now)    |
| `lib/sms.js`            | Twilio API via `fetch()` in Worker       |

### Dashboard Views (public/ → GitHub Pages)

| Current View            | Changes Needed                            |
|-------------------------|-------------------------------------------|
| `public/js/dashboard.js`| Replace `ws://` with `fetch()` polling    |
| `public/js/tickets.js`  | Point API calls to Worker URL             |
| `public/js/subscribers.js` | Point API calls to Worker URL          |
| `public/js/alerts.js`   | Point API calls to Worker URL             |
| `public/js/inbox.js`    | Point API calls to Worker URL             |
| `public/js/revenue.js`  | Point API calls to Worker URL             |
| `public/js/commands.js` | Point API calls to Worker URL             |
| `public/index.html`     | Add API base URL config                   |
| `public/css/style.css`  | No changes                                |

### Email Replacement

**Current:** IMAP polling every 60s against contact@sweepnspect.com via `lib/email-poller.js`

**Target:** Cloudflare Email Workers
- Add MX record for sweepnspect.com pointing to Cloudflare
- Email Worker receives inbound mail, parses headers/body
- Classifies (founding, bug, support, spam) using same logic as `email-router.js`
- Stores in KV (`inbox:_latest`), fires alert via `notifyTawk()`
- Outbound replies via Resend API (already working)

### WebSocket Replacement

**Current:** WebSocket at `/ws`, broadcasts stats every 5s, real-time ticket/alert updates

**Target:** HTTP polling
- Dashboard calls `GET /api/stats` every 5 seconds
- Response includes: inbox counts, ticket counts, subscriber counts, revenue, alert summary
- Individual views fetch their own data on mount and on 5s interval
- Same user experience — one user, 5s delay is imperceptible

### Analytics Integration

**Cloudflare Web Analytics** (already live on sweepnspect.com):
- Dashboard can embed analytics summary via Cloudflare GraphQL API
- Endpoint: `GET /api/analytics` → proxy to CF GraphQL, return pageviews/visitors/referrers
- Requires: Analytics API token (read-only, stored as Worker secret)
- Dashboard view: new `analytics.js` panel showing traffic trends

## Authentication

The current Hub has no auth (localhost only). For the public Worker API:

- **Simple bearer token** — `Authorization: Bearer <token>` header on all API requests
- Token stored as Worker secret (`HUB_API_TOKEN`)
- Dashboard stores token in localStorage after first entry
- Webhook endpoints (Facebook, Tawk, founding form) remain public (they have their own verification)

## CORS

- Worker allows `https://sweepnspect-dev.github.io` and `https://sweepnspect.com`
- Existing CORS logic in Worker already handles origins

## Migration Sequence

### Phase 1: KV Data Layer
- Implement CRUD helpers for KV (get, put, list, delete with index management)
- Migrate ticket, subscriber, alert, revenue endpoints to Worker
- Seed KV with current JSON file data
- Add stats computation from KV indexes

### Phase 2: Dashboard on GitHub Pages
- Create new repo or use existing `sweepnspect-website` repo (subfolder `/hub/`)
- Adapt all view JS files to call Worker API instead of relative paths
- Replace WebSocket connection with 5s polling
- Add API base URL configuration and auth token entry
- Deploy to GitHub Pages

### Phase 3: Email Workers
- Configure Cloudflare Email routing for sweepnspect.com
- Create Email Worker that parses inbound mail → KV + alerts
- Port classification logic from `email-router.js`
- Outbound replies already use Resend API

### Phase 4: Notifications & SMS
- Port SMS batching logic to Worker (Twilio `fetch()`)
- Tawk notifications already working (`notifyTawk()`)
- Add configurable alert rules in KV

### Phase 5: Analytics & Polish
- Add Cloudflare Web Analytics API proxy endpoint
- Dashboard analytics panel
- Remove deprecated Hub server code
- Update deploy docs

## What Gets Deferred

- **AI/Clauser integration** (`routes/ai.js`, `routes/clauser.js`) — these are local-only features that depend on the Clauser app running. They'll remain as optional local-mode features.
- **Real-time push** — polling is fine for now. Durable Objects can be added later if needed.
- **Complex email threading** — initial Email Worker will handle inbound classification and storage, not full thread management.

## Success Criteria

1. Dashboard loads from GitHub Pages with no local server running
2. All CRUD operations (tickets, subscribers, alerts) work against Worker API
3. Founding form submissions appear in dashboard within 30 seconds
4. High-priority events trigger Tawk.to push notifications
5. Inbound emails to contact@sweepnspect.com are captured and classified
6. Analytics data visible in dashboard
7. Total monthly cost: $0 (free tiers)
