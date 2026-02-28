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
  },

  // Alert toast — severity-colored with stacking
  alertToast(alert) {
    let container = document.getElementById('alertToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'alertToastContainer';
      container.className = 'alert-toast-container';
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = `alert-toast ${alert.severity || 'medium'}`;
    el.textContent = alert.message;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 5000);
  },

  // Play notification sound via Web Audio API
  playSound(type = 'alert') {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (type === 'chat') {
        // Friendly double-beep
        [0, 0.15].forEach(offset => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.12);
          osc.start(ctx.currentTime + offset);
          osc.stop(ctx.currentTime + offset + 0.12);
        });
      } else {
        // Single attention tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 660;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      }
      setTimeout(() => ctx.close(), 1000);
    } catch (e) {
      console.warn('[Notify] Sound failed:', e.message);
    }
  },

  // Chat-specific notification: sound + desktop + toast
  chatNotify(session) {
    const name = session?.visitor?.name || 'Visitor';
    this.playSound('chat');
    this.toast(`New chat from ${name}`, 'info');
    this.send('New Live Chat', `${name} started a chat`, '/assets/icon.png');
  },

  // Desktop notification for critical alerts
  alertDesktop(alert) {
    if (!this.enabled) return;
    if (!['critical', 'high'].includes(alert.severity)) return;
    const n = new Notification(`SweepNspect Alert [${alert.severity.toUpperCase()}]`, {
      body: alert.message,
      icon: '/assets/icon.png',
      badge: '/assets/icon.png',
      tag: alert.id
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 10000);
  }
};

window.HubNotify = HubNotify;
