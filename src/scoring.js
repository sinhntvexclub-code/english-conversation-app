// Answer checking: word-boundary keyword matching + common-mistake rules.
// All notes are Vietnamese; matching is case-insensitive and contraction-aware.

const CONTRACTIONS = [
  ["i'd", 'i would'], ["i'm", 'i am'], ["i'll", 'i will'], ["i've", 'i have'],
  ["don't", 'do not'], ["doesn't", 'does not'], ["didn't", 'did not'],
  ["that's", 'that is'], ["it's", 'it is'], ["here's", 'here is'],
  ["that'll", 'that will'], ["can't", 'can not'], ["let's", 'let us'],
  ["what's", 'what is'], ["where's", 'where is'], ["how's", 'how is'],
];

export function normalize(text) {
  let s = (text || '').toLowerCase().replace(/[’‘]/g, "'");
  for (const [a, b] of CONTRACTIONS) s = s.split(a).join(b);
  return s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

function phraseInTokens(toks, phrase) {
  const p = tokens(phrase);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length; j++) {
      if (toks[i + j] !== p[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// expect: array of groups; each group = list of alternative phrases.
// Correct only when EVERY group matches at least one alternative.
export function checkAnswer(text, expect) {
  const toks = tokens(text);
  const missing = [];
  expect.forEach((group, i) => {
    if (!group.some((alt) => phraseInTokens(toks, alt))) missing.push(i);
  });
  return { correct: missing.length === 0, missing, toks };
}

// Common mistakes, as short Vietnamese notes. Topic-scoped where politeness
// rules only apply (ordering / booking).
export function mistakeNotes(text, topicId) {
  const n = ` ${normalize(text)} `;
  const notes = [];
  if (topicId === 'goi-mon' || topicId === 'khach-san') {
    if (/\bi want\b/.test(n)) {
      notes.push('Câu này dùng "I want" nghe như ra lệnh. Lịch sự hơn: dùng "I\'d like … please".');
    }
  }
  if (/\bi have \d+ years\b/.test(n)) {
    notes.push('Nói tuổi không dùng "have". Đúng là: "I am … years old".');
  }
  if (/\bi like (play|watch|read|swim|listen|cook|draw|go)\b/.test(n)) {
    notes.push('Sau like phải là động từ thêm -ing: like playing, like reading… (không nói "like play").');
  }
  if (/\bi am agree\b/.test(n)) {
    notes.push('"Agree" không cần am: nói "I agree" (Tôi đồng ý).');
  }
  if (/\btry on it\b/.test(n)) {
    notes.push('Trật tự đúng là "try it on" (mặc thử nó), không phải "try on it".');
  }
  if (/\bhow much it is\b/.test(n)) {
    notes.push('Câu hỏi đảo trợ động từ lên trước: "How much is it?" (không phải "How much it is?").');
  }
  return notes;
}

// Words in the model answer missing from the transcript — used as a gentle
// pronunciation/listening note for mic answers (never presented as exact).
export function missingWords(transcript, model) {
  const have = new Set(tokens(transcript));
  const stop = new Set(['a', 'an', 'the', 'is', 'am', 'are', 'i', 'you', 'it', 'to', 'please']);
  return tokens(model).filter((w) => !have.has(w) && !stop.has(w)).slice(0, 4);
}
