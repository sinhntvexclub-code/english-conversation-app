// Voice engines for the full web version.
//
// Why this file exists: the static build could not load neural voices because
// its runtime bans ES module scripts. This Vite package USES ES modules, so it
// can load the real free neural voices client-side, with no API key and no
// server:
//   - Piper (via @mintplex-labs/piper-tts-web): main voice for BOTH English
//     (en_US-lessac-medium) and Vietnamese (vi_VN-vais1000-medium, the best
//     Piper Vietnamese voice). Models download once (~60MB each) into the
//     browser's Origin Private File System and are cached afterwards.
//   - Kokoro-82M (via kokoro-js): higher-quality English option on desktop
//     (WebGPU + fp32 when available, otherwise WASM + q8). Kokoro has no
//     Vietnamese voices, so Vietnamese lines fall back to Piper VI.
//   - System voices (speechSynthesis): always-available fallback, ranked by
//     quality (Google / Microsoft Natural / Samantha / HoaiMy …).
//
// Nothing here ever pretends a neural voice is playing when it is not: every
// failure falls back visibly and updates the status line with the reason.

const PIPER_EN = 'en_US-lessac-medium';
const PIPER_VI = 'vi_VN-vais1000-medium';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let engine = 'piper'; // 'piper' | 'kokoro' | 'system'
let piperMod = null;
let kokoroTTS = null;
let kokoroLoading = null;
let statusCb = () => {};
let progressCb = () => {};
let audioCtx = null;
let analyser = null;
let currentAudio = null;
let currentUtterance = null;
let speaking = false;
let piperReady = { en: false, vi: false };
let piperFailed = null;

export function setStatusCallback(fn) { statusCb = fn; }
export function refreshStatus() { reportStatus(); }
export function setProgressCallback(fn) { progressCb = fn; }
export function setEngine(name) {
  engine = name;
  stop();
  reportStatus();
}
export function getEngine() { return engine; }
export function isSpeaking() { return speaking; }

function reportStatus() {
  if (engine === 'piper') {
    if (piperFailed) {
      statusCb(`Giọng Piper chưa tải được (${piperFailed}) — đang dùng giọng hệ thống dự phòng.`);
    } else if (piperReady.en && piperReady.vi) {
      statusCb('Giọng đang dùng: Piper tiếng Anh (Lessac) · Piper tiếng Việt (vais1000). Chạy trên máy bạn, không cần mạng sau lần tải đầu.');
    } else if (piperReady.en || piperReady.vi) {
      statusCb('Giọng đang dùng: Piper (một phần đã tải) · phần còn lại dùng giọng hệ thống dự phòng.');
    } else {
      statusCb('Giọng đang dùng: Piper — sẽ tải model khi bạn bắt đầu (khoảng 60MB mỗi giọng, chỉ tải một lần).');
    }
  } else if (engine === 'kokoro') {
    statusCb('Giọng đang dùng: Kokoro-82M tiếng Anh (chất lượng cao, máy tính có WebGPU) · câu tiếng Việt dùng Piper tiếng Việt.');
  } else {
    statusCb('Giọng đang dùng: giọng hệ thống của máy bạn (dự phòng).');
  }
}

function showProgress(show, text, pct) {
  progressCb({ show, text, pct });
}

function ensureAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Level 0..1 for the avatar mouth, sampled from the playing audio element.
// Returns -1 when no analyser exists (system voices), so the avatar falls
// back to a speech-like mouth oscillation instead of staying shut.
export function getAudioLevel() {
  if (!analyser) return -1;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return Math.min(1, (sum / data.length) / 90);
}

export function stop() {
  speaking = false;
  if (currentAudio) {
    try { currentAudio.pause(); } catch (_) {}
    if (currentAudio.src && currentAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = null;
  }
  if (currentUtterance && 'speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
    currentUtterance = null;
  }
}

async function playBlob(blob, { onStart, onEnd } = {}) {
  ensureAudioCtx();
  stop();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  let wired = false;
  if (audioCtx && analyser) {
    try {
      const src = audioCtx.createMediaElementSource(audio);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      wired = true;
    } catch (_) { /* element already wired: play plain */ }
  }
  // If wiring failed, the <audio> element still plays to the speakers directly.
  speaking = true;
  onStart?.();
  audio.onended = () => {
    speaking = false;
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    onEnd?.();
  };
  audio.onerror = () => {
    speaking = false;
    if (currentAudio === audio) currentAudio = null;
    onEnd?.();
  };
  await audio.play();
}

// ---- Piper ----
async function loadPiper() {
  if (!piperMod) piperMod = await import('@mintplex-labs/piper-tts-web');
  return piperMod;
}

async function piperSpeak(text, voiceId, progressLabel) {
  const tts = await loadPiper();
  const key = voiceId === PIPER_VI ? 'vi' : 'en';
  if (!piperReady[key]) {
    showProgress(true, `${progressLabel} (đang tải model giọng, chỉ một lần)…`, 0);
    try {
      await tts.download(voiceId, (p) => {
        const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
        showProgress(true, `${progressLabel} — đang tải ${pct}%…`, pct);
      });
      piperReady[key] = true;
    } catch (e) {
      piperFailed = e?.message || 'lỗi tải model';
      showProgress(false, '', 0);
      reportStatus();
      throw e;
    }
    showProgress(false, '', 0);
    reportStatus();
  }
  const blob = await tts.predict({ text, voiceId });
  return blob;
}

// ---- Kokoro ----
function encodeWav(float32, sampleRate) {
  const len = float32.length;
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const write = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  write(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  write(36, 'data'); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function loadKokoro() {
  if (kokoroTTS) return kokoroTTS;
  if (!kokoroLoading) {
    kokoroLoading = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const useWebGPU = !!navigator.gpu;
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: useWebGPU ? 'fp32' : 'q8',
        device: useWebGPU ? 'webgpu' : 'wasm',
        progress_callback: (p) => {
          if (p && typeof p.progress === 'number') {
            showProgress(true, `Đang tải model Kokoro (${Math.round(p.progress)}%)…`, Math.round(p.progress));
          } else if (p && p.status) {
            showProgress(true, `Đang tải model Kokoro… ${p.file || ''}`, 0);
          }
        },
      });
      showProgress(false, '', 0);
      kokoroTTS = tts;
      return tts;
    })();
  }
  return kokoroLoading;
}

