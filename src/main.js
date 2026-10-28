import { TOPICS, PERSONA_LINES } from './topics.js';
import {
  speak, stop, setEngine, getEngine, setStatusCallback, setProgressCallback,
  getAudioLevel, preloadPiperVoices, refreshStatus,
} from './voices.js';
import { checkAnswer, mistakeNotes, missingWords } from './scoring.js';
import { recognitionSupported, listenOnce } from './recognition.js';
import { initAvatar } from './avatar.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'emma-progress-v1';

// ---------- saved progress (localStorage, v1 — no backend) ----------
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { stars: 0, score: 0, best: {} }; }
  catch (_) { return { stars: 0, score: 0, best: {} }; }
}
let progress = loadProgress();
function saveProgress() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(progress)); } catch (_) {}
}
function renderTotals() {
  $('statStars').textContent = progress.stars;
  $('statScore').textContent = progress.score;
}

// ---------- avatar (one instance; its canvas moves between stages) ----------
let avatar = null;
try {
  avatar = initAvatar($('avatarWrap'));
} catch (e) {
  console.warn('WebGL unavailable, using CSS fallback face:', e);
  $('avatarWrap').hidden = true;
  $('fallbackAvatar').hidden = false;
}
function moveAvatarTo(el) {
  if (!avatar) return;
  const canvas = document.querySelector('#avatarWrap canvas, #avatarWrap2 canvas');
  if (canvas) el.appendChild(canvas);
}
function talk(on) {
  if (avatar) avatar.setTalking(on, getAudioLevel);
}
function setMoodExpression(topic, mood) {
  if (!avatar) return;
  const p = topic.char.personality;
  if (!topic.char.mood) {
    avatar.setExpression(p === 'grumpy' ? 'grumpy' : p === 'cheerful' || p === 'gentle' ? 'happy' : 'neutral');
    return;
  }
  avatar.setExpression(mood >= 3 ? 'soft' : 'grumpy');
}

// ---------- voice status / progress UI ----------
setStatusCallback((t) => { $('voiceStatus').textContent = t; });
refreshStatus();
setProgressCallback(({ show, text, pct }) => {
  $('voiceProgress').hidden = !show;
  $('voiceProgressText').textContent = text || '';
  $('voiceProgressFill').style.width = `${pct || 0}%`;
});
$('voiceEngine').addEventListener('change', (e) => setEngine(e.target.value));

// ---------- greeting on entry (autoplay needs a first gesture) ----------
const GREET_VI = 'Chào bạn! Mình là Emma đây! Hôm nay bạn muốn luyện chủ đề nào nào?';
let greeted = false;
let greetPending = false;
let greetStarted = false;
let greetAttempting = false;

async function attemptGreet() {
  if (greeted || greetAttempting) return;
  greetAttempting = true;
  greetPending = true;
  greetStarted = false;
  try {
    await speak(GREET_VI, 'vi', {
      onStart: () => {
        greetStarted = true;
        $('greetNote').hidden = true;
        $('btnHearGreet').hidden = true;
        talk(true);
      },
      onEnd: () => { talk(false); greeted = true; greetPending = false; },
    });
    greeted = true;
    greetPending = false;
  } catch (_) {
    // Autoplay blocked (or voice engine failed before starting): show the
    // visible fallback instead of staying silent.
    $('greetNote').hidden = false;
    $('btnHearGreet').hidden = false;
  } finally {
    greetAttempting = false;
  }
}
// If speech never audibly starts (silent autoplay block), surface the
// fallback — but not while a voice model is still downloading.
setTimeout(() => {
  if (greetPending && !greetStarted && $('voiceProgress').hidden) {
    $('greetNote').hidden = false;
    $('btnHearGreet').hidden = false;
  }
}, 2500);
$('btnHearGreet').addEventListener('click', async () => {
  $('greetNote').hidden = true;
  $('btnHearGreet').hidden = true;
  stop();
  await attemptGreet();
});
const unlock = () => {
  if (greetPending && !greeted) {
    stop();
    attemptGreet();
  }
};
window.addEventListener('pointerdown', unlock, { once: false });
window.addEventListener('keydown', unlock, { once: false });

// ---------- lobby ----------
$('greetLine').textContent = GREET_VI;
function renderTopics() {
  const grid = $('topicGrid');
  grid.innerHTML = '';
  for (const t of TOPICS) {
    const b = document.createElement('button');
    b.className = 'topic-card';
    const best = progress.best[t.id];
    b.innerHTML = `<b>${t.title}</b><small>${t.char.name} · ${t.char.role} — ${t.tag}</small>` +
      (best ? `<div class="best">Kỷ lục của bạn: ${'⭐'.repeat(best.stars)} · ${best.score}/50 điểm</div>` : '');
    b.addEventListener('click', () => startTopic(t));
    grid.appendChild(b);
  }
}
renderTopics();
renderTotals();

