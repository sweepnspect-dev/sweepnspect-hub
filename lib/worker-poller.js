// ── Worker Poller — bridges Cloudflare Worker events to HQ ──

class WorkerPoller {
  constructor(jsonStore, broadcast, alertRouter) {
    this.jsonStore = jsonStore;
    this.broadcast = broadcast;
    this.alertRouter = alertRouter;
    this.pollTimer = null;
    this.checkCount = 0;
    this.lastCheck = null;
    this.status = 'starting';
    this.error = null;

    this.config = {
      workerUrl: process.env.WORKER_URL || 'https://sweepnspect-webhook.sweepnspect.workers.dev',
      pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || '8000'),
    };
  }

  async start() {
    console.log(`[WORKER] Polling ${this.config.workerUrl} every ${this.config.pollInterval / 1000}s`);
    await this.check();
    this.pollTimer = setInterval(() => this.check(), this.config.pollInterval);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = 'stopped';
  }

  async check() {
    try {
      // Fetch unacked events from Worker
      const res = await fetch(`${this.config.workerUrl}/api/events`);
      if (!res.ok) {
        throw new Error(`Worker returned ${res.status}: ${res.statusText}`);
      }

      const { events } = await res.json();
      this.status = 'connected';

      if (!events || events.length === 0) {
        this.lastCheck = new Date().toISOString();
        this.checkCount++;
        return;
      }

      const acked = [];

      for (const evt of events) {
        try {
          await this._processEvent(evt);
          acked.push(evt.id);
        } catch (err) {
          console.error(`[WORKER] Failed to process event ${evt.id}: ${err.message}`);
        }
      }

      // ACK processed events
      if (acked.length > 0) {
        const ackRes = await fetch(`${this.config.workerUrl}/api/events/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: acked }),
        });
        if (ackRes.ok) {
          console.log(`[WORKER] Acked ${acked.length} events`);
        }
      }

      this.lastCheck = new Date().toISOString();
      this.error = null;
      this.checkCount++;

    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      console.error(`[WORKER] Poll error: ${err.message}`);
    }
  }

  async _processEvent(evt) {
    switch (evt.event) {
      case 'founding:application':
        this._handleFoundingApp(evt);
        break;

      case 'ticket:create':
        this._handleTicketCreate(evt);
        break;

      case 'chat:start':
        this._handleChatStart(evt);
        break;

      case 'chat:end':
        // Low priority — just log it
        console.log(`[WORKER] Chat ended: ${evt.summary}`);
        this.broadcast({ type: 'activity', data: { icon: 'chat', text: evt.summary, time: evt.receivedAt } });
        break;

      case 'facebook:message':
        this._handleFacebookMessage(evt);
        break;

      case 'facebook:comment':
        this._handleFacebookComment(evt);
        break;

      case 'facebook:reaction':
        console.log(`[WORKER] FB reaction: ${evt.summary}`);
        this.broadcast({ type: 'activity', data: { icon: 'facebook', text: evt.summary, time: evt.receivedAt } });
        break;

      case 'livechat:start':
        this._handleLivechatStart(evt);
        break;

      case 'livechat:message':
        this._handleLivechatMessage(evt);
        break;

      case 'livechat:end':
        this._handleLivechatEnd(evt);
        break;

      case 'livechat:defer':
        this._handleLivechatDefer(evt);
        break;

      case 'livechat:notes':
        this._handleLivechatNotes(evt);
        break;

      default:
        console.log(`[WORKER] Unknown event type: ${evt.event}`);
        this.broadcast({ type: 'activity', data: { icon: 'webhook', text: evt.summary || `Worker event: ${evt.event}`, time: evt.receivedAt } });
    }
  }

  _handleFoundingApp(evt) {
    const app = evt.application;
    if (!app || !app.email) return;

    const store = this.jsonStore('subscribers.json');
    const subs = store.read();

    // Deduplicate by email
    if (subs.find(s => s.email === app.email)) {
      console.log(`[WORKER] Founding app from ${app.email} — already a subscriber, skipping`);
      return;
    }

    const sub = {
      id: store.nextId.call(store, 's'),
      name: app.name || '',
      email: app.email,
      plan: 'founding',
      mrr: 0,
      status: 'lead',
      source: 'founding-form',
      startDate: app.submittedAt || new Date().toISOString(),
      tickets: [],
      founding: {
        yearsSweeping: app.years_sweeping,
        currentTools: app.current_tools,
        heardAbout: app.heard_about,
        referredBy: app.referred_by,
      },
    };

    subs.push(sub);
    store.write(subs);

    console.log(`[WORKER] New founding subscriber: ${sub.name} (${sub.email})`);
    this.broadcast({ type: 'subscriber:new', data: sub });
    this.broadcast({ type: 'activity', data: { icon: 'founding', text: `Founding 25 application: ${sub.name}`, time: sub.startDate } });

    if (this.alertRouter) {
      this.alertRouter.send('founding-application', 'high',
        `Founding 25 application: ${app.name} (${app.email}) — ${app.years_sweeping} years sweeping`,
        { subscriberId: sub.id, email: app.email }
      );
    }
  }

  _handleTicketCreate(evt) {
    const ticket = evt.ticket;
    if (!ticket) return;

    const store = this.jsonStore('tickets.json');
    const tickets = store.read();

    const newTicket = {
      id: store.nextId.call(store, 't'),
      status: 'new',
      priority: evt.priority || 'normal',
      customer: {
        name: ticket.name || 'Chat Visitor',
        email: ticket.email || '',
        subscriberId: '',
      },
      subject: ticket.subject || 'Chat inquiry',
      description: ticket.message || '',
      source: 'chat',
      aiAnalysis: null,
      resolution: '',
      createdAt: evt.receivedAt || new Date().toISOString(),
      resolvedAt: null,
      messages: [],
    };

    tickets.push(newTicket);
    store.write(tickets);

    console.log(`[WORKER] New chat ticket: ${newTicket.subject}`);
    this.broadcast({ type: 'ticket:new', data: newTicket });
    this.broadcast({ type: 'activity', data: { icon: 'ticket', text: `Chat ticket: ${newTicket.subject}`, time: newTicket.createdAt } });

    if (this.alertRouter) {
      this.alertRouter.send('ticket-chat', 'normal',
        `Chat ticket from ${ticket.name}: ${ticket.subject}`,
        { ticketId: newTicket.id }
      );
    }
  }

  _handleChatStart(evt) {
    const visitor = evt.visitor || {};
    console.log(`[WORKER] Live chat started: ${visitor.name || 'Visitor'}`);
    this.broadcast({ type: 'activity', data: { icon: 'chat', text: evt.summary, time: evt.receivedAt } });

    if (this.alertRouter) {
      this.alertRouter.send('chat-start', 'high',
        evt.summary || `Live chat: ${visitor.name || 'Visitor'}`,
        { chatId: evt.chatId }
      );
    }
  }

  _handleFacebookMessage(evt) {
    const fb = evt.facebook || {};
    const text = fb.text || '';

    // Create a ticket for Facebook messages
    const store = this.jsonStore('tickets.json');
    const tickets = store.read();

    const newTicket = {
      id: store.nextId.call(store, 't'),
      status: 'new',
      priority: 'high',
      customer: {
        name: `FB User ${fb.senderId || 'unknown'}`,
        email: '',
        subscriberId: '',
        facebookId: fb.senderId,
      },
      subject: text.substring(0, 80) || 'Facebook message',
      description: text,
      source: 'facebook-message',
      aiAnalysis: null,
      resolution: '',
      createdAt: evt.receivedAt || new Date().toISOString(),
      resolvedAt: null,
      messages: [],
      facebook: { pageId: fb.pageId, senderId: fb.senderId, messageId: fb.messageId },
    };

    tickets.push(newTicket);
    store.write(tickets);

    // Archive to comms-facebook for Communications tab
    this._archiveFacebook({
      id: fb.messageId || 'fb-' + Date.now(),
      messageId: fb.messageId || '',
      from: { name: `FB User ${fb.senderId || 'unknown'}` },
      senderName: `FB User ${fb.senderId || 'unknown'}`,
      senderId: fb.senderId || '',
      message: text,
      created_time: evt.receivedAt || new Date().toISOString(),
      unread: true,
      type: 'message',
      pageId: fb.pageId || '',
      ticketId: newTicket.id,
    });

    console.log(`[WORKER] FB message → ticket: ${newTicket.subject}`);
    this.broadcast({ type: 'ticket:new', data: newTicket });
    this.broadcast({ type: 'facebook:message', data: { messageId: fb.messageId, senderId: fb.senderId, text, ticketId: newTicket.id } });
    this.broadcast({ type: 'activity', data: { icon: 'facebook', text: `FB message: ${text.substring(0, 60)}`, time: newTicket.createdAt } });

    if (this.alertRouter) {
      this.alertRouter.send('facebook-message', 'high',
        evt.summary || `Facebook message from ${fb.senderId}`,
        { ticketId: newTicket.id, facebookSenderId: fb.senderId }
      );
    }
  }

  _handleFacebookComment(evt) {
    const fb = evt.facebook || {};
    const from = fb.from || {};

    // Archive to comms-facebook for Communications tab
    this._archiveFacebook({
      id: fb.commentId || 'fbc-' + Date.now(),
      messageId: fb.commentId || '',
      from: { name: from.name || 'Unknown', id: from.id || '' },
      senderName: from.name || 'Unknown',
      senderId: from.id || '',
      message: fb.message || '',
      created_time: evt.receivedAt || new Date().toISOString(),
      unread: true,
      type: 'comment',
      pageId: fb.pageId || '',
      postId: fb.postId || '',
      commentId: fb.commentId || '',
    });

    console.log(`[WORKER] FB comment by ${from.name || 'unknown'}: ${(fb.message || '').substring(0, 60)}`);
    this.broadcast({ type: 'facebook:message', data: { commentId: fb.commentId, from, message: fb.message } });
    this.broadcast({ type: 'activity', data: { icon: 'facebook', text: evt.summary, time: evt.receivedAt } });

    if (this.alertRouter) {
      this.alertRouter.send('facebook-comment', 'normal',
        evt.summary || `FB comment by ${from.name || 'someone'}`,
        { commentId: fb.commentId, postId: fb.postId, from }
      );
    }
  }

  // ── Live Chat handlers ─────────────────────────────────
  _handleLivechatStart(evt) {
    const visitor = evt.visitor || {};
    const sessionId = evt.sessionId;
    console.log(`[WORKER] Live chat started: ${visitor.name || 'Visitor'} (${sessionId})`);

    const store = this.jsonStore('livechat-sessions.json');
    const sessions = store.read();

    // Deduplicate
    if (sessions.find(s => s.id === sessionId)) return;

    const session = {
      id: sessionId,
      visitor: { name: visitor.name || 'Visitor', email: visitor.email || '' },
      messages: [],
      status: 'active',
      mode: 'ai',
      startedAt: evt.receivedAt || new Date().toISOString(),
      lastActivity: evt.receivedAt || new Date().toISOString(),
    };
    sessions.unshift(session);
    if (sessions.length > 200) sessions.length = 200;
    store.write(sessions);

    this.broadcast({ type: 'livechat:start', data: session });
    this.broadcast({ type: 'activity', data: { icon: 'chat', text: evt.summary, time: evt.receivedAt } });

    if (this.alertRouter) {
      this.alertRouter.send('livechat-start', 'high',
        evt.summary || `Live chat: ${visitor.name || 'Visitor'}`,
        { sessionId }
      );
    }
  }

  _handleLivechatMessage(evt) {
    const sessionId = evt.sessionId;
    const message = evt.message || {};
    console.log(`[WORKER] Live chat message: ${(message.text || '').substring(0, 60)} (${sessionId})`);

    const store = this.jsonStore('livechat-sessions.json');
    const sessions = store.read();
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      // Deduplicate by message id
      if (!session.messages.find(m => m.id === message.id)) {
        session.messages.push(message);
        session.lastActivity = message.ts || new Date().toISOString();
        store.write(sessions);
      }
    }

    this.broadcast({ type: 'livechat:message', data: { sessionId, message, visitor: evt.visitor } });
    this.broadcast({ type: 'activity', data: { icon: 'chat', text: evt.summary, time: evt.receivedAt } });

  }

  _handleLivechatDefer(evt) {
    const visitorName = evt.visitor?.name || 'Visitor';
    const question = evt.question || 'unknown question';
    const sessionId = evt.sessionId;
    console.log(`[WORKER] AI DEFERRED to founder — ${visitorName}: ${question.substring(0, 80)}`);

    // Update local session mode to 'transferring'
    const store = this.jsonStore('livechat-sessions.json');
    const sessions = store.read();
    const session = sessions.find(s => s.id === sessionId);
    if (session && session.mode !== 'agent') {
      session.mode = 'transferring';
      store.write(sessions);
    }

    // Push notification to Z Fold
    if (this.alertRouter?.sms) {
      const sms = this.alertRouter.sms;
      const msg = `Chat needs you! ${visitorName} asked: "${question.substring(0, 120)}"`;

      // 1. Notification (existing)
      sms.send(msg).then(r => {
        if (r.sent) console.log(`[WORKER] Defer notification sent to Z Fold`);
        else console.log(`[WORKER] Defer notification failed: ${r.reason}`);
      });

      // 2. TTS voice alert
      const speechMsg = `Chat needs you. ${visitorName} asked about ${question.substring(0, 80)}`;
      sms.speakAlert(speechMsg).then(r => {
        if (r.spoke) console.log(`[WORKER] TTS alert spoken on Z Fold`);
      });

      // 3. Auto-open Hub chat on phone
      const hubUrl = `http://100.73.4.77:8888/#comms/livechat-${sessionId}`;
      sms.openUrl(hubUrl).then(r => {
        if (r.opened) console.log(`[WORKER] Opened chat on Z Fold`);
      });
    }

    // Broadcast to dashboard
    this.broadcast({ type: 'livechat:defer', data: { sessionId, visitor: evt.visitor, question } });
    this.broadcast({ type: 'activity', data: { icon: 'alert', text: evt.summary, time: evt.receivedAt } });
  }

  _handleLivechatNotes(evt) {
    const sessionId = evt.sessionId;
    const notes = evt.notes || [];
    if (notes.length === 0) return;

    console.log(`[WORKER] Received ${notes.length} AI notes for session ${sessionId}`);

    const store = this.jsonStore('livechat-sessions.json');
    const sessions = store.read();
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      if (!session.agentNotes) session.agentNotes = [];
      for (const note of notes) {
        // Deduplicate by note id
        if (!session.agentNotes.find(n => n.id === note.id)) {
          session.agentNotes.push(note);
        }
      }
      store.write(sessions);
    }

    this.broadcast({ type: 'livechat:notes', data: { sessionId, notes } });
  }

  _handleLivechatEnd(evt) {
    const sessionId = evt.sessionId;
    console.log(`[WORKER] Live chat ended: ${sessionId}`);

    const store = this.jsonStore('livechat-sessions.json');
    const sessions = store.read();
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      session.status = 'ended';
      session.endedAt = evt.receivedAt || new Date().toISOString();
      store.write(sessions);
    }

    this.broadcast({ type: 'livechat:end', data: { sessionId } });
    this.broadcast({ type: 'activity', data: { icon: 'chat', text: `Chat ended: ${sessionId}`, time: evt.receivedAt } });
  }

  // ── Archive helpers for Communications tab ──────────────
  _archiveFacebook(msg) {
    try {
      const store = this.jsonStore('comms-facebook.json');
      const messages = store.read();
      if (msg.id && messages.find(m => m.id === msg.id)) return;
      messages.unshift(msg);
      if (messages.length > 500) messages.length = 500;
      store.write(messages);
    } catch (err) {
      console.error('[WORKER] Facebook archive error:', err.message);
    }
  }

  getStatus() {
    return {
      status: this.status,
      lastCheck: this.lastCheck,
      checkCount: this.checkCount,
      error: this.error,
      workerUrl: this.config.workerUrl,
      pollInterval: this.config.pollInterval,
    };
  }
}

module.exports = WorkerPoller;