async function kokoroSpeak(text) {
  const tts = await loadKokoro();
  const out = await tts.generate(text, { voice: 'af_heart' });
  const samples = out.audio || out.data || out;
  const rate = out.sampling_rate || out.sampleRate || 24000;
  return encodeWav(samples, rate);
}

// ---- System voices ----
function pickSystemVoice(lang) {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const rank = (v) => {
    const n = v.name.toLowerCase();
    if (lang === 'vi') {
      if (n.includes('google tiếng việt') || n.includes('vietnamese')) return 0;
      if (n.includes('hoaimy') || n.includes('namminh')) return 1;
      if (v.lang.toLowerCase().startsWith('vi')) return 2;
      return 9;
    }
    if (n.includes('google us english')) return 0;
    if (n.includes('natural') || n.includes('aria') || n.includes('natasha')) return 1;
    if (n.includes('samantha')) return 2;
    if (v.lang.toLowerCase() === 'en-us') return 3;
    if (v.lang.toLowerCase().startsWith('en')) return 4;
    return 9;
  };
  const sorted = voices.slice().sort((a, b) => rank(a) - rank(b));
  return sorted[0] || null;
}

function systemSpeak(text, lang, { onStart, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { onEnd?.(); resolve(); return; }
    stop();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickSystemVoice(lang);
    if (v) u.voice = v;
    u.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    u.rate = 0.98;
    currentUtterance = u;
    speaking = true;
    u.onstart = () => onStart?.();
    u.onend = () => { speaking = false; currentUtterance = null; onEnd?.(); resolve(); };
    u.onerror = () => { speaking = false; currentUtterance = null; onEnd?.(); resolve(); };
    window.speechSynthesis.speak(u);
  });
}

// ---- Public entry ----
export async function speak(text, lang, hooks = {}) {
  // lang: 'en' | 'vi'
  if (engine === 'kokoro' && lang === 'en') {
    try {
      const blob = await kokoroSpeak(text);
      await playBlob(blob, hooks);
      return 'kokoro';
    } catch (e) {
      console.warn('Kokoro failed, falling back to Piper:', e);
      // fall through to Piper
    }
  }
  if (engine === 'piper' || engine === 'kokoro') {
    try {
      const voiceId = lang === 'vi' ? PIPER_VI : PIPER_EN;
      const label = lang === 'vi' ? 'giọng Piper tiếng Việt' : 'giọng Piper tiếng Anh';
      const blob = await piperSpeak(text, voiceId, `Đang tải ${label}`);
      await playBlob(blob, hooks);
      return 'piper';
    } catch (e) {
      console.warn('Piper failed, falling back to system voice:', e);
      reportStatus();
    }
  }
  await systemSpeak(text, lang, hooks);
  return 'system';
}

// Pre-download Piper voices after the user's first interaction so later lines
// play instantly. Safe to call repeatedly; already-downloaded voices are skipped.
export async function preloadPiperVoices() {
  try {
    const tts = await loadPiper();
    for (const [voiceId, key, label] of [
      [PIPER_EN, 'en', 'giọng Piper tiếng Anh'],
      [PIPER_VI, 'vi', 'giọng Piper tiếng Việt'],
    ]) {
      if (piperReady[key]) continue;
      showProgress(true, `Đang tải ${label} (chỉ một lần)…`, 0);
      await tts.download(voiceId, (p) => {
        const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
        showProgress(true, `Đang tải ${label} — ${pct}%…`, pct);
      });
      piperReady[key] = true;
    }
    showProgress(false, '', 0);
    reportStatus();
  } catch (e) {
    piperFailed = e?.message || 'lỗi tải model';
    showProgress(false, '', 0);
    reportStatus();
  }
}

// Warm up system voices list (browsers load it asynchronously).
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
reportStatus();
