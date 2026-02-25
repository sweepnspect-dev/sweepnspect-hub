# Email Routing System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a subject-based email routing engine that classifies all inbound email to contact@sweepnspect.com, auto-creates tickets/subscribers for key categories, and upgrades the inbox UI with category tags, filters, and linked records.

**Architecture:** New `lib/email-router.js` classification engine sits between the email poller and existing systems. When the poller detects a new email, the router classifies it by bracket prefix or keyword fallback, fires alerts at the right severity, and auto-creates tickets or subscriber records through the existing route handlers. The inbox frontend gets category-colored tags, a filter bar, and archive toggle.

**Tech Stack:** Node.js/Express, ImapFlow (existing), JSON file storage (existing), vanilla JS frontend (existing)

---

## Task 1: Create the Email Router — Classification Engine

**Files:**
- Create: `lib/email-router.js`

**Step 1: Create `lib/email-router.js` with the full classification engine**

```javascript
// ── Email Router — Subject-Based Classification ──────────
//
// Classifies inbound email by:
//   1. Bracket prefix: [TICKET], [BUG], [FOUNDING], etc.
//   2. Keyword fallback: subject + sender matching
//   3. System/spam detection: noreply senders, known automated mail
//   4. Default: 'contact'
//
// Each email gets a route object: { category, severity, autoCreate, source }

const CATEGORIES = {
  ticket:   { severity: 'normal',   autoCreate: 'ticket',     label: 'TICKET',   cls: 'tag-ticket' },
  bug:      { severity: 'high',     autoCreate: 'ticket',     label: 'BUG',      cls: 'tag-bug' },
  founding: { severity: 'high',     autoCreate: 'subscriber', label: 'FOUNDING', cls: 'tag-founding' },
  billing:  { severity: 'critical', autoCreate: 'ticket',     label: 'BILLING',  cls: 'tag-billing' },
  feature:  { severity: 'low',      autoCreate: null,         label: 'FEATURE',  cls: 'tag-feature' },
  demo:     { severity: 'high',     autoCreate: null,         label: 'DEMO',     cls: 'tag-demo' },
  referral: { severity: 'normal',   autoCreate: null,         label: 'REFERRAL', cls: 'tag-referral' },
  contact:  { severity: 'low',      autoCreate: null,         label: 'CONTACT',  cls: 'tag-contact' },
  partner:  { severity: 'low',      autoCreate: null,         label: 'PARTNER',  cls: 'tag-partner' },
  system:   { severity: 'none',     autoCreate: null,         label: 'SYSTEM',   cls: 'tag-system' },
};

// Bracket prefix patterns — checked first (case-insensitive)
const PREFIX_RE = /^\[(\w+)\]\s*/i;

// Keyword fallback — checked when no prefix found
const KEYWORD_MAP = [
  { keywords: ['bug', 'crash', 'broken', 'error'],                          category: 'bug' },
  { keywords: ['founding', 'application'],                                   category: 'founding' },
  { keywords: ['billing', 'payment', 'invoice', 'refund', 'subscription cancel'], category: 'billing' },
  { keywords: ['feature', 'request', 'wish', 'suggestion'],                 category: 'feature' },
  { keywords: ['demo', 'trial'],                                            category: 'demo' },
  { keywords: ['referr'],                                                    category: 'referral' },
  { keywords: ['partner', 'integration', 'wholesale', 'reseller'],          category: 'partner' },
  { keywords: ['ticket', 'support', 'help'],                                category: 'ticket' },
];

// Known system/automated senders
const SYSTEM_SENDERS = [
  /noreply@/i,
  /no-reply@/i,
  /mailer-daemon@/i,
  /postmaster@/i,
  /notifications?@/i,
];

const SYSTEM_SUBJECTS = [
  /action required: activate formsubmit/i,
  /confirm.*email/i,
  /verify.*address/i,
];

class EmailRouter {
  constructor(jsonStore, broadcast, alertRouter) {
    this.jsonStore = jsonStore;
    this.broadcast = broadcast;
    this.alertRouter = alertRouter;
    this.routeCache = new Map(); // uid → route result
  }

  // Classify an email — returns { category, severity, autoCreate, source, label, cls }
  classify(email) {
    // Check cache
    if (this.routeCache.has(email.uid)) return this.routeCache.get(email.uid);

    const subject = email.subject || '';
    const fromAddr = email.from?.address || '';

    let route;

    // 1. System/spam detection (check first — override everything)
    if (this._isSystem(subject, fromAddr)) {
      route = { ...CATEGORIES.system, category: 'system', source: 'system' };
    }

    // 2. Bracket prefix
    if (!route) {
      const prefixMatch = subject.match(PREFIX_RE);
      if (prefixMatch) {
        const prefix = prefixMatch[1].toLowerCase();
        if (CATEGORIES[prefix]) {
          route = { ...CATEGORIES[prefix], category: prefix, source: 'prefix' };
        }
      }
    }

    // 3. Keyword fallback
    if (!route) {
      const subjLower = subject.toLowerCase();
      for (const entry of KEYWORD_MAP) {
        if (entry.keywords.some(kw => subjLower.includes(kw))) {
          const cat = entry.category;
          route = { ...CATEGORIES[cat], category: cat, source: 'keyword' };
          break;
        }
      }
    }

    // 4. Default to contact
    if (!route) {
      route = { ...CATEGORIES.contact, category: 'contact', source: 'default' };
    }

    this.routeCache.set(email.uid, route);
    return route;
  }

  _isSystem(subject, fromAddr) {
    if (SYSTEM_SENDERS.some(re => re.test(fromAddr))) return true;
    if (SYSTEM_SUBJECTS.some(re => re.test(subject))) return true;
    return false;
  }

  // Process a new email — classify, alert, auto-create
  async processNew(email) {
    const route = this.classify(email);
    const fromName = email.from?.name || email.from?.address || 'Unknown';

    // Store route on the email object
    email.route = route;

    // Fire alert (skip 'none' severity)
    if (route.severity !== 'none') {
      const alertType = `email-${route.category}`;
      this.alertRouter.send(alertType, route.severity,
        `[${route.label}] ${fromName}: ${email.subject}`,
        { uid: email.uid, from: email.from, category: route.category }
      );
    }

    // Activity feed with category prefix
    this.broadcast({
      type: 'activity',
      data: {
        type: 'email',
        text: `[${route.label}] New email from ${fromName}: "${email.subject}"`,
        timestamp: new Date().toISOString(),
      }
    });

    // Auto-create records
    if (route.autoCreate === 'ticket') {
      await this._createTicket(email, route);
    } else if (route.autoCreate === 'subscriber') {
      await this._createSubscriber(email, route);
    }

    return route;
  }

  async _createTicket(email, route) {
    const store = this.jsonStore('tickets.json');
    const tickets = store.read();

    // Don't duplicate — check if a ticket already exists for this email UID
    if (tickets.some(t => t.emailUid === email.uid)) return;

    const priorityMap = { bug: 'high', billing: 'critical', ticket: 'normal' };
    const subject = email.subject.replace(PREFIX_RE, '').trim();

    const ticket = {
      id: store.nextId('t'),
      status: 'new',
      priority: priorityMap[route.category] || 'normal',
      source: `email-${route.category}`,
      emailUid: email.uid,
      customer: {
        name: email.from?.name || '',
        email: email.from?.address || '',
        subscriberId: ''
      },
      subject,
      description: `(via email — open in Inbox to read full body)`,
      aiAnalysis: null,
      resolution: '',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      messages: []
    };

    tickets.push(ticket);
    store.write(tickets);

    this.broadcast({ type: 'ticket:new', data: ticket });
    this.broadcast({
      type: 'activity',
      data: {
        icon: 'ticket',
        text: `Auto-created ticket from [${route.label}] email: ${subject}`,
        time: ticket.createdAt
      }
    });

    console.log(`[ROUTER] Auto-created ticket ${ticket.id} from ${route.category} email (UID ${email.uid})`);
    return ticket;
  }

  async _createSubscriber(email, route) {
    const store = this.jsonStore('subscribers.json');
    const subs = store.read();

    // Don't duplicate — check by email address
    const fromAddr = email.from?.address || '';
    if (subs.some(s => s.email === fromAddr && fromAddr)) return;

    const name = email.from?.name || email.subject.replace(PREFIX_RE, '').trim();

    const sub = {
      id: store.nextId('s'),
      name,
      email: fromAddr,
      plan: '',
      mrr: 0,
      status: 'pending',
      source: 'email-founding',
      emailUid: email.uid,
      startDate: new Date().toISOString(),
      tickets: []
    };

    subs.push(sub);
    store.write(subs);

    this.broadcast({ type: 'subscriber:new', data: sub });
    this.broadcast({
      type: 'activity',
      data: {
        icon: 'subscriber',
        text: `Founding applicant: ${name} (${fromAddr}) — pending review`,
        time: sub.startDate
      }
    });

    console.log(`[ROUTER] Auto-created pending subscriber ${sub.id} from founding email (UID ${email.uid})`);
    return sub;
  }

  // Get category counts from an email list
  getCategoryCounts(emails) {
    const counts = {};
    for (const cat of Object.keys(CATEGORIES)) counts[cat] = 0;
    for (const email of emails) {
      const route = this.classify(email);
      counts[route.category] = (counts[route.category] || 0) + 1;
    }
    return counts;
  }

  // Expose categories config for the frontend
  getCategories() {
    return CATEGORIES;
  }
}

module.exports = EmailRouter;
```

