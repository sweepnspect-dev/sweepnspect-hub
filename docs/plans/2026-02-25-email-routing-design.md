# Email Routing System — Design Document

**Date:** 2026-02-25
**Status:** Approved
**Scope:** Subject-based email classification, auto-record creation, inbox UI upgrades

## Overview

All SweepNspect systems route through one email address: `contact@sweepnspect.com`. The routing engine classifies inbound email by subject prefix (primary) or keyword matching (fallback), then either auto-creates records in the HQ or tags for manual handling.

## Classification Strategy

### Primary: Bracket Prefix (form-generated)

Forms we control set exact subject prefixes:

| Prefix | Example Subject |
|---|---|
| `[TICKET]` | `[TICKET] Can't sync inspection data` |
| `[BUG]` | `[BUG] Camera won't open in Zone editor` |
| `[FOUNDING]` | `[FOUNDING] Morrison Chimney Services` |
| `[BILLING]` | `[BILLING] Payment declined` |
| `[FEATURE]` | `[FEATURE] PDF export for reports` |
| `[DEMO]` | `[DEMO] Sarah Chen — ProSweep LLC` |
| `[REFERRAL]` | `[REFERRAL] Jake Morrison → Tom's Sweeps` |
| `[CONTACT]` | `[CONTACT] Mike Johnson` |
| `[PARTNER]` | `[PARTNER] ChimneySaver Solutions` |

### Fallback: Keyword Matching (organic email)

When no bracket prefix is found, match against subject + sender:

| Keywords | Routes to |
|---|---|
| bug, crash, broken, error | `bug` |
| founding, application | `founding` |
| billing, payment, invoice, refund, subscription cancel | `billing` |
| feature, request, wish, suggestion | `feature` |
| demo, trial, try | `demo` |
| referr | `referral` |
| partner, integration, wholesale, reseller | `partner` |
| ticket, support, help | `ticket` |

### System/Spam Detection

Known system senders (noreply@, formsubmit confirmations, newsletters) are auto-classified as `system`. Unmatched email defaults to `contact`.

## Categories

### Auto-Create Records

| Category | Severity | Creates | Details |
|---|---|---|---|
| `ticket` | NORMAL | Ticket (priority: normal) | Parsed customer name/email from body |
| `bug` | HIGH | Ticket (priority: high, source: email-bug) | Attempts to parse device/version info |
| `founding` | HIGH | Subscriber (status: pending) | Parsed name, email, business from body |
| `billing` | CRITICAL | Ticket (priority: critical, source: email-billing) | Fastest response path |

### Tag Only

| Category | Severity | Details |
|---|---|---|
| `demo` | HIGH | Hot lead, manual response |
| `referral` | NORMAL | Link to referrer if identifiable |
| `feature` | LOW | Batch review |
| `contact` | LOW | General inquiry, default |
| `partner` | LOW | Business proposals |

### Auto-Archive

| Category | Severity | Details |
|---|---|---|
| `system` | NONE | FormSubmit confirmations, service notifications, spam |

## Alert Behavior

- **CRITICAL** (billing): Toast + SMS + dashboard badge
- **HIGH** (bug, founding, demo): Toast + dashboard badge
- **NORMAL** (ticket, referral): Dashboard badge only
- **LOW** (feature, contact, partner): Inbox tag only
- **NONE** (system): Silently archived

## Inbox UI Changes

- Color-coded category tags (one per category, distinct colors)
- Filter bar to show/hide by category
- Auto-archive toggle for system emails
- Route badge on email detail showing classification + linked record
- Status bar breakdown: `3 tickets - 1 founding - 2 contact - 5 archived`

## Dashboard Integration

- `getStats().inbox.byCategory` — count per category
- Activity feed entries prefixed with category
- "Needs Attention" surfaces unread critical/high emails

## File Changes

| File | Change |
|---|---|
| `lib/email-router.js` | NEW — Classification engine + auto-create |
| `lib/email-poller.js` | Modified — route emails through classifier |
| `routes/inbox.js` | Modified — filter endpoint, archive toggle |
| `routes/tickets.js` | Modified — accept email-sourced tickets |
| `routes/subscribers.js` | Modified — accept pending status |
| `public/js/views/inbox.js` | Modified — tags, filters, archive, route badge |
| `public/css/hub.css` | Modified — category colors, filter bar |
| `server.js` | Modified — stats include category breakdown |
