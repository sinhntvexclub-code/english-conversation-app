// Web Speech API wrapper (English recognition). The browser vendors the
// recognizer; Chrome on desktop/Android works best. No audio leaves the page
// except to the browser's own recognition service.

export function recognitionSupported() {
  return !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );
}

// Single-shot listen. Resolves with { transcript } or { error }.
export function listenOnce({ lang = 'en-US', timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { resolve({ error: 'unsupported' }); return; }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { rec.stop(); } catch (_) {} resolve(r); } };
    const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
    rec.onresult = (e) => {
      clearTimeout(timer);
      const t = e.results?.[0]?.[0]?.transcript || '';
      finish(t ? { transcript: t } : { error: 'empty' });
    };
    rec.onerror = (e) => { clearTimeout(timer); finish({ error: e.error || 'error' }); };
    rec.onend = () => { clearTimeout(timer); finish({ error: 'ended' }); };
    try { rec.start(); } catch (_) { finish({ error: 'start' }); }
  });
}
