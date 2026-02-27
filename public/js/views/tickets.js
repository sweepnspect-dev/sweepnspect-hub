// ══════════════════════════════════════════════════════════
// Tickets View — Support Tickets, AI Analysis
// ══════════════════════════════════════════════════════════
const TicketsView = {
  tickets: [],
  filter: 'all',
  selectedTicket: null,

  render(container, hash) {
    const parts = hash ? hash.split('/') : [];
    if (parts.length > 1 && parts[1]) {
      this.renderDetail(container, parts[1]);
      return;
    }

    container.innerHTML = `
      <div class="tickets-view">
        <div class="tickets-toolbar">
          <div class="tickets-filters">
            <button class="btn btn-sm ${this.filter === 'all' ? 'btn-primary' : 'btn-ghost'}" onclick="TicketsView.setFilter('all')">All</button>
            <button class="btn btn-sm ${this.filter === 'new' ? 'btn-primary' : 'btn-ghost'}" onclick="TicketsView.setFilter('new')">New</button>
            <button class="btn btn-sm ${this.filter === 'ai-working' ? 'btn-primary' : 'btn-ghost'}" onclick="TicketsView.setFilter('ai-working')">AI Working</button>
            <button class="btn btn-sm ${this.filter === 'review' ? 'btn-primary' : 'btn-ghost'}" onclick="TicketsView.setFilter('review')">Review</button>
            <button class="btn btn-sm ${this.filter === 'resolved' ? 'btn-primary' : 'btn-ghost'}" onclick="TicketsView.setFilter('resolved')">Resolved</button>
          </div>
          <button class="btn btn-primary" onclick="TicketsView.showNewTicketModal()">+ New Ticket</button>
        </div>
        <div class="panel">
          <div class="panel-body" id="ticketListContainer">
            <div class="empty-state"><p>Loading...</p></div>
          </div>
        </div>
      </div>
    `;
    this.loadTickets();
  },

  async loadTickets() {
    const filterParam = this.filter !== 'all' ? `?status=${this.filter}` : '';
    this.tickets = await App.api(`tickets${filterParam}`);
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('ticketListContainer');
    if (!el) return;
    if (this.tickets.length === 0) {
      el.innerHTML = '<div class="empty-state"><p>No tickets found</p></div>';
      return;
    }
    el.innerHTML = `<ul class="ticket-list">${this.tickets.map(t => `
      <li class="ticket-item" onclick="location.hash='tickets/${t.id}'">
        <div class="ticket-priority ${t.priority}"></div>
        <div class="ticket-info">
          <div class="ticket-subject">${App.esc(t.subject)}</div>
          <div class="ticket-meta">${t.id} &middot; ${t.customer?.name || 'Unknown'} &middot; ${App.timeAgo(t.createdAt)}</div>
        </div>
        <span class="ticket-status ${t.status}">${t.status.replace('-', ' ')}</span>
      </li>
    `).join('')}</ul>`;
  },

  async renderDetail(container, ticketId) {
    const ticket = await App.api(`tickets/${ticketId}`);
    if (ticket.error) {
      container.innerHTML = '<div class="empty-state"><p>Ticket not found</p><button class="btn btn-ghost" onclick="location.hash=\'tickets\'">Back</button></div>';
      return;
    }
    this.selectedTicket = ticket;

    const ai = ticket.aiAnalysis;
    const aiHtml = ai ? `
      <div class="ai-analysis">
        <h3>AI Analysis (${Math.round((ai.confidence || 0) * 100)}% confidence)</h3>
        <p><strong>Diagnosis:</strong> ${App.esc(ai.diagnosis)}</p>
        <p style="margin-top:8px"><strong>Proposed Fix:</strong> ${App.esc(ai.proposedFix)}</p>
        ${ai.relatedIssues?.length ? `<p style="margin-top:8px;font-size:11px;color:var(--text-dim)">Related: ${ai.relatedIssues.join(', ')}</p>` : ''}
        <div class="ai-actions">
          <button class="btn btn-success btn-sm" onclick="TicketsView.approveAi('${ticket.id}')">Approve & Resolve</button>
          <button class="btn btn-ghost btn-sm" onclick="TicketsView.updateStatus('${ticket.id}', 'escalated')">Escalate</button>
        </div>
      </div>
    ` : (ticket.status === 'ai-working' ? '<div class="ai-analysis"><h3>AI Analysis</h3><p>Claude is analyzing this ticket...</p></div>' : '');

    const priorityColor = ticket.priority === 'critical' ? 'var(--brick)' : ticket.priority === 'high' ? 'var(--yellow)' : 'var(--cyan)';

    container.innerHTML = `
      <div class="tickets-view">
        <div style="margin-bottom:16px">
          <button class="btn btn-ghost btn-sm" onclick="location.hash='tickets'">&larr; Back to list</button>
        </div>
        <div class="panel ticket-detail">
          <div class="ticket-detail-header">
            <h2>${App.esc(ticket.subject)}</h2>
            <div class="ticket-detail-meta">
              <span>${ticket.id}</span>
              <span class="ticket-status ${ticket.status}">${ticket.status.replace('-', ' ')}</span>
              <span class="ticket-priority-badge" style="background:${priorityColor}">${ticket.priority}</span>
              <span>${ticket.customer?.name || 'Unknown'} (${ticket.customer?.email || ''})</span>
              <span>${App.timeAgo(ticket.createdAt)}</span>
            </div>
          </div>
          <div style="padding:16px 20px">
            <p style="font-size:13px;line-height:1.6;color:var(--text)">${App.esc(ticket.description)}</p>
          </div>
          ${aiHtml}
          <div class="ticket-actions">
            ${ticket.status !== 'resolved' ? `
              <select class="form-select" style="width:auto" onchange="TicketsView.updateStatus('${ticket.id}', this.value)">
                <option value="">Change status...</option>
                <option value="new">New</option>
                <option value="ai-working">Send to AI</option>
                <option value="review">Mark for Review</option>
                <option value="resolved">Resolve</option>
                <option value="escalated">Escalate</option>
              </select>
            ` : '<span style="color:var(--green);font-size:13px">Resolved ' + App.timeAgo(ticket.resolvedAt) + '</span>'}
            <button class="btn btn-ghost btn-sm" onclick="TicketsView.showAddMessageModal('${ticket.id}')">Add Message</button>
          </div>
          <div class="message-thread" id="messageThread">
            ${(ticket.messages || []).map(m => `
              <div class="message from-${m.from}">
                <div class="message-from">${m.from} &middot; ${App.timeAgo(m.timestamp)}</div>
                ${App.esc(m.text)}
              </div>
            `).join('') || '<p style="color:var(--text-muted);font-size:13px">No messages yet</p>'}
          </div>
        </div>
      </div>
    `;
  },

  setFilter(f) {
    this.filter = f;
    App.route();
  },

  async updateStatus(id, status) {
    if (!status) return;
    await App.api(`tickets/${id}`, { method: 'PUT', body: { status } });
    HubNotify.toast(`Ticket ${status}`, 'success');
    if (location.hash.includes(id)) App.route();
  },

  async approveAi(id) {
    await App.api(`tickets/${id}`, { method: 'PUT', body: { status: 'resolved' } });
    HubNotify.toast('AI fix approved, ticket resolved', 'success');
    App.route();
  },

  showNewTicketModal() {
    App.showModal('New Ticket', `
      <div class="form-group">
        <label>Subject</label>
        <input class="form-input" id="newTicketSubject" placeholder="What's the issue?">
      </div>
      <div class="form-group">
        <label>Customer Name</label>
        <input class="form-input" id="newTicketCustomer" placeholder="Customer name">
      </div>
      <div class="form-group">
        <label>Customer Email</label>
        <input class="form-input" id="newTicketEmail" placeholder="email@example.com">
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select class="form-select" id="newTicketPriority">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-textarea" id="newTicketDesc" placeholder="Describe the issue..."></textarea>
      </div>
    `, async (overlay) => {
      const subject = overlay.querySelector('#newTicketSubject').value;
      const name = overlay.querySelector('#newTicketCustomer').value;
      const email = overlay.querySelector('#newTicketEmail').value;
      const priority = overlay.querySelector('#newTicketPriority').value;
      const description = overlay.querySelector('#newTicketDesc').value;
      if (!subject) return HubNotify.toast('Subject is required', 'error');
      await App.api('tickets', {
        method: 'POST',
        body: { subject, description, priority, customer: { name, email, subscriberId: '' } }
      });
      HubNotify.toast('Ticket created', 'success');
      this.loadTickets();
    });
  },

  showAddMessageModal(ticketId) {
    App.showModal('Add Message', `
      <div class="form-group">
        <label>From</label>
        <select class="form-select" id="msgFrom">
          <option value="support">Support (You)</option>
          <option value="customer">Customer</option>
          <option value="ai">AI / Claude</option>
        </select>
      </div>
      <div class="form-group">
        <label>Message</label>
        <textarea class="form-textarea" id="msgText" placeholder="Type message..."></textarea>
      </div>
    `, async (overlay) => {
      const from = overlay.querySelector('#msgFrom').value;
      const text = overlay.querySelector('#msgText').value;
      if (!text) return;
      await App.api(`tickets/${ticketId}/messages`, { method: 'POST', body: { from, text } });
      HubNotify.toast('Message added', 'success');
      App.route();
    });
  },

  onWsMessage(type) {
    if (type.startsWith('ticket:')) this.loadTickets();
  }
};
