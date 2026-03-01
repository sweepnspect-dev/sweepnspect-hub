# Hub High-Impact Features — Design

## Context
SweepNspect Hub manages the SweepNspect app post-launch. Five gaps identified for launch readiness: subscriber pipeline, outbound comms, bug/feature tracking, marketing campaigns, global search.

## Architecture
All features follow existing patterns: JSON file storage, Express routes, vanilla JS views, WebSocket broadcast. No database migration.

---

## 1. Subscriber Pipeline

**Webhook**: `POST /api/webhooks/signup`
- Body: `{ name, email, phone?, plan?, source? }`
- Creates subscriber with `status: 'trial'`, `trialEndsAt: +14 days`
- Fires alert: `subscriber:new` → phone notification + activity feed
- If email matches existing subscriber, updates instead of duplicating

**Lifecycle**: `lead` → `trial` → `active` → `churned`

**Data** (`subscribers.json`):
```json
{ "id": "s-001", "name": "", "email": "", "phone": "", "plan": "trial",
  "mrr": 0, "status": "trial", "source": "website",
  "startDate": "ISO", "trialEndsAt": "ISO" }
```

**Files**: `routes/subscribers.js` (add webhook handling), `server.js` (mount webhook)

---

## 2. Outbound Comms

**SMS Compose**: New section in Comms view
- Pick subscriber from dropdown or type number
- Compose message, send via `smsService` (Twilio)
- Log to `comms-sms.json` with `direction: 'outbound'`

**Email Compose**: Standalone compose (not reply-to)
- Pick subscriber or type email
- Subject + body, send via existing SMTP
- Log to new `comms-email-sent.json`

**Broadcast**: Segment selector + channel + message
- Segments: all-active, all-trials, all-subscribers
- Channels: email, sms
- Queued sends with progress tracking
- Log each send individually

**New endpoint**: `POST /api/comms/send` — `{ channel: 'sms'|'email', to, subject?, message }`
**New endpoint**: `POST /api/comms/broadcast` — `{ segment, channel, subject?, message }`

**Files**: `routes/comms.js` (new), `public/js/views/comms.js` (compose UI), `data/comms-email-sent.json`

---

## 3. Tickets as Bug/Feature Tracker

**New field**: `category: 'bug' | 'feature-request' | 'question' | 'support'`

**Webhook**: `POST /api/webhooks/feedback`
- Body: `{ email, category, subject, description, appVersion?, deviceInfo? }`
- Auto-links to subscriber by email match
- Priority auto-bumps: active subscriber → high, trial → normal, unknown → low

**Tickets view updates**:
- Filter tabs: All | Bugs | Features | Questions
- Category badge on each ticket card
- Device/version info shown in detail view

**Email auto-categorization**: Keywords in subject → auto-assign category
- "bug", "broken", "crash", "error" → bug
- "feature", "request", "wish", "add" → feature-request
- "how", "help", "?" → question

**Files**: `routes/tickets.js` (add category, webhook), `public/js/views/tickets.js` (filter tabs, category badge)

---

## 4. Marketing Campaigns

**Data** (`data/campaigns.json`):
```json
{
  "id": "camp-001",
  "name": "Launch Announcement",
  "status": "draft|scheduled|running|completed",
  "channels": {
    "facebook": { "message": "", "imageUrl": "", "scheduled": false },
    "email": { "subject": "", "body": "", "segment": "all-active" },
    "sms": { "message": "", "segment": "all-active" }
  },
  "scheduledFor": "ISO",
  "results": { "fbReach": 0, "emailsSent": 0, "smsSent": 0 },
  "createdAt": "ISO"
}
```

**Campaign builder**: New tab in Marketing view
- Name the campaign
- Toggle channels on/off, write content per channel
- Schedule or send now
- Results dashboard after send

**Execution**: When campaign fires:
1. FB post → existing `facebookService.publish()`
2. Email blast → loop subscribers in segment, send via SMTP
3. SMS blast → loop subscribers with phone, send via smsService

**Files**: `routes/marketing.js` (campaign CRUD + execute), `public/js/views/marketing.js` (campaign builder), `data/campaigns.json`

---

## 5. Global Search

**Endpoint**: `GET /api/search?q=term`

**Scans** (in-memory, all at once):
- `subscribers.json` — name, email, phone
- `tickets.json` — subject, description, customer.name, customer.email
- `comms-sms.json` — from, to, message
- `comms-email-sent.json` — to, subject, body
- `livechat-sessions.json` — visitor.name, visitor.email, messages[].text
- `marketing-posts.json` — message

**Response**:
```json
{
  "results": [
    { "type": "subscriber", "id": "s-001", "title": "John Doe", "subtitle": "john@example.com", "match": "matched field text" },
    { "type": "ticket", "id": "t-003", "title": "App crashes on login", "subtitle": "bug — high", "match": "..." }
  ],
  "total": 12
}
```

**Frontend**: Search input in topbar, dropdown results panel, click → navigate to `#view/id`

**Files**: `routes/search.js` (new), `server.js` (mount), `public/js/app.js` (search bar + results dropdown), `public/css/hub.css` (search styles)

---

## Implementation Order

1. Subscriber Pipeline (webhook + lifecycle) — data foundation
2. Tickets enhancement (category + feedback webhook) — quick win
3. Outbound Comms (SMS/email compose + broadcast) — core need
4. Global Search (endpoint + topbar UI) — quality of life
5. Marketing Campaigns (campaign builder + execution) — launch tooling
