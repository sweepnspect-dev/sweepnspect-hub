// ── Tawk.to Webhook — Live Chat Integration ──────────────
const router = require('express').Router();

// Tawk.to sends webhooks for chat events
// Docs: https://developer.tawk.to/webhooks/
router.post('/', (req, res) => {
  const broadcast = req.app.locals.broadcast;
  const alertRouter = req.app.locals.alertRouter;
  const event = req.body.event || req.body.type;
  const data = req.body;

  console.log(`[TAWK] Webhook: ${event}`);

  switch (event) {
    case 'chat:start': {
      const visitor = data.visitor || data.requester || {};
      const name = visitor.name || 'Visitor';
      const city = visitor.city || '';

      broadcast({
        type: 'activity',
        data: {
          type: 'chat',
          text: `Live chat started: ${name}${city ? ' from ' + city : ''}`,
          timestamp: new Date().toISOString(),
        }
      });

      broadcast({ type: 'chat:start', data: { name, city, chatId: data.chatId || data.id } });

      // Archive to comms-tawk for Communications tab
      const chatStore = req.app.locals.jsonStore('comms-tawk.json');
      const chatMsgs = chatStore.read();
      const chatId = data.chatId || data.id || 'tawk-' + Date.now();
      if (!chatMsgs.find(m => m.id === chatId)) {
        chatMsgs.unshift({
          id: chatId, chatId,
          visitorName: name, visitorEmail: visitor.email || '',
          message: `Chat started${city ? ' from ' + city : ''}`,
          time: new Date().toISOString(),
          unread: true, type: 'chat-start', messages: [],
        });
        if (chatMsgs.length > 500) chatMsgs.length = 500;
        chatStore.write(chatMsgs);
      }
      broadcast({ type: 'tawk:message', data: { chatId, name } });

      alertRouter.send('chat-start', 'high',
        `Live chat: ${name}${city ? ' (' + city + ')' : ''} is on sweepnspect.com`,
        { name, city, chatId: data.chatId || data.id }
      );
      break;
    }

    case 'chat:end': {
      const visitor = data.visitor || data.requester || {};
      const name = visitor.name || 'Visitor';

      broadcast({
        type: 'activity',
        data: {
          type: 'chat',
          text: `Chat ended: ${name}`,
          timestamp: new Date().toISOString(),
        }
      });

      broadcast({ type: 'chat:end', data: { name, chatId: data.chatId || data.id } });
      break;
    }

    case 'ticket:create': {
      // Tawk.to offline form creates a "ticket"
      const subject = data.subject || data.message?.substring(0, 80) || 'Chat inquiry';
      const name = data.requester?.name || data.visitor?.name || 'Visitor';
      const email = data.requester?.email || data.visitor?.email || '';
      const message = data.message || '';

      // Create a ticket in our system
      const store = req.app.locals.jsonStore('tickets.json');
      const tickets = store.read();

      const ticket = {
        id: store.nextId('t'),
        status: 'new',
        priority: 'normal',
        source: 'tawk-chat',
        emailUid: null,
        customer: { name, email, subscriberId: '' },
        subject: subject,
        description: message,
        aiAnalysis: null,
        resolution: '',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        messages: []
      };

      tickets.push(ticket);
      store.write(tickets);

      broadcast({ type: 'ticket:new', data: ticket });
      broadcast({
        type: 'activity',
        data: {
          icon: 'ticket',
          text: `Chat ticket from ${name}: ${subject}`,
          time: ticket.createdAt
        }
      });

      // Archive to comms-tawk for Communications tab
      const tStore = req.app.locals.jsonStore('comms-tawk.json');
      const tMsgs = tStore.read();
      const tId = data.chatId || data.id || 'tawk-' + Date.now();
      if (!tMsgs.find(m => m.id === tId)) {
        tMsgs.unshift({
          id: tId, chatId: tId,
          visitorName: name, visitorEmail: email,
          message: message || subject,
          time: ticket.createdAt,
          unread: true, type: 'ticket', ticketId: ticket.id,
          messages: [],
        });
        if (tMsgs.length > 500) tMsgs.length = 500;
        tStore.write(tMsgs);
      }
      broadcast({ type: 'tawk:message', data: { chatId: tId, name, ticketId: ticket.id } });

      alertRouter.send('chat-ticket', 'normal',
        `Chat ticket: ${name} — ${subject}`,
        { ticketId: ticket.id, name, email }
      );

      console.log(`[TAWK] Created ticket ${ticket.id} from chat: ${subject}`);
      break;
    }

    default:
      console.log(`[TAWK] Unhandled event: ${event}`, JSON.stringify(data).substring(0, 200));
  }

  res.json({ ok: true });
});

// Status endpoint — for testing webhook connectivity
router.get('/status', (req, res) => {
  res.json({
    status: 'ready',
    webhook: '/api/webhooks/tawk',
    events: ['chat:start', 'chat:end', 'ticket:create']
  });
});

module.exports = router;
