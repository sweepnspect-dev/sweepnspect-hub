// ── Subscribers View ────────────────────────────────────
const SubscribersView = {
  subscribers: [],

  render(container) {
    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
        <div style="display:flex; gap:8px">
          <button class="btn btn-sm btn-primary" onclick="SubscribersView.loadSubs()">All</button>
          <button class="btn btn-sm btn-ghost" onclick="SubscribersView.loadSubs('active')">Active</button>
          <button class="btn btn-sm btn-ghost" onclick="SubscribersView.loadSubs('trial')">Trial</button>
          <button class="btn btn-sm btn-ghost" onclick="SubscribersView.loadSubs('churned')">Churned</button>
        </div>
        <button class="btn btn-primary" onclick="SubscribersView.showNewModal()">+ Add Subscriber</button>
      </div>
      <div class="panel">
        <div class="panel-body" style="padding:0">
          <table class="data-table" id="subsTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Plan</th>
                <th>MRR</th>
                <th>Status</th>
                <th>Since</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="subsBody">
              <tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    this.loadSubs();
  },

  async loadSubs(status) {
    const param = status ? `?status=${status}` : '';
    this.subscribers = await App.api(`subscribers${param}`);
    this.renderTable();
  },

  renderTable() {
    const el = document.getElementById('subsBody');
    if (!el) return;
    if (this.subscribers.length === 0) {
      el.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">No subscribers found</td></tr>';
      return;
    }
    el.innerHTML = this.subscribers.map(s => `
      <tr>
        <td style="font-weight:500;color:var(--cream)">${this.esc(s.name)}</td>
        <td>${this.esc(s.email)}</td>
        <td><span class="plan-badge ${s.plan}">${s.plan}</span></td>
        <td style="color:var(--brass)">$${s.mrr}</td>
        <td><span class="status-badge ${s.status}">${s.status}</span></td>
        <td style="color:var(--text-dim)">${s.startDate ? new Date(s.startDate).toLocaleDateString() : ''}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="SubscribersView.showEditModal('${s.id}')">Edit</button>
          <button class="task-delete" onclick="SubscribersView.deleteSub('${s.id}')" title="Delete">&times;</button>
        </td>
      </tr>
    `).join('');
  },

  showNewModal() {
    App.showModal('Add Subscriber', this.formHtml(), async (overlay) => {
      const data = this.readForm(overlay);
      if (!data.name) return HubNotify.toast('Name is required', 'error');
      await App.api('subscribers', { method: 'POST', body: data });
      HubNotify.toast('Subscriber added', 'success');
      this.loadSubs();
    });
  },

  showEditModal(id) {
    const sub = this.subscribers.find(s => s.id === id);
    if (!sub) return;
    App.showModal('Edit Subscriber', this.formHtml(sub), async (overlay) => {
      const data = this.readForm(overlay);
      await App.api(`subscribers/${id}`, { method: 'PUT', body: data });
      HubNotify.toast('Subscriber updated', 'success');
      this.loadSubs();
    });
  },

  async deleteSub(id) {
    if (!confirm('Delete this subscriber?')) return;
    await App.api(`subscribers/${id}`, { method: 'DELETE' });
    HubNotify.toast('Subscriber deleted', 'success');
    this.loadSubs();
  },

  formHtml(sub) {
    const s = sub || {};
    return `
      <div class="form-group">
        <label>Name</label>
        <input class="form-input" id="subName" value="${this.esc(s.name || '')}">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input class="form-input" id="subEmail" value="${this.esc(s.email || '')}">
      </div>
      <div class="form-group">
        <label>Plan</label>
        <select class="form-select" id="subPlan">
          <option value="solo" ${s.plan === 'solo' ? 'selected' : ''}>Solo — $29/mo</option>
          <option value="pro" ${s.plan === 'pro' ? 'selected' : ''}>Pro — $49/mo</option>
          <option value="team" ${s.plan === 'team' ? 'selected' : ''}>Team — $99/mo</option>
        </select>
      </div>
      <div class="form-group">
        <label>MRR ($)</label>
        <input class="form-input" id="subMrr" type="number" value="${s.mrr || 0}">
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-select" id="subStatus">
          <option value="trial" ${s.status === 'trial' ? 'selected' : ''}>Trial</option>
          <option value="active" ${s.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="churned" ${s.status === 'churned' ? 'selected' : ''}>Churned</option>
        </select>
      </div>
    `;
  },

  readForm(overlay) {
    return {
      name: overlay.querySelector('#subName').value,
      email: overlay.querySelector('#subEmail').value,
      plan: overlay.querySelector('#subPlan').value,
      mrr: parseFloat(overlay.querySelector('#subMrr').value) || 0,
      status: overlay.querySelector('#subStatus').value
    };
  },

  onWsMessage(type) {
    if (type.startsWith('subscriber:')) this.loadSubs();
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