// ---------- session ----------
let topic = null;
let turnIndex = 0;
let attempts = 0;
let sessionScore = 0;
let mood = 0;
let review = [];
let turnDone = false;

function showScreen(name) {
  for (const id of ['lobby', 'session', 'result']) $(id).hidden = id !== name;
}
function moveAvatar(stage) {
  if (stage === 'session') moveAvatarTo($('avatarWrap2'));
  else moveAvatarTo($('avatarWrap'));
}

function moodLabel() {
  return ['Đang cáu', 'Bớt cáu rồi', 'Dịu dần', 'Rất mềm mỏng'][mood] || '';
}
function renderMood() {
  const wrap = $('moodWrap');
  if (!topic || !topic.char.mood) { wrap.hidden = true; return; }
  wrap.hidden = false;
  $('moodBar').textContent = '●'.repeat(mood) + '○'.repeat(3 - mood);
  $('moodLabel').textContent = moodLabel();
}

function pickLine(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function sayCharLine(text, lang) {
  talk(false);
  await speak(text, lang, {
    onStart: () => talk(true),
    onEnd: () => talk(false),
  });
}

async function showTurn() {
  const turn = topic.turns[turnIndex];
  attempts = 0;
  turnDone = false;
  $('turnNo').textContent = turnIndex + 1;
  $('sessionScore').textContent = sessionScore;
  $('sessionProgress').style.width = `${(turnIndex / 5) * 100}%`;
  $('feedback').hidden = true;
  $('btnNext').hidden = true;
  $('btnRepeatModel').hidden = true;
  $('answerInput').value = '';
  $('answerInput').disabled = false;
  $('btnSend').disabled = false;
  $('charLine').textContent = turn.say;
  $('charLineVi').textContent = turn.sayVi;
  renderMood();
  setMoodExpression(topic, mood);
  await sayCharLine(turn.say, 'en');
}

async function startTopic(t) {
  stop();
  greeted = true; // a pending greeting must not talk over the session
  $('greetNote').hidden = true;
  $('btnHearGreet').hidden = true;
  topic = t;
  turnIndex = 0;
  sessionScore = 0;
  mood = 0;
  review = [];
  showScreen('session');
  moveAvatar('session');
  if (avatar) avatar.setRole(t.id);
  $('sessionTitle').textContent = t.title;
  $('sessionChar').textContent = `${t.char.name} · ${t.char.role}`;
  $('charLine').textContent = t.introVi;
  $('charLineVi').textContent = '';
  // Pre-download the remaining Piper voice in the background (the greeting
  // already fetched the Vietnamese one); never blocks the first turn.
  if (getEngine() === 'piper') preloadPiperVoices();
  await sayCharLine(t.introVi, 'vi');
  await showTurn();
}

$('btnBack').addEventListener('click', () => {
  stop();
  talk(false);
  showScreen('lobby');
  moveAvatar('lobby');
  renderTopics();
});
$('btnReplay').addEventListener('click', async () => {
  const turn = topic.turns[turnIndex];
  await sayCharLine(turn.say, 'en');
});

function polite(text) {
  const n = ` ${text.toLowerCase()} `;
  return n.includes(' please ') || n.includes(' thank ') || n.includes(' thanks ');
}

function renderFeedback({ ok, title, lines, model }) {
  const fb = $('feedback');
  fb.hidden = false;
  fb.className = `feedback ${ok ? 'good' : 'bad'}`;
  fb.innerHTML = `<h3>${title}</h3>` +
    lines.map((l) => `<p>${l}</p>`).join('') +
    (model ? `<p class="model">Câu mẫu: ${model}</p>` : '');
}

async function handleAnswer(rawText, fromMic) {
  if (turnDone || !topic) return;
  const text = (rawText || '').trim();
  if (!text) return;
  const turn = topic.turns[turnIndex];
  attempts += 1;
  const { correct, missing } = checkAnswer(text, turn.expect);
  const lines = PERSONA_LINES[topic.char.personality] || PERSONA_LINES.cheerful;

  if (correct) {
    const pts = attempts === 1 ? 10 : 6;
    sessionScore += pts;
    if (topic.char.mood && polite(text) && mood < 3) mood += 1;
    const soft = topic.char.mood && mood >= 3 && lines.softPraise;
    const praise = soft ? pickLine(lines.softPraise) : pickLine(lines.praise);
    turnDone = true;
    $('sessionScore').textContent = sessionScore;
    $('answerInput').disabled = true;
    $('btnSend').disabled = true;
    renderFeedback({ ok: true, title: `🎉 ${praise}`, lines: [`Bạn được +${pts} điểm.`] });
    setMoodExpression(topic, mood);
    renderMood();
    $('btnNext').hidden = false;
    await sayCharLine(praise, 'vi');
    return;
  }

  const notes = mistakeNotes(text, topic.id);
  if (fromMic) {
    const mw = missingWords(text, turn.model);
    if (mw.length) {
      notes.push(`Nghe chưa rõ các từ này trong câu mẫu, bạn luyện phát âm thêm nhé: ${mw.join(', ')}.`);
    }
  }
  if (attempts < 2) {
    renderFeedback({
      ok: false,
      title: 'Chưa đúng hẳn, nói lại lần nữa nhé!',
      lines: [
        ...notes,
        `Mẹo: ${turn.tipVi}`,
        missing.length
          ? 'Câu của bạn còn thiếu ý: ' + missing.map((i) => turn.expect[i][0]).join(' · ')
          : '',
      ].filter(Boolean),
    });
    return;
  }

  // Second failure: show the model answer, offer read-after-me (+2).
  turnDone = true;
  review.push({ say: turn.say, model: turn.model, tipVi: turn.tipVi });
  $('answerInput').disabled = true;
  $('btnSend').disabled = true;
  renderFeedback({
    ok: false,
    title: 'Để Emma nói mẫu cho bạn nhé',
    lines: [...notes, `Giải thích: ${turn.tipVi}`],
    model: turn.model,
  });
  $('btnRepeatModel').hidden = false;
  $('btnNext').hidden = false;
  await sayCharLine(turn.model, 'en');
}

$('btnSend').addEventListener('click', () => handleAnswer($('answerInput').value, false));
$('answerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAnswer(e.target.value, false);
});