**Step 2: Commit**

```bash
git add lib/email-router.js
git commit -m "feat: add email router — subject classification engine with auto-create"
```

---

## Task 2: Integrate Router into Email Poller

**Files:**
- Modify: `lib/email-poller.js` (lines 4-5 constructor params, lines 89-118 new message handling)
- Modify: `server.js` (lines 72-73 constructor, line 79 app.locals)

**Step 1: Update `lib/email-poller.js` — accept router in constructor, delegate to it**

In the constructor (line 4-5), add `emailRouter` parameter:

```javascript
// Change constructor signature:
constructor(broadcast, alertRouter, emailRouter) {
    this.broadcast = broadcast;
    this.alertRouter = alertRouter;
    this.emailRouter = emailRouter;
```

Replace the new-message handling block (lines 89-118) with router delegation:

```javascript
        // Detect new messages (after first load)
        if (this.checkCount > 0) {
          const newMsgs = messages.filter(m => !this.seenUids.has(m.uid));
          for (const msg of newMsgs) {
            console.log(`[EMAIL] NEW: ${msg.from.name || msg.from.address}: ${msg.subject}`);

            // Broadcast raw email:new event
            this.broadcast({ type: 'email:new', data: msg });

            // Route through classifier — handles alerts, auto-create, activity feed
            if (this.emailRouter) {
              await this.emailRouter.processNew(msg);
            }
          }
        }
```

