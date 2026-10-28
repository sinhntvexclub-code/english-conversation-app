// Voice engines for the full web version.
//
// Why this file exists: the static build could not load neural voices because
// its runtime bans ES module scripts. This Vite package USES ES modules, so it
// can load the real free neural voices client-side, with no API key and no
// server:
//   - Piper (via @mintplex-labs/piper-tts-web): main voice for English
//     (en_US-lessac-medium) and fallback for Vietnamese
//     (vi_VN-vais1000-medium). Models download once (~60MB each) into the
//     browser's Origin Private File System and are cached afterwards.
//   - Microsoft Edge read-aloud (via @edge-tts/universal, browser entry):
//     FIRST voice for Vietnamese lines only (vi-VN-HoaiMyNeural) — Piper's
//     Vietnamese voice sounds garbled on real devices, so Vietnamese no
//     longer defaults to it. Needs network; unofficial endpoint, can break.
//   - Kokoro-82M (via kokoro-js): higher-quality English option on desktop
//     (WebGPU + fp32 when available, otherwise WASM + q8). Kokoro has no
//     Vietnamese voices.
//   - System voices (speechSynthesis): always-available fallback, ranked by
//     quality (Google / Microsoft Natural / Samantha / HoaiMy …).
//
// Nothing here ever pretends a neural voice is playing when it is not: every
// failure falls back visibly and updates the status line with the reason.

const PIPER_EN = 'en_US-lessac-medium';
const PIPER_VI = 'vi_VN-vais1000-medium';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// Microsoft Edge read-aloud voice for Vietnamese. Piper's Vietnamese voice
// (vais1000, via espeak-ng phonemes) sounds muffled/garbled on real devices,
// and many devices have no Vietnamese system voice at all — in both cases the
// user hears nonsense. HoaiMy is a natural neural Vietnamese voice, free with
// no key. Trade-off, stated honestly in the UI: Vietnamese lines go through
// Microsoft's read-aloud service over the network (unofficial endpoint, can
// break or rate-limit), while English lines stay fully on-device. Edge is
// tried first for Vietnamese only; Piper VI and the system voice remain as
// fallbacks, never silently replaced by an English voice.
const EDGE_VI_VOICE = 'vi-VN-HoaiMyNeural';

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
let edgeFailed = null;
let lastViVoice = null; // 'edge' | 'piper' | 'system' — what actually spoke Vietnamese last

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

function viVoiceLabel() {
  if (lastViVoice === 'edge') return 'Microsoft HoaiMy (qua mạng)';
  if (lastViVoice === 'piper') return 'Piper tiếng Việt (dự phòng)';
  if (lastViVoice === 'system') return 'giọng hệ thống của máy (dự phòng)';
  return 'Microsoft HoaiMy (qua mạng)';
}

function reportStatus() {
  if (engine === 'system') {
    statusCb('Giọng đang dùng: giọng hệ thống của máy bạn (cả tiếng Anh và tiếng Việt).');
    return;
  }
  const enLabel = engine === 'kokoro'
    ? 'Kokoro-82M tiếng Anh (chất lượng cao, máy tính có WebGPU)'
    : piperFailed
      ? 'giọng hệ thống tiếng Anh (Piper chưa tải được)'
      : 'Piper tiếng Anh (Lessac)';
  const viNote = edgeFailed
    ? ` Câu tiếng Việt đang dùng ${viVoiceLabel()} vì giọng Microsoft chưa tải được (${edgeFailed}).`
    : ` Câu tiếng Việt dùng ${viVoiceLabel()}.`;
  statusCb(`Giọng đang dùng: ${enLabel}.${viNote}`);
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

// ---- Edge-TTS (Microsoft read-aloud, Vietnamese only) ----
async function edgeSpeak(text) {
  // Direct module import (see the vite.config alias): the package's
  // "./browser" barrel is broken at build time, the class module is not.
  const edgeMod = await import('edge-tts-browser-simple');
  const tts = new edgeMod.BrowserEdgeTTS(text, EDGE_VI_VOICE);
  const result = await tts.synthesize();
  if (!result || !result.audio || result.audio.size === 0) {
    throw new Error('không nhận được audio từ Microsoft');
  }
  return result.audio;
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
  if (lang === 'vi' && engine !== 'system') {
    // Vietnamese first: Microsoft HoaiMy (natural neural voice). If the
    // unofficial endpoint is blocked or fails, fall through to Piper VI and
    // then to the system voice — and say so in the status line.
    try {
      const blob = await edgeSpeak(text);
      lastViVoice = 'edge';
      edgeFailed = null;
      reportStatus();
      await playBlob(blob, hooks);
      return 'edge';
    } catch (e) {
      console.warn('Edge-TTS Vietnamese failed, falling back to Piper VI:', e);
      edgeFailed = e?.message || 'lỗi mạng';
      reportStatus();
    }
  }
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
      if (lang === 'vi') lastViVoice = 'piper';
      reportStatus();
      await playBlob(blob, hooks);
      return 'piper';
    } catch (e) {
      console.warn('Piper failed, falling back to system voice:', e);
      reportStatus();
    }
  }
  if (lang === 'vi') lastViVoice = 'system';
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
