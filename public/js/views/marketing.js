// ── Marketing View ──────────────────────────────────────
const MarketingView = {
  data: null,

  render(container) {
    container.innerHTML = `
      <div class="stat-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
        <div class="stat-card">
          <div class="stat-label">Website Visitors</div>
          <div class="stat-value brass" id="mktVisitors">-</div>
          <div class="stat-sub">last 7 days</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Page Views</div>
          <div class="stat-value" id="mktPageViews">-</div>
          <div class="stat-sub">last 7 days</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">App Downloads</div>
          <div class="stat-value success" id="mktDownloads">-</div>
          <div class="stat-sub">last 7 days</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active App Users</div>
          <div class="stat-value brass" id="mktActiveUsers">-</div>
          <div class="stat-sub">today</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">App Rating</div>
          <div class="stat-value success" id="mktRating">-</div>
          <div class="stat-sub" id="mktReviews">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Crash Rate</div>
          <div class="stat-value" id="mktCrashRate">-</div>
          <div class="stat-sub">last 7 days</div>
        </div>
      </div>

      <div class="panel-grid">
        <!-- Website Traffic -->
        <div class="panel">
          <div class="panel-header"><h2>Website Traffic (7 days)</h2></div>
          <div class="panel-body">
            <div class="mini-chart" id="mktWebChart" style="height:100px"></div>
            <div id="mktWebTable"></div>
          </div>
        </div>

        <!-- Traffic Sources -->
        <div class="panel">
          <div class="panel-header"><h2>Where Visitors Come From</h2></div>
          <div class="panel-body" id="mktSources">
            <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
          </div>
        </div>
      </div>

      <div class="panel-grid">
        <!-- App Usage -->
        <div class="panel">
          <div class="panel-header"><h2>App Usage (7 days)</h2></div>
          <div class="panel-body">
            <div class="mini-chart" id="mktAppChart" style="height:100px"></div>
            <div id="mktAppTable"></div>
          </div>
        </div>

        <!-- Top Screens -->
        <div class="panel">
          <div class="panel-header"><h2>Most Used App Screens</h2></div>
          <div class="panel-body" id="mktScreens">
            <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
          </div>
        </div>
      </div>

      <!-- Top Pages -->
      <div class="panel">
        <div class="panel-header"><h2>Top Website Pages</h2></div>
        <div class="panel-body" id="mktPages">
          <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
        </div>
      </div>

      <!-- Campaigns -->
      <div class="panel">
        <div class="panel-header"><h2>Ad Campaigns</h2></div>
        <div class="panel-body" id="mktCampaigns">
          <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
        </div>
      </div>
    `;

    this.loadData();
  },

  async loadData() {
    try {
      this.data = await App.api('marketing');
      this.renderAll();
    } catch (e) {
      console.error('Marketing load error:', e);
    }
  },

  renderAll() {
    const d = this.data;
    if (!d) return;

    // Top stats
    const web = d.website || {};
    const app = d.app || {};
    const daily = web.daily || [];
    const appDaily = app.daily || [];

    const totalVisitors = daily.reduce((s, r) => s + r.visitors, 0);
    const totalPageViews = daily.reduce((s, r) => s + r.pageViews, 0);
    const totalDownloads = appDaily.reduce((s, r) => s + r.downloads, 0);
    const todayApp = appDaily[appDaily.length - 1] || {};
    const totalCrashes = appDaily.reduce((s, r) => s + r.crashes, 0);
    const totalSessions = appDaily.reduce((s, r) => s + r.sessions, 0);
    const crashRate = totalSessions > 0 ? ((totalCrashes / totalSessions) * 100).toFixed(1) : '0';

    const el = (id) => document.getElementById(id);
    if (el('mktVisitors')) el('mktVisitors').textContent = totalVisitors.toLocaleString();
    if (el('mktPageViews')) el('mktPageViews').textContent = totalPageViews.toLocaleString();
    if (el('mktDownloads')) el('mktDownloads').textContent = totalDownloads;
    if (el('mktActiveUsers')) el('mktActiveUsers').textContent = todayApp.activeUsers || app.overview?.dailyActive || '-';
    if (el('mktRating')) el('mktRating').textContent = app.overview?.appRating || '-';
    if (el('mktReviews')) el('mktReviews').textContent = `${app.overview?.reviewCount || 0} reviews`;
    if (el('mktCrashRate')) {
      el('mktCrashRate').textContent = crashRate + '%';
      el('mktCrashRate').className = `stat-value ${parseFloat(crashRate) > 2 ? 'danger' : 'success'}`;
    }

    // Website chart
    this.renderBarChart('mktWebChart', daily, 'visitors', 'var(--brass)');

    // Website daily table
    if (el('mktWebTable')) {
      el('mktWebTable').innerHTML = `<table class="data-table">
        <tr><th>Date</th><th>Visitors</th><th>Page Views</th><th>Bounce</th></tr>
        ${daily.map(r => `<tr>
          <td>${this.shortDate(r.date)}</td>
          <td>${r.visitors}</td>
          <td>${r.pageViews}</td>
          <td>${r.bounceRate}%</td>
        </tr>`).join('')}
      </table>`;
    }

    // Sources
    if (el('mktSources')) {
      const sources = web.sources || [];
      el('mktSources').innerHTML = sources.map(s => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="flex:1;font-size:13px;color:var(--cream)">${s.source}</div>
          <div style="width:120px;height:6px;background:var(--navy);border-radius:3px;overflow:hidden">
            <div style="width:${s.percent}%;height:100%;background:var(--brass);border-radius:3px"></div>
          </div>
          <div style="width:60px;text-align:right;font-size:12px;color:var(--text-dim)">${s.percent}%</div>
          <div style="width:60px;text-align:right;font-size:12px;color:var(--text-dim)">${s.visitors}</div>
        </div>
      `).join('');
    }

    // App chart
    this.renderBarChart('mktAppChart', appDaily, 'sessions', 'var(--green)');

    // App daily table
    if (el('mktAppTable')) {
      el('mktAppTable').innerHTML = `<table class="data-table">
        <tr><th>Date</th><th>Downloads</th><th>Active</th><th>Sessions</th><th>Crashes</th></tr>
        ${appDaily.map(r => `<tr>
          <td>${this.shortDate(r.date)}</td>
          <td>${r.downloads}</td>
          <td>${r.activeUsers}</td>
          <td>${r.sessions}</td>
          <td style="color:${r.crashes > 3 ? 'var(--brick)' : 'var(--text-dim)'}">${r.crashes}</td>
        </tr>`).join('')}
      </table>`;
    }

    // Top screens
    if (el('mktScreens')) {
      const screens = app.topScreens || [];
      el('mktScreens').innerHTML = screens.map((s, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <span style="width:20px;text-align:center;font-size:11px;color:var(--text-dim)">${i + 1}</span>
          <div style="flex:1;font-size:13px;color:var(--cream)">${s.screen}</div>
          <div style="font-size:12px;color:var(--text-dim)">${s.views.toLocaleString()} views</div>
          <div style="font-size:12px;color:var(--text-dim)">${s.avgTime}s avg</div>
        </div>
      `).join('');
    }

    // Top pages
    if (el('mktPages')) {
      const pages = web.topPages || [];
      el('mktPages').innerHTML = `<table class="data-table">
        <tr><th>#</th><th>Page</th><th>Views</th><th>Avg Time</th></tr>
        ${pages.map((p, i) => `<tr>
          <td>${i + 1}</td>
          <td><span style="color:var(--cream)">${p.title}</span> <span style="color:var(--text-dim);font-size:11px">${p.path}</span></td>
          <td>${p.views.toLocaleString()}</td>
          <td>${p.avgTime}s</td>
        </tr>`).join('')}
      </table>`;
    }

    // Campaigns
    if (el('mktCampaigns')) {
      const campaigns = d.campaigns || [];
      el('mktCampaigns').innerHTML = `<table class="data-table">
        <tr><th>Campaign</th><th>Status</th><th>Spent</th><th>Leads</th><th>Conversions</th><th>ROI</th></tr>
        ${campaigns.map(c => `<tr>
          <td style="color:var(--cream)">${c.name}</td>
          <td><span class="ticket-status ${c.status === 'active' ? 'review' : 'escalated'}">${c.status}</span></td>
          <td>$${c.spent}</td>
          <td>${c.leads}</td>
          <td>${c.conversions}</td>
          <td style="color:${c.roi > 250 ? 'var(--green)' : 'var(--text)'}">${c.roi}%</td>
        </tr>`).join('')}
      </table>`;
    }
  },

  renderBarChart(containerId, data, key, color) {
    const el = document.getElementById(containerId);
    if (!el || !data.length) return;
    const max = Math.max(...data.map(d => d[key]));
    el.innerHTML = data.map(d => {
      const pct = max > 0 ? (d[key] / max) * 100 : 0;
      return `<div class="chart-bar" style="height:${pct}%;background:${color}" title="${this.shortDate(d.date)}: ${d[key]}"></div>`;
    }).join('');
  },

  shortDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};