This removes the old hardcoded founding-only alert logic and delegates everything to the router.

Also update `getInbox()` (line 288-300) to include route data on each email:

```javascript
  getInbox() {
    const emails = this.emails.slice(0, 30).map(e => ({
      ...e,
      route: this.emailRouter ? this.emailRouter.classify(e) : null,
    }));

    return {
      status: this.status,
      lastCheck: this.lastCheck,
      checkCount: this.checkCount,
      error: this.error,
      pollInterval: this.config.pollInterval,
      account: this.config.user,
      unread: this.emails.filter(e => e.unread).length,
      total: this.emails.length,
      emails,
      byCategory: this.emailRouter ? this.emailRouter.getCategoryCounts(this.emails) : {},
    };
  }
```

**Step 2: Update `server.js` — wire the router in**

At line 72-73, change EmailPoller construction to pass the router:

```javascript
// ── Email Router + Poller ────────────────────────────────
const EmailRouter = require('./lib/email-router');
const EmailPoller = require('./lib/email-poller');
const emailRouter = new EmailRouter(jsonStore, broadcast, alertRouter);
const emailPoller = new EmailPoller(broadcast, alertRouter, emailRouter);
```

At line 79, add emailRouter to app.locals:

```javascript
app.locals.emailRouter = emailRouter;
```

**Step 3: Commit**

```bash
git add lib/email-poller.js server.js
git commit -m "feat: integrate email router into poller — replaces hardcoded alert logic"
```

---

## Task 3: Update Inbox API — Filters and Category Endpoint

**Files:**
- Modify: `routes/inbox.js`

**Step 1: Add category filter to GET / and a categories metadata endpoint**

Update `routes/inbox.js` — add filter support and categories endpoint:

After the existing `GET /` handler (line 5-8), modify it to support `?category=` and `?archived=` filters:

```javascript
router.get('/', (req, res) => {
  const poller = req.app.locals.emailPoller;
  if (!poller) return res.json({ status: 'disabled', emails: [] });

  const data = poller.getInbox();

  // Filter by category if requested
  if (req.query.category) {
    data.emails = data.emails.filter(e => e.route?.category === req.query.category);
  }

  // Hide archived (system) by default unless ?archived=true
  if (req.query.archived !== 'true') {
    data.emails = data.emails.filter(e => e.route?.category !== 'system');
  }

  res.json(data);
});
```

