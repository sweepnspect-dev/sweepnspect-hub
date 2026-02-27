// ══════════════════════════════════════════════════════════
// Analytics View — Cloudflare Web Analytics, App Metrics
// Promoted from Marketing to first-class view
// ══════════════════════════════════════════════════════════
const AnalyticsView = {
  data: null,

  render(container) {
    container.innerHTML = `
      <div class="analytics-view">
        <div class="stat-grid analytics-stats">
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
          <div class="panel">
            <div class="panel-header"><h2>Website Traffic (7 days)</h2></div>
            <div class="panel-body">
              <div class="mini-chart" id="mktWebChart" style="height:100px"></div>
              <div id="mktWebTable"></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header"><h2>Traffic Sources</h2></div>
            <div class="panel-body" id="mktSources">
              <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
            </div>
          </div>
        </div>

        <div class="panel-grid">
          <div class="panel">
            <div class="panel-header"><h2>App Usage (7 days)</h2></div>
            <div class="panel-body">
              <div class="mini-chart" id="mktAppChart" style="height:100px"></div>
              <div id="mktAppTable"></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header"><h2>Most Used Screens</h2></div>
            <div class="panel-body" id="mktScreens">
              <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Top Website Pages</h2></div>
          <div class="panel-body" id="mktPages">
            <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Ad Campaigns</h2></div>
          <div class="panel-body" id="mktCampaigns">
            <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
          </div>
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
      console.error('Analytics load error:', e);
    }
  },

  renderAll() {
    const d = this.data;
    if (!d) return;

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
      el('mktWebTable').innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <tr><th>Date</th><th>Visitors</th><th>Page Views</th><th>Bounce</th></tr>
            ${daily.map(r => `<tr>
              <td>${this.shortDate(r.date)}</td>
              <td>${r.visitors}</td>
              <td>${r.pageViews}</td>
              <td>${r.bounceRate}%</td>
            </tr>`).join('')}
          </table>
        </div>
      `;
    }

    // Traffic sources
    if (el('mktSources')) {
      const sources = web.sources || [];
      if (sources.length === 0) {
        el('mktSources').innerHTML = '<div class="empty-state" style="padding:16px"><p>No source data</p></div>';
      } else {
        el('mktSources').innerHTML = sources.map(s => `
          <div class="source-row">
            <div class="source-name">${s.source}</div>
            <div class="source-bar-wrap">
              <div class="source-bar" style="width:${s.percent}%"></div>
            </div>
            <div class="source-pct">${s.percent}%</div>
            <div class="source-count">${s.visitors}</div>
          </div>
        `).join('');
      }
    }

    // App chart
    this.renderBarChart('mktAppChart', appDaily, 'sessions', 'var(--green)');

    // App daily table
    if (el('mktAppTable')) {
      el('mktAppTable').innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <tr><th>Date</th><th>Downloads</th><th>Active</th><th>Sessions</th><th>Crashes</th></tr>
            ${appDaily.map(r => `<tr>
              <td>${this.shortDate(r.date)}</td>
              <td>${r.downloads}</td>
              <td>${r.activeUsers}</td>
              <td>${r.sessions}</td>
              <td style="color:${r.crashes > 3 ? 'var(--brick)' : 'var(--text-dim)'}">${r.crashes}</td>
            </tr>`).join('')}
          </table>
        </div>
      `;
    }

    // Top screens
    if (el('mktScreens')) {
      const screens = app.topScreens || [];
      if (screens.length === 0) {
        el('mktScreens').innerHTML = '<div class="empty-state" style="padding:16px"><p>No screen data</p></div>';
      } else {
        el('mktScreens').innerHTML = screens.map((s, i) => `
          <div class="screen-row">
            <span class="screen-rank">${i + 1}</span>
            <div class="screen-name">${s.screen}</div>
            <div class="screen-views">${s.views.toLocaleString()} views</div>
            <div class="screen-time">${s.avgTime}s avg</div>
          </div>
        `).join('');
      }
    }

    // Top pages
    if (el('mktPages')) {
      const pages = web.topPages || [];
      if (pages.length === 0) {
        el('mktPages').innerHTML = '<div class="empty-state" style="padding:16px"><p>No page data</p></div>';
      } else {
        el('mktPages').innerHTML = `
          <div class="table-scroll">
            <table class="data-table">
              <tr><th>#</th><th>Page</th><th>Views</th><th>Avg Time</th></tr>
              ${pages.map((p, i) => `<tr>
                <td>${i + 1}</td>
                <td><span style="color:var(--cream)">${p.title}</span> <span style="color:var(--text-dim);font-size:11px">${p.path}</span></td>
                <td>${p.views.toLocaleString()}</td>
                <td>${p.avgTime}s</td>
              </tr>`).join('')}
            </table>
          </div>
        `;
      }
    }

    // Campaigns
    if (el('mktCampaigns')) {
      const campaigns = d.campaigns || [];
      if (campaigns.length === 0) {
        el('mktCampaigns').innerHTML = '<div class="empty-state" style="padding:16px"><p>No campaigns</p></div>';
      } else {
        el('mktCampaigns').innerHTML = `
          <div class="table-scroll">
            <table class="data-table">
              <tr><th>Campaign</th><th>Status</th><th>Spent</th><th>Leads</th><th>Conversions</th><th>ROI</th></tr>
              ${campaigns.map(c => `<tr>
                <td style="color:var(--cream)">${c.name}</td>
                <td><span class="status-badge ${c.status}">${c.status}</span></td>
                <td style="font-family:var(--font-mono)">$${c.spent}</td>
                <td>${c.leads}</td>
                <td>${c.conversions}</td>
                <td style="color:${c.roi > 250 ? 'var(--green)' : 'var(--text)'}; font-family:var(--font-mono)">${c.roi}%</td>
              </tr>`).join('')}
            </table>
          </div>
        `;
      }
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
