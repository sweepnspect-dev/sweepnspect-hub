// ══════════════════════════════════════════════════════════
// STT — Voice Input Engine
// Uses Web Speech API (SpeechRecognition) for browser-native
// speech-to-text. Streams interim results, auto-sends on silence.
// ══════════════════════════════════════════════════════════

const HubSTT = {
  supported: false,
  listening: false,
  recognition: null,
  onResult: null,     // callback(text, isFinal)
  onStateChange: null, // callback(listening)
  autoSend: true,
  lang: 'en-US',

  init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[STT] Speech recognition not supported');
      return;
    }
    this.supported = true;

    const saved = localStorage.getItem('hub-stt-autosend');
    if (saved !== null) this.autoSend = saved === 'true';
  },

  _createRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.maxAlternatives = 1;

    let silenceTimer = null;
    let lastText = '';
    let delivered = false;

    rec.onresult = (e) => {
      // Rebuild full transcript from all results every time
      let final = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }

      lastText = (final + interim).trim();

      // Show in real-time
      if (this.onResult) {
        this.onResult(lastText, false);
      }

      // Auto-send after 2s of silence — use whatever text we have
      if (silenceTimer) clearTimeout(silenceTimer);
      if (lastText) {
        silenceTimer = setTimeout(() => {
          if (this.listening && lastText && !delivered) {
            delivered = true;
            if (this.onResult) this.onResult(lastText, true);
          }
        }, 2000);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[STT] Error:', e.error);
      this.stop();
    };

    rec.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      // Deliver remaining text if not already sent
      if (lastText && !delivered && this.onResult) {
        delivered = true;
        this.onResult(lastText, true);
      }
      this.listening = false;
      this.recognition = null;
      if (this.onStateChange) this.onStateChange(false);
    };

    return rec;
  },

  start(opts = {}) {
    if (!this.supported) return;
    if (this.listening) { this.stop(); return; }

    if (opts.onResult) this.onResult = opts.onResult;
    if (opts.onStateChange) this.onStateChange = opts.onStateChange;

    this.recognition = this._createRecognition();
    this.listening = true;
    if (this.onStateChange) this.onStateChange(true);

    try {
      this.recognition.start();
    } catch (e) {
      console.warn('[STT] Start error:', e);
      this.listening = false;
      if (this.onStateChange) this.onStateChange(false);
    }
  },

  stop() {
    if (this.recognition) {
      // recognition.stop() triggers onend which delivers remaining text
      try { this.recognition.stop(); } catch {}
      // Don't null out here — let onend handle cleanup and delivery
    } else {
      this.listening = false;
      if (this.onStateChange) this.onStateChange(false);
    }
  },

  toggle(opts = {}) {
    if (this.listening) {
      this.stop();
    } else {
      this.start(opts);
    }
  }
};

window.HubSTT = HubSTT;
