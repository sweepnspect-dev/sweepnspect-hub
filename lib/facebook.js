const https = require('https');

class FacebookService {
  constructor() {
    this.pageToken = process.env.FB_PAGE_TOKEN || '';
    this.pageId = process.env.FB_PAGE_ID || '';
    this.requestCount = 0;
    this.lastError = null;
  }

  get configured() {
    return !!(this.pageToken && this.pageId);
  }

  // ── Core HTTPS helper ──────────────────────────────────────────────
  _request(method, path, body) {
    return new Promise((resolve) => {
      const url = new URL(`https://graph.facebook.com/v21.0${path}`);
      if (method === 'GET' || method === 'DELETE') {
        url.searchParams.set('access_token', this.pageToken);
      }

      const postBody = body
        ? new URLSearchParams({ ...body, access_token: this.pageToken }).toString()
        : null;

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        headers: {}
      };

      if (postBody) {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.headers['Content-Length'] = Buffer.byteLength(postBody);
      }

      this.requestCount++;

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this.lastError = null;
              resolve({ ok: true, data: json });
            } else {
              const errMsg = json.error ? json.error.message : `HTTP ${res.statusCode}`;
              this.lastError = errMsg;
              resolve({ ok: false, error: errMsg, status: res.statusCode });
            }
          } catch {
            this.lastError = `Parse error (HTTP ${res.statusCode})`;
            resolve({ ok: false, error: this.lastError, raw: data });
          }
        });
      });

      req.on('error', (err) => {
        this.lastError = err.message;
        resolve({ ok: false, error: err.message });
      });
      req.setTimeout(15000, () => {
        req.destroy();
        this.lastError = 'Request timeout';
        resolve({ ok: false, error: 'timeout' });
      });

      if (postBody) req.write(postBody);
      req.end();
    });
  }

  // ── Page Info ──────────────────────────────────────────────────────
  async getPageInfo() {
    if (!this.configured) return { ok: false, error: 'Not configured' };
    return this._request('GET', `/${this.pageId}?fields=name,followers_count,fan_count,category,picture`);
  }

  // ── Page Posts ─────────────────────────────────────────────────────
  async getPagePosts(limit = 25) {
    if (!this.configured) return { ok: false, error: 'Not configured' };
    const fields = 'id,message,created_time,full_picture,permalink_url,likes.summary(true),comments.summary(true),shares';
    return this._request('GET', `/${this.pageId}/feed?fields=${fields}&limit=${limit}`);
  }

  // ── Post Insights ──────────────────────────────────────────────────
  async getPostInsights(postId) {
    if (!this.configured) return { ok: false, error: 'Not configured' };
    return this._request('GET', `/${postId}?fields=insights.metric(post_impressions,post_reach,post_engaged_users)`);
  }

  // ── Create Post ────────────────────────────────────────────────────
  async createPost(message, link) {
    if (!this.configured) return { ok: false, error: 'Not configured' };
    const body = { message };
    if (link) body.link = link;
    return this._request('POST', `/${this.pageId}/feed`, body);
  }

  // ── Schedule Post ──────────────────────────────────────────────────
  async schedulePost(message, scheduledTime, link) {
    if (!this.configured) return { ok: false, error: 'Not configured' };
    const unixTime = Math.floor(new Date(scheduledTime).getTime() / 1000);
    const body = {
      message,
      published: 'false',
      scheduled_publish_time: String(unixTime)
    };
    if (link) body.link = link;
    return this._request('POST', `/${this.pageId}/feed`, body);
  }

  // ── Delete Post ────────────────────────────────────────────────────
  async deletePost(postId) {
    if (!this.configured) return { ok: false, error: 'Not configured' };
    return this._request('DELETE', `/${postId}`);
  }

  // ── Status (for system services) ───────────────────────────────────
  getStatus() {
    return {
      configured: this.configured,
      pageId: this.pageId || null,
      requestCount: this.requestCount,
      lastError: this.lastError
    };
  }
}

module.exports = FacebookService;
