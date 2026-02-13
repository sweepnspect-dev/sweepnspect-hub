// ── Revenue View ────────────────────────────────────────
const RevenueView = {
  entries: [],

  render(container) {
    container.innerHTML = `
      <div class="stat-grid" id="revStats">
        <div class="stat-card">
          <div class="stat-label">MRR</div>
          <div class="stat-value brass" id="revMrr">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">This Month</div>
          <div class="stat-value success" id="revMonth">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Refunds</div>
          <div class="stat-value danger" id="revRefunds">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">All Time</div>
          <div class="stat-value" id="revAllTime">-</div>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-bottom:16px">
        <button class="btn btn-primary" onclick="RevenueView.showNewModal()">+ Add Entry</button>
      </div>

      <div class="panel">
        <div class="panel-header"><h2>Transactions</h2></div>
        <div class="panel-body" style="padding:0">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Subscriber</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="revBody">
              <tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    this.loadEntries();
  },

  async loadEntries() {
    this.entries = await App.api('revenue');
    this.renderTable();
  },

  renderTable() {
    const el = document.getElementById('revBody');
    if (!el) return;
    if (this.entries.length === 0) {
      el.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">No transactions yet</td></tr>';
      return;
    }
    el.innerHTML = this.entries.map(r => `
      <tr>
        <td style="color:var(--text-dim)">${r.date ? new Date(r.date).toLocaleDateString() : ''}</td>
        <td>
          <span style="font-size:10px;font-weight:600;text-transform:uppercase;padding:2px 8px;border-radius:10px;
            background:${r.type === 'refund' ? 'rgba(192,57,43,0.15)' : r.type === 'subscription' ? 'rgba(39,174,96,0.15)' : 'rgba(212,165,116,0.15)'};
            color:${r.type === 'refund' ? 'var(--brick)' : r.type === 'subscription' ? 'var(--green)' : 'var(--brass)'}">${r.type}</span>
        </td>
        <td style="font-weight:600;color:${r.type === 'refund' ? 'var(--brick)' : 'var(--green)'}">
          ${r.type === 'refund' ? '-' : '+'}$${r.amount}
        </td>
        <td style="color:var(--text-dim)">${r.subscriberId || ''}</td>
        <td style="color:var(--text-dim)">${this.esc(r.note || '')}</td>
        <td><button class="task-delete" onclick="RevenueView.deleteEntry('${r.id}')">&times;</button></td>
      </tr>
    `).join('');
  },

  onStats(stats) {
    const el = (id) => document.getElementById(id);
    if (el('revMrr')) el('revMrr').textContent = `$${stats.revenue.mrr.toLocaleString()}`;
    if (el('revMonth')) el('revMonth').textContent = `$${stats.revenue.monthRevenue.toLocaleString()}`;
    if (el('revRefunds')) el('revRefunds').textContent = `$${stats.revenue.monthRefunds.toLocaleString()}`;
    if (el('revAllTime')) el('revAllTime').textContent = `$${stats.revenue.totalAllTime.toLocaleString()}`;
  },

  showNewModal() {
    App.showModal('Add Transaction', `
      <div class="form-group">
        <label>Type</label>
        <select class="form-select" id="revType">
          <option value="subscription">Subscription</option>
          <option value="one-time">One-time</option>
          <option value="refund">Refund</option>
        </select>
      </div>
      <div class="form-group">
        <label>Amount ($)</label>
        <input class="form-input" id="revAmount" type="number" placeholder="49">
      </div>
      <div class="form-group">
        <label>Subscriber ID (optional)</label>
        <input class="form-input" id="revSubId" placeholder="s-001">
      </div>
      <div class="form-group">
        <label>Note</label>
        <input class="form-input" id="revNote" placeholder="Monthly payment, etc.">
      </div>
    `, async (overlay) => {
      const data = {
        type: overlay.querySelector('#revType').value,
        amount: parseFloat(overlay.querySelector('#revAmount').value) || 0,
        subscriberId: overlay.querySelector('#revSubId').value,
        note: overlay.querySelector('#revNote').value
      };
      if (!data.amount) return HubNotify.toast('Amount is required', 'error');
      await App.api('revenue', { method: 'POST', body: data });
      HubNotify.toast('Transaction added', 'success');
      this.loadEntries();
    });
  },

  async deleteEntry(id) {
    if (!confirm('Delete this transaction?')) return;
    await App.api(`revenue/${id}`, { method: 'DELETE' });
    HubNotify.toast('Deleted', 'success');
    this.loadEntries();
  },

  onWsMessage(type) {
    if (type.startsWith('revenue:')) this.loadEntries();
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