Add a categories metadata endpoint before the `/:uid` route:

```javascript
// Get route categories metadata (for frontend filter bar)
router.get('/categories', (req, res) => {
  const router = req.app.locals.emailRouter;
  if (!router) return res.json({});
  res.json(router.getCategories());
});
```

Also update `GET /:uid` to include route data in the response (after line 26):

```javascript
    // Include route classification
    email.route = req.app.locals.emailRouter?.classify({ uid, subject: email.subject, from: email.from }) || null;

    // Include linked record if auto-created
    if (email.route?.autoCreate === 'ticket') {
      const tickets = req.app.locals.jsonStore('tickets.json').read();
      const linked = tickets.find(t => t.emailUid === uid);
      if (linked) email.linkedTicket = { id: linked.id, status: linked.status };
    } else if (email.route?.autoCreate === 'subscriber') {
      const subs = req.app.locals.jsonStore('subscribers.json').read();
      const linked = subs.find(s => s.emailUid === uid);
      if (linked) email.linkedSubscriber = { id: linked.id, status: linked.status, name: linked.name };
    }

    res.json(email);
```

**Step 2: Commit**

```bash
git add routes/inbox.js
git commit -m "feat: inbox API — category filters, archived toggle, linked records"
```

---

## Task 4: Update Dashboard Stats — Category Breakdown

**Files:**
- Modify: `server.js` (lines 175-184 — getStats inbox section)

**Step 1: Expand inbox stats in getStats()**

Replace the inbox section of getStats() (lines 175-184):

```javascript
  const inbox = emailPoller.getInbox();

  return {
    timestamp: Date.now(),
    inbox: {
      unread: inbox.unread,
      total: inbox.total,
      status: inbox.status,
      lastCheck: inbox.lastCheck,
      byCategory: inbox.byCategory || {},
    },
```

**Step 2: Commit**

```bash
git add server.js
git commit -m "feat: dashboard stats include inbox category breakdown"
```

---

## Task 5: Update Subscribers Route — Accept 'pending' Status

**Files:**
- Modify: `routes/subscribers.js` (line 34)

**Step 1: Allow 'pending' as a valid default status and add source/emailUid fields**

At line 28-37, update the create handler to accept new fields:

```javascript
  const sub = {
    id: s.nextId('s'),
    name: req.body.name || '',
    email: req.body.email || '',
    plan: req.body.plan || '',
    mrr: req.body.mrr || 0,
    status: req.body.status || 'trial',
    source: req.body.source || '',
    emailUid: req.body.emailUid || null,
    startDate: req.body.startDate || new Date().toISOString(),
    tickets: []
  };
```

At line 52, add the new fields to the allowed update list:

```javascript
  const allowed = ['name', 'email', 'plan', 'mrr', 'status', 'source'];
```

**Step 2: Commit**

```bash
git add routes/subscribers.js
git commit -m "feat: subscribers accept pending status and source/emailUid fields"
```

---

## Task 6: Update Tickets Route — Accept Email Source Fields

**Files:**
- Modify: `routes/tickets.js` (lines 29-41)

**Step 1: Add source and emailUid to ticket creation**

At lines 29-41, update the create handler to accept the new fields:

```javascript
  const ticket = {
    id: s.nextId('t'),
    status: req.body.status || 'new',
    priority: req.body.priority || 'normal',
    source: req.body.source || '',
    emailUid: req.body.emailUid || null,
    customer: req.body.customer || { name: '', email: '', subscriberId: '' },
    subject: req.body.subject || '',
    description: req.body.description || '',
    aiAnalysis: null,
    resolution: '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    messages: []
  };
```

At line 66, add source to allowed update fields:

```javascript
  const allowed = ['status', 'priority', 'resolution', 'aiAnalysis', 'subject', 'description', 'customer', 'source'];
```

**Step 2: Commit**

```bash
git add routes/tickets.js
git commit -m "feat: tickets accept source and emailUid fields for email-created tickets"
```

---

## Task 7: Upgrade Inbox Frontend — Category Tags and Filter Bar

**Files:**
- Modify: `public/js/views/inbox.js`

**Step 1: Replace the hardcoded `classifyEmail` with route-based tags, add filter bar and archive toggle**

Rewrite `public/js/views/inbox.js` completely:

