// Desktop notification helper
const HubNotify = {
  enabled: false,

  async init() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      this.enabled = true;
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      this.enabled = perm === 'granted';
    }
  },

  send(title, body, icon) {
    if (!this.enabled) return;
    const n = new Notification(title, {
      body,
      icon: icon || '/assets/icon.png',
      badge: '/assets/icon.png'
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 8000);
  },

  // In-app toast
  toast(text, type = 'info') {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; bottom: 48px; right: 16px; z-index: 200;
      padding: 10px 18px; border-radius: 6px; font-size: 13px;
      color: #fff; animation: fadeIn 0.2s;
      background: ${type === 'error' ? '#c0392b' : type === 'success' ? '#27ae60' : '#2a2a45'};
      border: 1px solid ${type === 'error' ? '#e74c3c' : type === 'success' ? '#2ecc71' : '#444'};
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
  }
};

window.HubNotify = HubNotify;
