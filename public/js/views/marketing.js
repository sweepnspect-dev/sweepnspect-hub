// ══════════════════════════════════════════════════════════
// Marketing View — Facebook Post Management
// Compose, schedule, publish, and track engagement
// ══════════════════════════════════════════════════════════
const MarketingView = {
  posts: [],
  pageInfo: null,
  activeSection: 'feed',  // feed, compose, insights
  editingPost: null,

  render(container, hash) {
    const parts = hash ? hash.split('/') : [];
    if (parts[1] === 'compose') this.activeSection = 'compose';
    else if (parts[1] === 'insights') this.activeSection = 'insights';
    else if (parts[1] && parts[1].startsWith('post-')) {
      this.activeSection = 'feed';
      this.editingPost = parts[1].replace('post-', '');
    } else {
      this.activeSection = 'feed';
    }

    container.innerHTML = `
      <div class="marketing-view">
        <div class="stat-grid marketing-stats" id="mktStats">
          <div class="stat-card">
            <div class="stat-label">Page Followers</div>
            <div class="stat-value brass" id="mktFollowers">—</div>
            <div class="stat-sub" id="mktPageName">Loading...</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Posts This Month</div>
            <div class="stat-value" id="mktPostsMonth">—</div>
            <div class="stat-sub">published</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Reach</div>
            <div class="stat-value brass" id="mktReach">—</div>
            <div class="stat-sub">all posts</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg Engagement</div>
            <div class="stat-value" id="mktEngagement">—</div>
            <div class="stat-sub">likes + comments</div>
          </div>
        </div>

        <div class="comms-toolbar">
          <div class="comms-sources" id="mktSections">
            <button class="source-btn${this.activeSection === 'feed' ? ' active' : ''}" data-section="feed" onclick="MarketingView.setSection('feed')">
              Feed
            </button>
            <button class="source-btn${this.activeSection === 'compose' ? ' active' : ''}" data-section="compose" onclick="MarketingView.setSection('compose')">
              Compose
            </button>
            <button class="source-btn${this.activeSection === 'insights' ? ' active' : ''}" data-section="insights" onclick="MarketingView.setSection('insights')">
              Insights
            </button>
          </div>
          <div class="comms-toolbar-right">
            <button class="btn btn-sm btn-ghost" onclick="MarketingView.syncFromFb()">Sync from Facebook</button>
          </div>
        </div>

        <div id="mktContent" class="marketing-content">
          <div class="empty-state"><p>Loading...</p></div>
        </div>
      </div>
    `;

    this.loadAll();
  },

  async loadAll() {
    const [postsRes, pageRes] = await Promise.allSettled([
      App.api('marketing/posts'),
      App.api('marketing/page').catch(() => null),
    ]);

    this.posts = postsRes.status === 'fulfilled' ? postsRes.value : [];
    if (!Array.isArray(this.posts)) this.posts = [];

    if (pageRes.status === 'fulfilled' && pageRes.value) {
      this.pageInfo = pageRes.value;
    }

    this.renderStats();
    this.renderSection();
  },

  renderStats() {
    const el = (id) => document.getElementById(id);

    if (this.pageInfo) {
      const f = el('mktFollowers');
      if (f) f.textContent = this.formatNum(this.pageInfo.followers_count || this.pageInfo.fan_count || 0);
      const n = el('mktPageName');
      if (n) n.textContent = this.pageInfo.name || 'Facebook Page';
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthPosts = this.posts.filter(p =>
      p.status === 'published' && p.publishedAt && new Date(p.publishedAt) >= monthStart
    );
    const pm = el('mktPostsMonth');
    if (pm) pm.textContent = monthPosts.length;

    const totalReach = this.posts.reduce((s, p) => s + (p.engagement?.reach || 0), 0);
    const r = el('mktReach');
    if (r) r.textContent = this.formatNum(totalReach);

    const published = this.posts.filter(p => p.status === 'published');
    const totalEng = published.reduce((s, p) =>
      s + (p.engagement?.likes || 0) + (p.engagement?.comments || 0), 0);
    const avg = published.length ? Math.round(totalEng / published.length) : 0;
    const e = el('mktEngagement');
    if (e) e.textContent = avg;
  },

  setSection(section) {
    this.activeSection = section;
    this.editingPost = null;
    document.querySelectorAll('#mktSections .source-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === section);
    });
    this.renderSection();
    window.location.hash = section === 'feed' ? '#marketing' : `#marketing/${section}`;
  },

  renderSection() {
    const el = document.getElementById('mktContent');
    if (!el) return;
    if (this.activeSection === 'compose') this.renderCompose(el);
    else if (this.activeSection === 'insights') this.renderInsights(el);
    else this.renderFeed(el);
  },

  // ── Feed Section ─────────────────────────────────────────
  renderFeed(el) {
    if (this.posts.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <p>No posts yet</p>
          <p class="dim">Compose a post or sync from your Facebook page</p>
          <button class="btn btn-primary" style="margin-top:12px" onclick="MarketingView.setSection('compose')">Compose Post</button>
        </div>
      `;
      return;
    }

    const sorted = [...this.posts].sort((a, b) =>
      new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );

    el.innerHTML = `
      <div class="marketing-feed">
        ${sorted.map(p => this.renderPostCard(p)).join('')}
      </div>
    `;
  },

  renderPostCard(post) {
    const statusMap = {
      published: { cls: 'published', label: 'Published' },
      scheduled: { cls: 'scheduled', label: 'Scheduled' },
      draft:     { cls: 'draft',     label: 'Draft' },
      failed:    { cls: 'failed',    label: 'Failed' },
    };
    const s = statusMap[post.status] || { cls: 'draft', label: post.status };
    const eng = post.engagement || {};
    const preview = post.message.length > 180 ? post.message.slice(0, 180) + '...' : post.message;

    let actions = '';
    if (post.status === 'draft' || post.status === 'scheduled') {
      actions += `<button class="btn btn-xs btn-primary" onclick="MarketingView.publishPost('${post.id}')">Publish Now</button>`;
      actions += `<button class="btn btn-xs btn-ghost" onclick="MarketingView.editPost('${post.id}')">Edit</button>`;
    }
    if (post.status === 'published' && post.fbPostId) {
      actions += `<button class="btn btn-xs btn-ghost" onclick="MarketingView.refreshInsights('${post.id}')">Refresh Stats</button>`;
    }
    actions += `<button class="btn btn-xs btn-ghost" style="color:var(--brick-light)" onclick="MarketingView.deletePost('${post.id}')">Delete</button>`;

    let scheduledInfo = '';
    if (post.status === 'scheduled' && post.scheduledFor) {
      scheduledInfo = `<div class="marketing-post-scheduled">Scheduled: ${new Date(post.scheduledFor).toLocaleString()}</div>`;
    }

    let failedInfo = '';
    if (post.status === 'failed' && post.lastError) {
      failedInfo = `<div class="marketing-post-error">${App.esc(post.lastError)}</div>`;
    }

    return `
      <div class="marketing-post-card" data-id="${post.id}">
        <div class="marketing-post-header">
          <span class="marketing-status-badge ${s.cls}">${s.label}</span>
          <span class="marketing-post-date">${App.timeAgo(post.publishedAt || post.createdAt)}</span>
        </div>
        <div class="marketing-post-body">
          ${post.imageUrl ? `<img class="marketing-post-img" src="${App.esc(post.imageUrl)}" alt="">` : ''}
          <div class="marketing-post-message">${App.esc(preview)}</div>
          ${post.link ? `<div class="marketing-post-link">${App.esc(post.link)}</div>` : ''}
          ${scheduledInfo}
          ${failedInfo}
        </div>
        <div class="marketing-post-engagement">
          <span title="Likes">&hearts; ${eng.likes || 0}</span>
          <span title="Comments">&#128172; ${eng.comments || 0}</span>
          <span title="Shares">&#8635; ${eng.shares || 0}</span>
          ${eng.reach ? `<span title="Reach">&#128065; ${this.formatNum(eng.reach)}</span>` : ''}
        </div>
        <div class="marketing-post-actions">${actions}</div>
      </div>
    `;
  },

  // ── Compose Section ──────────────────────────────────────
  renderCompose(el, prefill) {
    const post = prefill || this.editingPost;
    let existingPost = null;
    if (typeof post === 'string') {
      existingPost = this.posts.find(p => p.id === post);
    }

    const msg = existingPost ? existingPost.message : '';
    const link = existingPost ? existingPost.link : '';
    const schedFor = existingPost?.scheduledFor || '';

    el.innerHTML = `
      <div class="marketing-compose panel">
        <div class="panel-header">
          <h2>${existingPost ? 'Edit Post' : 'Compose New Post'}</h2>
          <span class="marketing-char-count" id="mktCharCount">${msg.length} / 63,206</span>
        </div>
        <div class="panel-body">
          <div class="form-group">
            <label class="form-label">Message</label>
            <textarea class="form-textarea" id="mktComposeMsg" rows="6" placeholder="What's on your mind?"
              oninput="MarketingView.updateCharCount()">${App.esc(msg)}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Link (optional)</label>
            <input class="form-input" id="mktComposeLink" type="url" placeholder="https://..." value="${App.esc(link)}">
          </div>
          <div class="form-group">
            <label class="form-label">Schedule For (optional)</label>
            <input class="form-input" id="mktComposeSchedule" type="datetime-local" value="${schedFor ? this.toLocalDatetime(schedFor) : ''}">
          </div>
          <div class="marketing-compose-actions">
            <button class="btn btn-primary" onclick="MarketingView.submitPost('publish')">
              ${existingPost ? 'Update & Publish' : 'Post Now'}
            </button>
            <button class="btn btn-ghost" onclick="MarketingView.submitPost('schedule')">
              Schedule
            </button>
            <button class="btn btn-ghost" onclick="MarketingView.submitPost('draft')">
              Save Draft
            </button>
            ${existingPost ? `<input type="hidden" id="mktEditId" value="${existingPost.id}">` : ''}
          </div>
          <div id="mktComposeStatus" class="marketing-compose-status"></div>
        </div>
      </div>
    `;
  },

  updateCharCount() {
    const ta = document.getElementById('mktComposeMsg');
    const ct = document.getElementById('mktCharCount');
    if (ta && ct) ct.textContent = `${ta.value.length} / 63,206`;
  },

  toLocalDatetime(isoStr) {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  async submitPost(action) {
    const message = document.getElementById('mktComposeMsg')?.value?.trim();
    const link = document.getElementById('mktComposeLink')?.value?.trim();
    const scheduleInput = document.getElementById('mktComposeSchedule')?.value;
    const editId = document.getElementById('mktEditId')?.value;
    const statusEl = document.getElementById('mktComposeStatus');

    if (!message) {
      if (statusEl) { statusEl.textContent = 'Message cannot be empty'; statusEl.style.color = 'var(--brick-light)'; }
      return;
    }

    if (action === 'schedule' && !scheduleInput) {
      if (statusEl) { statusEl.textContent = 'Pick a date/time to schedule'; statusEl.style.color = 'var(--brick-light)'; }
      return;
    }

    const body = { message, link: link || '', status: action };
    if (action === 'schedule' && scheduleInput) {
      body.scheduledFor = new Date(scheduleInput).toISOString();
    }

    // Disable buttons
    document.querySelectorAll('.marketing-compose-actions .btn').forEach(b => b.disabled = true);
    if (statusEl) { statusEl.textContent = 'Sending...'; statusEl.style.color = 'var(--text-dim)'; }

    try {
      if (editId) {
        await App.api('marketing/posts/' + editId, { method: 'PUT', body });
        if (action === 'publish') {
          await App.api('marketing/posts/' + editId + '/publish', { method: 'POST' });
        }
      } else {
        await App.api('marketing/posts', { method: 'POST', body });
      }

      if (statusEl) {
        statusEl.style.color = 'var(--green)';
        if (action === 'publish') statusEl.textContent = 'Published!';
        else if (action === 'schedule') statusEl.textContent = 'Scheduled!';
        else statusEl.textContent = 'Draft saved!';
      }

      setTimeout(() => {
        this.editingPost = null;
        this.setSection('feed');
        this.loadAll();
      }, 1000);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--brick-light)'; }
      document.querySelectorAll('.marketing-compose-actions .btn').forEach(b => b.disabled = false);
    }
  },

  editPost(id) {
    this.editingPost = id;
    this.activeSection = 'compose';
    document.querySelectorAll('#mktSections .source-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === 'compose');
    });
    this.renderSection();
  },

  async publishPost(id) {
    if (!confirm('Publish this post to Facebook now?')) return;
    try {
      await App.api('marketing/posts/' + id + '/publish', { method: 'POST' });
      this.loadAll();
    } catch (err) {
      alert('Publish failed: ' + (err.message || 'unknown error'));
    }
  },

  async deletePost(id) {
    if (!confirm('Delete this post? If published, it will also be removed from Facebook.')) return;
    try {
      await App.api('marketing/posts/' + id, { method: 'DELETE' });
      this.loadAll();
    } catch (err) {
      alert('Delete failed: ' + (err.message || 'unknown error'));
    }
  },

  async refreshInsights(id) {
    try {
      await App.api('marketing/posts/' + id + '/insights');
      this.loadAll();
    } catch (err) {
      alert('Could not refresh: ' + (err.message || 'unknown error'));
    }
  },

  async syncFromFb() {
    const btn = document.querySelector('.comms-toolbar-right .btn');
    if (btn) { btn.textContent = 'Syncing...'; btn.disabled = true; }
    try {
      const result = await App.api('marketing/sync', { method: 'POST' });
      if (btn) btn.textContent = `Synced (${result.added} new)`;
      this.loadAll();
    } catch (err) {
      if (btn) btn.textContent = 'Sync failed';
      alert('Sync error: ' + (err.message || 'unknown'));
    } finally {
      setTimeout(() => {
        if (btn) { btn.textContent = 'Sync from Facebook'; btn.disabled = false; }
      }, 3000);
    }
  },

  // ── Insights Section ─────────────────────────────────────
  renderInsights(el) {
    const published = this.posts.filter(p => p.status === 'published');

    if (published.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>No published posts to analyze</p></div>`;
      return;
    }

    const sorted = [...published].sort((a, b) =>
      new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt)
    );

    el.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2>Post Performance</h2>
          <button class="btn btn-sm btn-ghost" onclick="MarketingView.syncFromFb()">Sync from Facebook</button>
        </div>
        <div class="panel-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Published</th>
                <th>Reach</th>
                <th>Impressions</th>
                <th>Likes</th>
                <th>Comments</th>
                <th>Shares</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(p => {
                const eng = p.engagement || {};
                const preview = (p.message || '').slice(0, 50) + (p.message?.length > 50 ? '...' : '');
                return `
                  <tr>
                    <td>${App.esc(preview)}</td>
                    <td>${App.timeAgo(p.publishedAt)}</td>
                    <td>${this.formatNum(eng.reach || 0)}</td>
                    <td>${this.formatNum(eng.impressions || 0)}</td>
                    <td>${eng.likes || 0}</td>
                    <td>${eng.comments || 0}</td>
                    <td>${eng.shares || 0}</td>
                    <td>${p.fbPostId ? `<button class="btn btn-xs btn-ghost" onclick="MarketingView.refreshInsights('${p.id}')">Refresh</button>` : ''}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // ── Helpers ──────────────────────────────────────────────
  formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  },

  onWsMessage(type, data) {
    if (type.startsWith('marketing:')) {
      this.loadAll();
    }
  },

  onStats(stats) {
    // No stats-driven updates needed
  }
};
