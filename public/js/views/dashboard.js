// ── Dashboard View ──────────────────────────────────────
const DashboardView = {
  render(container) {
    container.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Open Tickets</div>
          <div class="stat-value danger" id="dashTickets">-</div>
          <div class="stat-sub" id="dashTicketSub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Subscribers</div>
          <div class="stat-value brass" id="dashSubs">-</div>
          <div class="stat-sub" id="dashSubSub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Monthly Revenue</div>
          <div class="stat-value success" id="dashMrr">-</div>
          <div class="stat-sub" id="dashMrrSub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">AI Status</div>
          <div class="stat-value" id="dashAi" style="font-size:20px">-</div>
          <div class="stat-sub" id="dashAiSub"></div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="panel">
          <div class="panel-header">
            <h2>Live Activity</h2>
          </div>
          <div class="panel-body" id="activityFeed">
            <div class="empty-state" style="padding:24px"><p>Waiting for activity...</p></div>
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="panel-header">
              <h2>Quick Actions</h2>
            </div>
            <div class="panel-body">
              <div class="quick-actions">
                <button class="btn btn-primary" onclick="location.hash='tickets'; setTimeout(()=>TicketsView.showNewTicketModal(),100)">New Ticket</button>
                <button class="btn btn-ghost" onclick="location.hash='subscribers'">View Subscribers</button>
                <button class="btn btn-ghost" onclick="location.hash='revenue'">Check Revenue</button>
                <button class="btn btn-ghost" onclick="location.hash='commands'">Tasks</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <h2>Needs Review</h2>
            </div>
            <div class="panel-body" id="dashReviewList">
              <div class="empty-state" style="padding:16px"><p>No tickets waiting</p></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Load recent activity
    this.loadActivity();
    this.loadReviewTickets();
  },

  async loadActivity() {
    // Populate from state
    if (App.state.activities.length > 0) {
      this.renderActivities(App.state.activities);
    }
  },

  async loadReviewTickets() {
    try {
      const tickets = await App.api('tickets?status=review');
      const el = document.getElementById('dashReviewList');
      if (!el) return;
      if (tickets.length === 0) {
        el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No tickets waiting</p></div>';
        return;
      }
      el.innerHTML = `<ul class="ticket-list">${tickets.map(t => `
        <li class="ticket-item" onclick="location.hash='tickets/${t.id}'">
          <div class="ticket-priority ${t.priority}"></div>
          <div class="ticket-info">
            <div class="ticket-subject">${t.subject}</div>
            <div class="ticket-meta">${t.id} &middot; ${App.timeAgo(t.createdAt)}</div>
          </div>
          <span class="ticket-status ${t.status}">${t.status}</span>
        </li>
      `).join('')}</ul>`;
    } catch (e) { /* ignore if server unreachable */ }
  },

  onStats(stats) {
    const el = (id) => document.getElementById(id);
    if (el('dashTickets')) {
      el('dashTickets').textContent = stats.tickets.open;
      el('dashTickets').className = `stat-value ${stats.tickets.open > 0 ? 'danger' : 'success'}`;
      el('dashTicketSub').textContent = `${stats.tickets.aiWorking} AI-working, ${stats.tickets.needsReview} needs review`;
    }
    if (el('dashSubs')) {
      el('dashSubs').textContent = stats.subscribers.active;
      el('dashSubSub').textContent = `${stats.subscribers.trial} trial, ${stats.subscribers.churned} churned`;
    }
    if (el('dashMrr')) {
      el('dashMrr').textContent = `$${stats.revenue.mrr.toLocaleString()}`;
      el('dashMrrSub').textContent = `$${stats.revenue.monthRevenue.toLocaleString()} this month`;
    }
    if (el('dashAi')) {
      const working = stats.tickets.aiWorking;
      el('dashAi').textContent = working > 0 ? `Analyzing ${working} ticket${working > 1 ? 's' : ''}` : 'Idle';
      el('dashAi').style.color = working > 0 ? 'var(--purple)' : 'var(--green)';
      el('dashAiSub').textContent = `${stats.tickets.resolved} resolved total`;
    }
  },

  onActivity(data) {
    App.state.activities.unshift(data);
    this.renderActivities(App.state.activities);
  },

  renderActivities(activities) {
    const el = document.getElementById('activityFeed');
    if (!el) return;
    const items = activities.slice(0, 15);
    if (items.length === 0) return;
    el.innerHTML = `<ul class="activity-list">${items.map(a => `
      <li class="activity-item">
        <div class="activity-dot ${a.icon || 'system'}"></div>
        <div>
          <div class="activity-text">${a.text}</div>
          <div class="activity-time">${App.timeAgo(a.time)}</div>
        </div>
      </li>
    `).join('')}</ul>`;
  }
};
