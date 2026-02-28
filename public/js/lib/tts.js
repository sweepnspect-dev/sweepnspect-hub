// ══════════════════════════════════════════════════════════
// TTS — Voice Notification Engine
// Uses Web Speech API (speechSynthesis) for zero-dependency
// browser-native text-to-speech. Queue-based, interruptible.
// ══════════════════════════════════════════════════════════

const HubTTS = {
  enabled: true,
  supported: false,
  voice: null,
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  queue: [],
  speaking: false,
  maxQueueLen: 5,

  init() {
    this.supported = 'speechSynthesis' in window;
    if (!this.supported) {
      console.warn('[TTS] Speech synthesis not supported in this browser');
      return;
    }
    console.log('[TTS] speechSynthesis available');

    // Restore user preference
    const saved = localStorage.getItem('hub-tts-enabled');
    if (saved !== null) this.enabled = saved === 'true';

    const savedVoice = localStorage.getItem('hub-tts-voice');

    // Voices load asynchronously in some browsers
    const pickVoice = () => {
      const voices = speechSynthesis.getVoices();
      console.log(`[TTS] Voices loaded: ${voices.length}`);
      if (!voices.length) return;

      // Restore saved voice
      if (savedVoice) {
        const found = voices.find(v => v.name === savedVoice);
        if (found) { this.voice = found; console.log(`[TTS] Restored voice: ${found.name}`); return; }
      }

      // Prefer natural-sounding English voices
      const prefs = [
        v => v.name.includes('Microsoft Zira'),
        v => v.name.includes('Microsoft David'),
        v => v.name.includes('Google US English'),
        v => v.name.includes('Google UK English Female'),
        v => v.lang.startsWith('en') && v.localService,
        v => v.lang.startsWith('en'),
      ];

      for (const test of prefs) {
        const match = voices.find(test);
        if (match) { this.voice = match; console.log(`[TTS] Selected voice: ${match.name} (${match.lang})`); return; }
      }

      this.voice = voices[0];
      console.log(`[TTS] Fallback voice: ${voices[0].name}`);
    };

    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('hub-tts-enabled', this.enabled);
    this.updateToggleUI();

    if (!this.enabled) {
      this.stop();
      HubNotify.toast('Voice notifications off', 'info');
    } else {
      // Direct utterance on user click — unlocks Chrome audio policy
      speechSynthesis.cancel();
      const voices = speechSynthesis.getVoices();
      if (!this.voice && voices.length) {
        this.voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
      }
      const u = new SpeechSynthesisUtterance('Voice notifications enabled');
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate;
      u.volume = this.volume;
      speechSynthesis.speak(u);
    }
  },

  updateToggleUI() {
    const btn = document.getElementById('ttsToggle');
    if (!btn) return;
    btn.classList.toggle('tts-muted', !this.enabled);
    btn.title = this.enabled ? 'Voice on (click to mute)' : 'Voice off (click to unmute)';
    const iconOn = document.getElementById('ttsIconOn');
    const iconOff = document.getElementById('ttsIconOff');
    if (iconOn) iconOn.style.display = this.enabled ? '' : 'none';
    if (iconOff) iconOff.style.display = this.enabled ? 'none' : '';
  },

  // ── Core speak ──
  speak(text, opts = {}) {
    if (!this.supported || !this.enabled) return;
    if (!text || !text.trim()) return;

    // Priority messages can interrupt the queue
    if (opts.priority === 'critical') {
      this.stop();
      this.queue = [];
    }

    const maxLen = opts.maxLen || 600;
    // If raw flag set, text is already conversational — don't process
    let cleanText = opts.raw ? text.trim() : this.toSpeech(text);

    if (cleanText.length > maxLen) {
      // Cut at sentence boundary
      const cut = cleanText.lastIndexOf('.', maxLen);
      cleanText = cleanText.slice(0, cut > maxLen * 0.5 ? cut + 1 : maxLen);
    }

    if (this.queue.length >= this.maxQueueLen) {
      this.queue.shift(); // drop oldest
    }

    this.queue.push({ text: cleanText, opts });
    this._processQueue();
  },

  _processQueue() {
    if (this.speaking || this.queue.length === 0) return;

    const { text, opts } = this.queue.shift();
    this.speaking = true;

    console.log(`[TTS] Speaking: "${text.slice(0, 60)}..." voice=${this.voice?.name || 'NONE'} paused=${speechSynthesis.paused} speaking=${speechSynthesis.speaking}`);

    // Chrome bug workaround: cancel any stale state before speaking
    speechSynthesis.cancel();

    // Wait a tick after cancel for Chrome to reset
    setTimeout(() => {
      // Ensure voices are loaded
      if (!this.voice) {
        const voices = speechSynthesis.getVoices();
        console.log(`[TTS] Late voice load: ${voices.length} voices`);
        if (voices.length) this.voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (this.voice) utterance.voice = this.voice;
      utterance.rate = opts.rate || this.rate;
      utterance.pitch = opts.pitch || this.pitch;
      utterance.volume = opts.volume || this.volume;

      utterance.onstart = () => {
        console.log('[TTS] Utterance started');
      };
      utterance.onend = () => {
        console.log('[TTS] Utterance ended');
        this.speaking = false;
        this._processQueue();
      };
      utterance.onerror = (e) => {
        console.warn('[TTS] Utterance error:', e.error);
        this.speaking = false;
        this._processQueue();
      };

      speechSynthesis.speak(utterance);
      console.log(`[TTS] speak() called. pending=${speechSynthesis.pending} speaking=${speechSynthesis.speaking}`);
    }, 50);
  },

  stop() {
    speechSynthesis.cancel();
    this.speaking = false;
  },

  // ── Event-driven speech ──
  // Called from App WebSocket handler for auto-announcing events
  onEvent(type, data) {
    if (!this.enabled) return;

    switch (type) {
      case 'alert':
        if (data.severity === 'critical') {
          this.speak(`Critical alert: ${data.message}`, { priority: 'critical' });
        } else if (data.severity === 'high') {
          this.speak(`Alert: ${data.message}`);
        }
        break;

      case 'tts:speak':
        // Explicit TTS request from backend
        this.speak(data.text || data.message, {
          priority: data.priority,
          rate: data.rate,
        });
        break;

      case 'ticket:new':
        if (['critical', 'high'].includes(data.priority)) {
          this.speak(`New ${data.priority} ticket: ${data.subject}`);
        }
        break;

      case 'livechat:start':
        this.speak(`New chat from ${data.visitor?.name || 'visitor'}`);
        break;

      case 'livechat:message': {
        // Only speak if not currently viewing this chat
        const viewing = typeof CommsView !== 'undefined' &&
          CommsView.openId === 'livechat-' + data.sessionId;
        if (!viewing) {
          this.speak(`New message from ${data.visitor?.name || data.message?.from || 'visitor'}`);
        }
        break;
      }

      case 'clauser:activity':
        if (data.text && data.text.includes('Churn risk')) {
          this.speak(data.text);
        }
        break;

      case 'subscriber:churned':
        this.speak(`Subscriber churned: ${data.name || 'unknown'}`, { priority: 'critical' });
        break;
    }
  },

  // ── Markdown → Conversational Speech ──
  // Transforms structured markdown into natural spoken text
  toSpeech(md) {
    if (!md) return '';
    let s = md;

    // Remove code blocks entirely — don't read code aloud
    s = s.replace(/```[\s\S]*?```/g, ' (code omitted) ');

    // Inline code → just the word
    s = s.replace(/`([^`]+)`/g, '$1');

    // Links → just the label
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Images
    s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Strip URLs
    s = s.replace(/https?:\/\/\S+/g, '');

    // Headers → spoken as topic intro with pause
    s = s.replace(/^#{1,6}\s+(.+)$/gm, '. $1: ');

    // Horizontal rules → pause
    s = s.replace(/^---+$/gm, '. ');

    // Bold labels like **Root Cause**: → spoken naturally
    s = s.replace(/\*\*([^*]+)\*\*:\s*/g, '$1: ');

    // Remaining bold/italic → just the text
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    s = s.replace(/\*\*(.+?)\*\*/g, '$1');
    s = s.replace(/\*(.+?)\*/g, '$1');
    s = s.replace(/_(.+?)_/g, '$1');
    s = s.replace(/~~(.+?)~~/g, '$1');

    // Numbered lists → natural flow
    s = s.replace(/^\d+\.\s+/gm, '. ');

    // Bullet points → natural flow with pause
    s = s.replace(/^[\-\*\+]\s+/gm, '. ');

    // Blockquotes
    s = s.replace(/^>\s*/gm, '');

    // Table rows — skip them
    s = s.replace(/\|[^\n]+\|/g, '');
    s = s.replace(/^[\-\s|:]+$/gm, '');

    // HTML tags
    s = s.replace(/<[^>]+>/g, '');

    // Multiple newlines → single pause
    s = s.replace(/\n{2,}/g, '. ');

    // Single newlines → space
    s = s.replace(/\n/g, ' ');

    // Clean up punctuation
    s = s.replace(/\.\s*\./g, '.');        // double periods
    s = s.replace(/:\s*\./g, ': ');        // colon then period
    s = s.replace(/\.\s*:/g, ': ');        // period then colon
    s = s.replace(/\s{2,}/g, ' ');         // collapse spaces
    s = s.replace(/^\.\s*/, '');           // leading period

    return s.trim();
  },

  // ── Get available voices for settings UI ──
  getVoices() {
    if (!this.supported) return [];
    return speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  },

  setVoice(name) {
    const voices = speechSynthesis.getVoices();
    const found = voices.find(v => v.name === name);
    if (found) {
      this.voice = found;
      localStorage.setItem('hub-tts-voice', name);
    }
  },

  // ── Run from browser console: HubTTS.test() ──
  test() {
    console.log('[TTS] === DIAGNOSTIC TEST ===');
    console.log('[TTS] supported:', this.supported);
    console.log('[TTS] enabled:', this.enabled);
    console.log('[TTS] voice:', this.voice?.name || 'NONE');
    console.log('[TTS] voices available:', speechSynthesis.getVoices().length);
    console.log('[TTS] speechSynthesis.paused:', speechSynthesis.paused);
    console.log('[TTS] speechSynthesis.speaking:', speechSynthesis.speaking);

    // Try the most basic possible utterance — no voice, no options
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('Testing. One two three.');
    u.onstart = () => console.log('[TTS] TEST onstart fired');
    u.onend = () => console.log('[TTS] TEST onend fired — SUCCESS');
    u.onerror = (e) => console.error('[TTS] TEST onerror:', e.error);
    speechSynthesis.speak(u);
    console.log('[TTS] speak() called. Check if you hear audio.');
    console.log('[TTS] If silent, try: speechSynthesis.resume() in console');
  },

  // ── Full diagnostic dump ──
  diag() {
    const voices = speechSynthesis.getVoices();
    const enVoices = voices.filter(v => v.lang.startsWith('en'));
    return {
      supported: this.supported,
      enabled: this.enabled,
      speaking: speechSynthesis.speaking,
      paused: speechSynthesis.paused,
      pending: speechSynthesis.pending,
      voiceCount: voices.length,
      enVoiceCount: enVoices.length,
      selectedVoice: this.voice?.name || null,
      enVoices: enVoices.map(v => `${v.name} (${v.lang}${v.localService ? ' local' : ' remote'})`),
      queueLen: this.queue.length,
      isSpeaking: this.speaking
    };
  }
};

window.HubTTS = HubTTS;