```javascript
// ── Inbox View ───────────────────────────────────────────
const InboxView = {
  emails: [],
  status: 'loading',
  openUid: null,
  activeFilter: null,
  showArchived: false,
  byCategory: {},

  render(container) {
    container.innerHTML = `
      <div class="inbox-header">
        <div class="inbox-status" id="inboxStatusBar">
          <span class="inbox-status-dot" id="inboxDot"></span>
          <span id="inboxStatusText">Connecting...</span>
        </div>
        <button class="btn btn-sm" onclick="InboxView.forceCheck()">Check Now</button>
      </div>
      <div class="inbox-filters" id="inboxFilters"></div>
      <div class="inbox-split">
        <div class="inbox-list" id="inboxList">
          <div class="empty-state"><p>Loading inbox...</p></div>
        </div>
        <div class="inbox-detail" id="inboxDetail" style="display:none"></div>
      </div>
    `;
    this.openUid = null;
    this.activeFilter = null;
    this.load();
  },

  async load() {
    try {
      const archived = this.showArchived ? '&archived=true' : '';
      const filter = this.activeFilter ? `?category=${this.activeFilter}${archived}` : `?${archived.slice(1)}`;
      const data = await App.api(`inbox${filter}`);
      this.emails = data.emails || [];
      this.status = data.status;
      this.byCategory = data.byCategory || {};
      this.renderFilters();
      this.renderEmails(data);
    } catch (err) {
      this.status = 'error';
      this.renderError(err.message);
    }
  },

  async forceCheck() {
    const btn = document.querySelector('.inbox-header .btn');
    if (btn) { btn.textContent = 'Checking...'; btn.disabled = true; }
    try {
      const data = await App.api('inbox/check', { method: 'POST' });
      this.emails = data.emails || [];
      this.status = data.status;
      this.byCategory = data.byCategory || {};
      this.renderFilters();
      this.renderEmails(data);
    } catch (err) {
      this.renderError(err.message);
    } finally {
      if (btn) { btn.textContent = 'Check Now'; btn.disabled = false; }
    }
  },

  renderFilters() {
    const el = document.getElementById('inboxFilters');
    if (!el) return;

    const cats = [
      { key: null, label: 'All' },
      { key: 'founding', label: 'Founding', cls: 'tag-founding' },
      { key: 'billing', label: 'Billing', cls: 'tag-billing' },
      { key: 'bug', label: 'Bugs', cls: 'tag-bug' },
      { key: 'demo', label: 'Demos', cls: 'tag-demo' },
      { key: 'ticket', label: 'Tickets', cls: 'tag-ticket' },
      { key: 'feature', label: 'Features', cls: 'tag-feature' },
      { key: 'referral', label: 'Referrals', cls: 'tag-referral' },
      { key: 'contact', label: 'Contact', cls: 'tag-contact' },
      { key: 'partner', label: 'Partners', cls: 'tag-partner' },
    ];

    const counts = this.byCategory;
    el.innerHTML = cats.map(c => {
      const count = c.key ? (counts[c.key] || 0) : this.emails.length;
      const active = this.activeFilter === c.key ? ' active' : '';
      return `<button class="inbox-filter-btn${active}${c.cls ? ' ' + c.cls : ''}"
                onclick="InboxView.setFilter(${c.key ? "'" + c.key + "'" : 'null'})">${c.label}${count ? ' <span class="filter-count">' + count + '</span>' : ''}</button>`;
    }).join('') +
    `<label class="inbox-archive-toggle">
      <input type="checkbox" ${this.showArchived ? 'checked' : ''} onchange="InboxView.toggleArchived(this.checked)"> Show system
    </label>`;
  },

  setFilter(category) {
    this.activeFilter = category;
    this.load();
  },

  toggleArchived(show) {
    this.showArchived = show;
    this.load();
  },

  renderEmails(data) {
    const list = document.getElementById('inboxList');
    const dot = document.getElementById('inboxDot');
    const statusText = document.getElementById('inboxStatusText');
    if (!list) return;

    // Status bar
    if (dot && statusText) {
      if (data.status === 'connected') {
        dot.className = 'inbox-status-dot online';
        const counts = data.byCategory || {};
        const parts = Object.entries(counts).filter(([k, v]) => v > 0 && k !== 'system').map(([k, v]) => `${v} ${k}`);
        statusText.textContent = `${data.account} \u2022 ${data.total} emails \u2022 ${data.unread} unread \u2022 ${parts.join(' \u00b7 ')}`;
      } else if (data.status === 'error') {
        dot.className = 'inbox-status-dot offline';
        statusText.textContent = `Error: ${data.error}`;
      } else if (data.status === 'disabled') {
        dot.className = 'inbox-status-dot offline';
        statusText.textContent = 'Email poller disabled \u2014 set IMAP_PASS in .env';
      } else {
        dot.className = 'inbox-status-dot';
        statusText.textContent = data.status;
      }
    }

    if (!data.emails || data.emails.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>${this.activeFilter ? 'No ' + this.activeFilter + ' emails' : 'Inbox empty'}</p><p class="dim">Polling contact@sweepnspect.com every 30s</p></div>`;
      return;
    }

    list.innerHTML = data.emails.map(email => {
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const route = email.route;
      const activeCls = email.uid === this.openUid ? ' active' : '';
      const archivedCls = route?.category === 'system' ? ' archived' : '';
      return `
        <div class="inbox-item${email.unread ? ' unread' : ''}${activeCls}${archivedCls}" onclick="InboxView.openEmail(${email.uid})" data-uid="${email.uid}">
          <div class="inbox-dot-indicator${email.unread ? ' unread' : ''}"></div>
          <div class="inbox-body">
            <div class="inbox-from">${this.esc(fromName)}</div>
            <div class="inbox-subject">${this.esc(email.subject)}</div>
            <div class="inbox-time">${App.timeAgo(email.date)}</div>
          </div>
          ${route ? `<span class="inbox-tag ${route.cls}">${route.label}</span>` : ''}
        </div>
      `;
    }).join('');
  },

  async openEmail(uid) {
    this.openUid = uid;
    const detail = document.getElementById('inboxDetail');
    if (!detail) return;

    detail.style.display = '';
    detail.innerHTML = '<div class="email-loading">Loading email...</div>';

    // Highlight active item in list
    document.querySelectorAll('.inbox-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.uid) === uid);
    });
    // Mark as read locally
    const local = this.emails.find(e => e.uid === uid);
    if (local) {
      local.unread = false;
      const item = document.querySelector(`.inbox-item[data-uid="${uid}"]`);
      if (item) {
        item.classList.remove('unread');
        const dot = item.querySelector('.inbox-dot-indicator');
        if (dot) dot.classList.remove('unread');
      }
    }

    try {
      const email = await App.api(`inbox/${uid}`);
      const fromName = email.from?.name || email.from?.address || 'Unknown';
      const fromAddr = email.from?.address || '';
      const toList = (email.to || []).map(t => t.address).join(', ');
      const date = email.date ? new Date(email.date).toLocaleString() : '';
      const route = email.route;

      // Build linked record badge
      let linkedHtml = '';
      if (email.linkedTicket) {
        linkedHtml = `<a class="email-linked-badge badge-ticket" href="#tickets/${email.linkedTicket.id}">Ticket ${email.linkedTicket.id} (${email.linkedTicket.status})</a>`;
      } else if (email.linkedSubscriber) {
        linkedHtml = `<a class="email-linked-badge badge-subscriber" href="#subscribers/${email.linkedSubscriber.id}">${this.esc(email.linkedSubscriber.name)} (${email.linkedSubscriber.status})</a>`;
      }

      detail.innerHTML = `
        <div class="email-header">
          <button class="email-back" onclick="InboxView.closeEmail()">&larr; Back</button>
          <div class="email-meta">
            <div class="email-meta-subject">
              ${route ? `<span class="inbox-tag ${route.cls}">${route.label}</span>` : ''}
              ${this.esc(email.subject)}
            </div>
            <div class="email-meta-from">
              <strong>${this.esc(fromName)}</strong> &lt;${this.esc(fromAddr)}&gt;
            </div>
            <div class="email-meta-details">
              To: ${this.esc(toList)} &middot; ${date}
              ${route?.source ? ` &middot; Routed by: ${route.source}` : ''}
            </div>
            ${linkedHtml ? `<div class="email-meta-linked">${linkedHtml}</div>` : ''}
          </div>
        </div>
        <div class="email-body"><pre>${this.esc(email.body || '(no text content)')}</pre></div>
        <div class="email-reply">
          <div class="email-reply-label">Reply to ${this.esc(fromName)}:</div>
          <textarea class="email-reply-input" id="replyInput" rows="5" placeholder="Type your reply..."></textarea>
          <div class="email-reply-actions">
            <button class="btn btn-primary" id="replySendBtn" onclick="InboxView.sendReply(${uid})">Send Reply</button>
            <span class="email-reply-status" id="replyStatus"></span>
          </div>
        </div>
      `;
    } catch (err) {
      detail.innerHTML = `<div class="email-loading">Error loading email: ${this.esc(err.message)}</div>`;
    }
  },

  closeEmail() {
    this.openUid = null;
    const detail = document.getElementById('inboxDetail');
    if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
    document.querySelectorAll('.inbox-item').forEach(el => el.classList.remove('active'));
  },

  async sendReply(uid) {
    const input = document.getElementById('replyInput');
    const btn = document.getElementById('replySendBtn');
    const status = document.getElementById('replyStatus');
    if (!input || !btn) return;

    const body = input.value.trim();
    if (!body) { status.textContent = 'Write something first'; return; }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    status.textContent = '';

    try {
      const result = await App.api(`inbox/${uid}/reply`, {
        method: 'POST',
        body: { body }
      });
      btn.textContent = 'Sent!';
      btn.className = 'btn btn-success';
      status.textContent = `Reply sent to ${result.to}`;
      status.style.color = 'var(--success)';
      input.value = '';
      setTimeout(() => {
        btn.textContent = 'Send Reply';
        btn.className = 'btn btn-primary';
        btn.disabled = false;
      }, 3000);
    } catch (err) {
      btn.textContent = 'Send Reply';
      btn.disabled = false;
      status.textContent = `Failed: ${err.message || 'unknown error'}`;
      status.style.color = 'var(--brick)';
    }
  },

  renderError(msg) {
    const list = document.getElementById('inboxList');
    if (list) list.innerHTML = `<div class="empty-state"><p>Error loading inbox</p><p class="dim">${this.esc(msg)}</p></div>`;
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  onWsMessage(type, data) {
    if (type === 'email:new') {
      this.emails.unshift(data);
      this.load(); // Reload to get fresh route data
    }
  },

  onStats(stats) {
    if (stats.inbox) {
      const badge = document.getElementById('inboxBadge');
      if (badge) {
        if (stats.inbox.unread > 0) {
          badge.textContent = stats.inbox.unread;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  }
};
```

**Step 2: Commit**

```bash
git add public/js/views/inbox.js
git commit -m "feat: inbox UI — category tags, filter bar, archive toggle, linked records"
```

---

## Task 8: Add Category Tag Colors and Filter Bar CSS

**Files:**
- Modify: `public/css/hub.css`

**Step 1: Add CSS for all 10 category tag colors, filter bar, archive toggle, and linked record badges**

Append to `public/css/hub.css`:

```css
/* ── Category Tag Colors ──────────────────────────────── */
.tag-ticket   { background: #3b82f6; color: #fff; }
.tag-bug      { background: #ef4444; color: #fff; }
.tag-founding { background: #22c55e; color: #000; }
.tag-billing  { background: #f59e0b; color: #000; }
.tag-feature  { background: #8b5cf6; color: #fff; }
.tag-demo     { background: #06b6d4; color: #000; }
.tag-referral { background: #ec4899; color: #fff; }
.tag-contact  { background: #64748b; color: #fff; }
.tag-partner  { background: #a855f7; color: #fff; }
.tag-system   { background: #334155; color: #94a3b8; }

/* ── Filter Bar ───────────────────────────────────────── */
.inbox-filters {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border, #1e293b);
  overflow-x: auto;
  align-items: center;
  flex-wrap: wrap;
}
.inbox-filter-btn {
  background: transparent;
  border: 1px solid var(--border, #334155);
  color: var(--dim, #94a3b8);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.inbox-filter-btn:hover {
  border-color: var(--accent, #f0f0f0);
  color: var(--text, #f0f0f0);
}
.inbox-filter-btn.active {
  background: var(--accent, #f0f0f0);
  color: var(--bg, #0a0a0a);
  border-color: var(--accent, #f0f0f0);
}
.filter-count {
  font-weight: 700;
  opacity: 0.7;
  margin-left: 2px;
}
.inbox-archive-toggle {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--dim, #94a3b8);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.inbox-archive-toggle input { cursor: pointer; }

/* ── Archived/System email items ──────────────────────── */
.inbox-item.archived {
  opacity: 0.45;
}
.inbox-item.archived:hover {
  opacity: 0.7;
}

/* ── Linked Record Badges ─────────────────────────────── */
.email-meta-linked {
  margin-top: 6px;
}
.email-linked-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 0.75rem;
  text-decoration: none;
  cursor: pointer;
}
.badge-ticket {
  background: #3b82f620;
  color: #3b82f6;
  border: 1px solid #3b82f640;
}
.badge-ticket:hover { background: #3b82f640; }
.badge-subscriber {
  background: #22c55e20;
  color: #22c55e;
  border: 1px solid #22c55e40;
}
.badge-subscriber:hover { background: #22c55e40; }
```

**Step 2: Commit**

```bash
git add public/css/hub.css
git commit -m "feat: category tag colors, filter bar, archive toggle CSS"
```

---

## Task 9: End-to-End Test — Restart Server and Verify

**Step 1: Kill running server and restart**

```bash
# Find and kill the process on port 8888
netstat -ano | grep ":8888 " | grep LISTEN
# Kill that PID
taskkill //PID <pid> //F

# Start fresh
cd /d/Hive/Projects/SweepNspect-Hub
node server.js &
```

**Step 2: Verify API returns route data**

```bash
# Check inbox — emails should have route objects
curl -s http://localhost:8888/api/inbox | python -c "
import sys, json
d = json.load(sys.stdin)
for e in d['emails'][:3]:
    r = e.get('route', {})
    print(f'{r.get(\"label\",\"?\")} | {e[\"subject\"][:50]}')
print(f'byCategory: {d.get(\"byCategory\", {})}')
"

# Check filter works
curl -s "http://localhost:8888/api/inbox?category=founding" | python -c "
import sys, json
d = json.load(sys.stdin)
print(f'Founding emails: {len(d[\"emails\"])}')
for e in d['emails']:
    print(f'  {e[\"subject\"][:60]}')
"

# Check categories endpoint
curl -s http://localhost:8888/api/inbox/categories
```

**Step 3: Verify full email detail includes route + linked record**

```bash
# Fetch a specific email
curl -s http://localhost:8888/api/inbox/7 | python -c "
import sys, json
d = json.load(sys.stdin)
print(f'Subject: {d[\"subject\"]}')
print(f'Route: {d.get(\"route\", {})}')
print(f'Linked ticket: {d.get(\"linkedTicket\", \"none\")}')
print(f'Linked subscriber: {d.get(\"linkedSubscriber\", \"none\")}')
"
```

**Step 4: Send a test email with bracket prefix and verify auto-create**

```bash
# Send a test [BUG] email
node -e "
const nm = require('nodemailer');
const t = nm.createTransport({ host:'mail.privateemail.com', port:587, secure:false, auth:{user:'contact@sweepnspect.com', pass:process.env.IMAP_PASS}});
t.sendMail({ from:'\"Test User\" <contact@sweepnspect.com>', to:'contact@sweepnspect.com', subject:'[BUG] Camera freezes on Zone 3 edit', text:'The camera preview freezes when editing Zone 3 boundaries on a Pixel 7. App version 2.4.2.' }).then(() => console.log('Sent'));
"

# Wait for poll cycle (30s)
sleep 35

# Check that a ticket was auto-created
curl -s http://localhost:8888/api/tickets | python -c "
import sys, json
tickets = json.load(sys.stdin)
for t in tickets:
    if 'email-bug' in (t.get('source','') or ''):
        print(f'AUTO-CREATED: {t[\"id\"]} | {t[\"subject\"]} | priority={t[\"priority\"]} | source={t[\"source\"]}')
"
```

**Step 5: Open in browser and verify the UI**

```bash
start chrome "http://localhost:8888/#inbox"
```

Verify visually:
- [ ] Filter bar shows all categories with counts
- [ ] Each email has a colored category tag
- [ ] Clicking a filter shows only that category
- [ ] "Show system" checkbox toggles archived emails
- [ ] Opening an email shows the route badge and linked record link
- [ ] Clicking a linked ticket/subscriber badge navigates to that view

**Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify email routing end-to-end — all categories, auto-create, UI"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Email Router classification engine | `lib/email-router.js` (new) |
| 2 | Integrate router into poller | `lib/email-poller.js`, `server.js` |
| 3 | Inbox API filters + categories | `routes/inbox.js` |
| 4 | Dashboard stats category breakdown | `server.js` |
| 5 | Subscribers accept pending status | `routes/subscribers.js` |
| 6 | Tickets accept email source fields | `routes/tickets.js` |
| 7 | Inbox frontend — tags, filters, badges | `public/js/views/inbox.js` |
| 8 | Category CSS colors + filter bar | `public/css/hub.css` |
| 9 | End-to-end test + verification | All files |