$('btnRepeatModel').addEventListener('click', async () => {
  const turn = topic.turns[turnIndex];
  sessionScore += 2;
  $('sessionScore').textContent = sessionScore;
  $('btnRepeatModel').hidden = true;
  await sayCharLine(turn.model, 'en');
});

$('btnNext').addEventListener('click', async () => {
  stop();
  talk(false);
  if (turnIndex + 1 < topic.turns.length) {
    turnIndex += 1;
    await showTurn();
  } else {
    finishTopic();
  }
});

// ---------- mic ----------
if (!recognitionSupported()) {
  $('btnMic').disabled = true;
  $('micState').textContent = 'Trình duyệt này chưa hỗ trợ mic — bạn gõ chữ nhé.';
}
$('btnMic').addEventListener('click', async () => {
  if (!topic || turnDone) return;
  const btn = $('btnMic');
  btn.classList.add('listening');
  $('micState').textContent = 'Đang nghe… bạn nói câu tiếng Anh đi.';
  if (avatar) avatar.setListening(true);
  const res = await listenOnce({ lang: 'en-US' });
  btn.classList.remove('listening');
  if (avatar) avatar.setListening(false);
  if (res.transcript) {
    $('micState').textContent = `Nghe được: "${res.transcript}"`;
    $('answerInput').value = res.transcript;
    await handleAnswer(res.transcript, true);
  } else if (res.error === 'timeout' || res.error === 'empty' || res.error === 'ended') {
    $('micState').textContent = 'Nghe chưa rõ, bạn nói lại hoặc gõ chữ nhé.';
  } else if (res.error === 'not-allowed' || res.error === 'service-not-allowed') {
    $('micState').textContent = 'Mic chưa được cấp quyền — bạn bấm cho phép mic rồi thử lại, hoặc gõ chữ nhé.';
  } else {
    $('micState').textContent = 'Mic gặp lỗi, bạn gõ chữ nhé.';
  }
});

// ---------- result ----------
function finishTopic() {
  showScreen('result');
  moveAvatar('lobby');
  const stars = sessionScore >= 45 ? 3 : sessionScore >= 30 ? 2 : sessionScore >= 15 ? 1 : 0;
  $('resultStars').textContent = '⭐'.repeat(stars) || 'Cố lên nhé!';
  $('resultScore').textContent = sessionScore;
  $('resultMood').textContent = topic.char.mood
    ? (mood >= 3
      ? `${topic.char.name} đã dịu hẳn vì bạn luôn lịch sự và chính xác. Tuyệt vời!`
      : `${topic.char.name} vẫn còn hơi khó tính — lần sau lịch sự và đúng liên tiếp nhé!`)
    : `${topic.char.name} rất vui vì được trò chuyện với bạn!`;
  const list = $('reviewList');
  list.innerHTML = review.length
    ? review.map((r) => `<li><b>${r.model}</b><br/><small>${r.tipVi}</small></li>`).join('')
    : '<li>Không có câu nào cần ôn — buổi này bạn làm đúng hết!</li>';
  const prev = progress.best[topic.id];
  if (!prev || sessionScore > prev.score) {
    progress.best[topic.id] = { stars, score: sessionScore };
  }
  progress.score += sessionScore;
  progress.stars += stars;
  saveProgress();
  renderTotals();
}
$('btnReplayTopic').addEventListener('click', () => startTopic(topic));
$('btnResultBack').addEventListener('click', () => {
  stop();
  talk(false);
  showScreen('lobby');
  moveAvatar('lobby');
  renderTopics();
});

// ---------- boot ----------
attemptGreet();
