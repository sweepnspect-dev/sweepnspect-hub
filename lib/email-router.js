// ── Email Router — Subject Classification Engine ─────────────
// Classifies inbound email by bracket prefix, keyword fallback, or system detection.
// Auto-creates tickets/subscribers for routable categories.

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

const PREFIX_RE = /^\[(\w+)\]\s*/i;

const KEYWORD_MAP = [
  { keywords: ['bug', 'crash', 'broken', 'error'], category: 'bug' },
  { keywords: ['founding', 'application'], category: 'founding' },
  { keywords: ['billing', 'payment', 'invoice', 'refund', 'subscription cancel'], category: 'billing' },
  { keywords: ['feature', 'request', 'wish', 'suggestion'], category: 'feature' },
  { keywords: ['demo', 'trial'], category: 'demo' },
  { keywords: ['referr'], category: 'referral' },
  { keywords: ['partner', 'integration', 'wholesale', 'reseller'], category: 'partner' },
  { keywords: ['ticket', 'support', 'help'], category: 'ticket' },
];

const SYSTEM_SENDERS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^notifications?@/i,
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
    this._cache = new Map(); // uid → classification result
  }

  /**
   * Classify an email into a category.
   * Returns { category, severity, autoCreate, source, label, cls }
   * Caches by email.uid.
   */
  classify(email) {
    if (this._cache.has(email.uid)) {
      return this._cache.get(email.uid);
    }

    const fromAddr = (email.from?.address || '').toLowerCase();
    const subject = email.subject || '';
    const subjectLower = subject.toLowerCase();

    // 1. System/spam detection
    const isSystemSender = SYSTEM_SENDERS.some(re => re.test(fromAddr));
    const isSystemSubject = SYSTEM_SUBJECTS.some(re => re.test(subjectLower));
    if (isSystemSender || isSystemSubject) {
      const result = this._buildResult('system');
      this._cache.set(email.uid, result);
      return result;
    }

    // 2. Bracket prefix: [TICKET], [BUG], etc.
    const prefixMatch = subject.match(PREFIX_RE);
    if (prefixMatch) {
      const tag = prefixMatch[1].toLowerCase();
      if (CATEGORIES[tag]) {
        const result = this._buildResult(tag);
        this._cache.set(email.uid, result);
        return result;
      }
    }

    // 3. Keyword fallback
    for (const { keywords, category } of KEYWORD_MAP) {
      for (const kw of keywords) {
        if (subjectLower.includes(kw)) {
          const result = this._buildResult(category);
          this._cache.set(email.uid, result);
          return result;
        }
      }
    }

    // 4. Default to contact
    const result = this._buildResult('contact');
    this._cache.set(email.uid, result);
    return result;
  }

  _buildResult(category) {
    const cat = CATEGORIES[category];
    return {
      category,
      severity: cat.severity,
      autoCreate: cat.autoCreate,
      source: `email-${category}`,
      label: cat.label,
      cls: cat.cls,
    };
  }

  /**
   * Process a new email: classify, alert, broadcast, auto-create records.
   */
  processNew(email) {
    const route = this.classify(email);
    const fromName = email.from?.name || email.from?.address || 'Unknown';
    const subject = email.subject || '(no subject)';

    // Fire alert (skip severity 'none')
    if (route.severity !== 'none') {
      this.alertRouter.send(
        `email-${route.category}`,
        route.severity,
        `[${route.label}] ${fromName}: ${subject}`,
        { uid: email.uid, from: email.from, category: route.category }
      );
    }

    // Broadcast activity
    this.broadcast({
      type: 'activity',
      data: {
        type: 'email',
        text: `[${route.label}] New email from ${fromName}: "${subject}"`,
        timestamp: new Date().toISOString(),
      }
    });

    // Auto-create records
    if (route.autoCreate === 'ticket') {
      this._createTicket(email, route);
    } else if (route.autoCreate === 'subscriber') {
      this._createSubscriber(email, route);
    }

    return route;
  }

  /**
   * Create a ticket from an email. Deduplicates by emailUid.
   */
  _createTicket(email, route) {
    const store = this.jsonStore('tickets.json');
    const tickets = store.read();

    // Deduplicate by emailUid
    if (tickets.some(t => t.emailUid === email.uid)) {
      return null;
    }

    // Priority based on category
    const priorityMap = { bug: 'high', billing: 'critical', ticket: 'normal' };
    const priority = priorityMap[route.category] || 'normal';

    // Strip bracket prefix from subject
    const subject = (email.subject || '').replace(PREFIX_RE, '');

    const ticket = {
      id: store.nextId('t'),
      status: 'new',
      priority,
      source: `email-${route.category}`,
      emailUid: email.uid,
      customer: {
        name: email.from?.name || '',
        email: email.from?.address || '',
      },
      subject,
      description: email.body || '',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      messages: [],
    };

    tickets.push(ticket);
    store.write(tickets);

    // Broadcast the new ticket
    this.broadcast({ type: 'ticket:new', data: ticket });

    console.log(`[ROUTER] Auto-created ticket ${ticket.id} from email uid=${email.uid} (${route.category})`);
    return ticket;
  }

  /**
   * Create a subscriber from a founding email. Deduplicates by email address.
   */
  _createSubscriber(email, route) {
    const store = this.jsonStore('subscribers.json');
    const subscribers = store.read();

    const emailAddr = (email.from?.address || '').toLowerCase();

    // Deduplicate by email address
    if (subscribers.some(s => (s.email || '').toLowerCase() === emailAddr)) {
      return null;
    }

    const subscriber = {
      id: store.nextId('s'),
      name: email.from?.name || '',
      email: emailAddr,
      plan: '',
      mrr: 0,
      status: 'pending',
      source: 'email-founding',
      emailUid: email.uid,
      startDate: new Date().toISOString(),
      tickets: [],
    };

    subscribers.push(subscriber);
    store.write(subscribers);

    // Broadcast the new subscriber
    this.broadcast({ type: 'subscriber:new', data: subscriber });

    console.log(`[ROUTER] Auto-created subscriber ${subscriber.id} from email ${emailAddr}`);
    return subscriber;
  }

  /**
   * Count emails per category.
   */
  getCategoryCounts(emails) {
    const counts = {};
    for (const email of emails) {
      const { category } = this.classify(email);
      counts[category] = (counts[category] || 0) + 1;
    }
    return counts;
  }

  /**
   * Return the CATEGORIES config object.
   */
  getCategories() {
    return CATEGORIES;
  }
}

module.exports = EmailRouter;
