# SweepNspect Command Center — Hub Remodel Design

**Date:** 2026-02-26
**Author:** Cody (Claude Opus)
**Status:** Approved

## Problem

Current hub is 7 disconnected desktop-first views. Communications split across email/Tawk/FB. No Fold optimization. Analytics buried. Claude sync invisible. Mobile unusable.

## Solution

Unified command center with responsive navigation, unified communications, Galaxy Fold optimization, and full integration of all SweepNspect connections.

## Navigation Architecture

### 4 Responsive Breakpoints

| Breakpoint | Screen | Nav Pattern | Content |
|---|---|---|---|
| < 768px | Phone | Bottom tab bar (5 + overflow) | Single column |
| 768-900px | Fold closed / small tablet | Bottom tab bar (all 8) | Single column, larger |
| 900-1400px | Fold open / tablet | Icon rail (56px left) | Master-detail splits |
| 1400px+ | Desktop | Full sidebar (220px) | Master-detail splits |

### 8 Views

1. **Home** — Dashboard KPIs, activity feed, alerts, AI chat
2. **Comms** — Unified: Email + Tawk + FB + Claude Sync
3. **Tickets** — Support tickets, crash reports, AI analysis
4. **Customers** — Subscribers, Founding 25, pipeline
5. **Revenue** — MRR, transactions, financial tracking
6. **Tasks** — To-dos, schedule, reminders (upgraded Commands)
7. **Analytics** — Cloudflare Web Analytics, app metrics, campaigns
8. **System** — Hive relay, T/Z status, Clauser agent, service health

## Comms View (Unified Communications)

### Stream Layout
All communication channels in one chronological feed:
- Email (IMAP) — source badge: blue
- Tawk.to chat — source badge: green
- Facebook — source badge: blue-dark
- Claude Sync — source badge: purple

### Features
- Filter by source channel
- Search across all channels
- Click to expand conversation thread
- Reply inline (routed to correct transport)
- Contact grouping (same person across channels)

### Responsive
- Phone: full-width stream, tap to open detail (pushes)
- Fold open: split view — stream left (380px), detail right
- Desktop: same as fold open

## Galaxy Fold Optimization

### Detection
```css
/* Fold closed (cover screen) */
@media (max-width: 900px) { ... }

/* Fold open (inner screen ~1812px logical) */
@media (min-width: 900px) and (max-width: 1400px) { ... }
```

### Fold Open Layout
- 56px icon rail with tooltip labels
- Badge counts on rail icons
- Content fills remaining width
- All list views become master-detail splits
- 4-column stat grid on Home
- Side-by-side panels

### Fold Closed Layout
- Bottom tab bar (thumb-reachable)
- Compact card-based views
- Swipe-friendly
- Large touch targets (48px min)

## Backend Additions

### New API Endpoints (HQ Server)
```
GET  /api/relay/status     → proxy localhost:4747/health
GET  /api/relay/messages   → proxy localhost:4747/msg/history?last=50
POST /api/relay/send       → proxy localhost:4747/msg (from: 'hub')
GET  /api/system/health    → aggregate all service statuses
```

### New WebSocket Events
```
relay:message     → new message via relay
relay:heartbeat   → T/Z node status change
system:health     → periodic mesh health check (60s)
```

### New Server Module
```
lib/relay-bridge.js  — polls relay /heartbeat every 30s, proxies messages
```

## Design System Extensions

### New CSS Variables
```css
--rail-w: 56px;          /* Icon rail width (fold open) */
--tab-h: 56px;           /* Bottom tab bar height (mobile) */
--split-list-w: 380px;   /* Master list width in split views */
```

### What Stays
- Black Collar palette (navy/brick/brass/cream)
- Stat cards, ticket list, alert system
- AI chat widget, toast notifications
- WebSocket client, IndexedDB caching
- Modal system, badge system

### What Changes
- Navigation: sidebar → responsive (tabs/rail/sidebar)
- Inbox → Comms (unified all channels)
- Commands → Tasks (priority, due dates, drag reorder)
- Marketing → Analytics (promoted to first-class)
- New System view
- Mobile-first responsive grid
- Fold-aware layouts

## Implementation Sequence

### Phase 1: Foundation (navigation + layout)
1. New responsive shell (tabs / rail / sidebar)
2. View router with responsive detection
3. Fold-aware CSS grid system

### Phase 2: Views (port + upgrade each view)
4. Home dashboard (port + responsive)
5. Comms unified view (new — biggest piece)
6. Tickets (port + mobile layout)
7. Customers (port + card/table toggle)
8. Revenue (port + sparklines)
9. Tasks (rewrite from Commands)
10. Analytics (promote from Marketing)
11. System (new — relay/device/agent status)

### Phase 3: Backend
12. Relay bridge (proxy endpoints + polling)
13. System health aggregator
14. Comms message normalization (email/tawk/fb → unified format)

### Phase 4: Polish
15. Fold open/closed transitions
16. Swipe gestures on mobile
17. Loading states + skeleton screens
18. Service worker for offline support
