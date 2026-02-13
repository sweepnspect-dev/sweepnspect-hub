// WebSocket wrapper with auto-reconnect and message queue
class HubSocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.queue = [];
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connected = false;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.emit('_connected');
      // Flush queue
      while (this.queue.length) {
        this.ws.send(JSON.stringify(this.queue.shift()));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit(msg.type, msg.data, msg);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.emit('_disconnected');
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };

    this.ws.onerror = () => {}; // onclose will handle reconnect
  }

  send(type, data) {
    const msg = { type, data };
    if (this.connected && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
    return () => { this.listeners[type] = this.listeners[type].filter(f => f !== fn); };
  }

  emit(type, ...args) {
    (this.listeners[type] || []).forEach(fn => fn(...args));
    (this.listeners['*'] || []).forEach(fn => fn(type, ...args));
  }
}

window.hubSocket = new HubSocket();
