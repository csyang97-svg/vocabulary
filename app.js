'use strict';

// ---------- 題庫 ----------
const POS_LABEL = { n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.' };
const POS_CHOICES = ['n', 'v', 'adj', 'adv'];

const WORDS = RAW_WORDS.map(([word, page, def]) => {
  const senses = def.split('|').map(s => {
    const [pos, zh] = s.split(':');
    return { pos, zh };
  });
  return {
    word, page, senses,
    pos: [...new Set(senses.map(s => s.pos))],
    meaning: senses.map(s => `${POS_LABEL[s.pos]} ${s.zh}`).join('  '),
  };
});
const BY_WORD = Object.fromEntries(WORDS.map(w => [w.word, w]));
const PAGES = [...new Set(WORDS.map(w => w.page))].sort((a, b) => a - b);

// ---------- 紀錄(存在瀏覽器 localStorage) ----------
const STORE_KEY = 'vocab_stats_v1';
const GRADUATE_STREAK = 3; // 連續答對幾次自動移出不熟清單
let stats = load();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); }
function rec(word) {
  return stats[word] || (stats[word] = { wrong: 0, right: 0, streak: 0, star: false });
}
function isWeak(word) {
  const r = stats[word];
  return !!r && (r.star || (r.wrong > 0 && r.streak < GRADUATE_STREAK));
}
function record(word, correct) {
  const r = rec(word);
  if (correct) {
    r.right++; r.streak++;
    if (r.streak >= GRADUATE_STREAK) r.star = false;
  } else {
    r.wrong++; r.streak = 0;
  }
  save();
}
function weakWords() {
  return WORDS.filter(w => isWeak(w.word))
    .sort((a, b) => rec(b.word).wrong - rec(a.word).wrong);
}

// ---------- 工具 ----------
const $ = id => document.getElementById(id);
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 不熟的單字權重較高,比較容易被抽到
function weightedPick(list, n) {
  return list
    .map(w => {
      const weight = isWeak(w.word) ? 3 + rec(w.word).wrong : 1;
      return { w, key: Math.pow(Math.random(), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, n)
    .map(x => x.w);
}
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = 0.9;
  speechSynthesis.speak(u);
}
function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- 首頁 ----------
const settings = { mode: 'meaning', scope: 'all', count: '20' };

document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    settings[seg.dataset.name] = btn.dataset.value;
    $('page-range').classList.toggle('hidden', settings.scope !== 'pages');
    $('home-msg').textContent = '';
  });
});

PAGES.forEach(p => {
  $('page-from').add(new Option(p, p));
  $('page-to').add(new Option(p, p));
});
$('page-to').value = PAGES[PAGES.length - 1];

function refreshHome() {
  $('stat-total').textContent = WORDS.length;
  $('stat-weak').textContent = weakWords().length;
  $('home-msg').textContent = '';
}

$('btn-start').onclick = () => {
  let pool;
  if (settings.scope === 'weak') {
    pool = weakWords();
    if (!pool.length) { $('home-msg').textContent = '目前沒有不熟的單字 👍'; return; }
  } else if (settings.scope === 'pages') {
    let from = +$('page-from').value, to = +$('page-to').value;
    if (from > to) [from, to] = [to, from];
    pool = WORDS.filter(w => w.page >= from && w.page <= to);
  } else {
    pool = WORDS;
  }
  const n = settings.count === 'all' ? pool.length : Math.min(+settings.count, pool.length);
  startQuiz(weightedPick(pool, n), settings.mode);
};
$('btn-weaklist').onclick = () => { renderWeakList(); show('weaklist'); };

// ---------- 測驗 ----------
let quiz = null;

function startQuiz(list, mode) {
  quiz = { list: shuffle(list), mode, i: 0, correct: 0, wrongs: [], answered: false, selected: new Set() };
  show('quiz');
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.list[quiz.i];
  quiz.answered = false;
  quiz.selected = new Set();
  $('progress').textContent = `${quiz.i + 1}/${quiz.list.length}`;
  $('word').textContent = q.word;
  $('word-sub').textContent = quiz.mode === 'pos' ? '選出所有正確的詞性(可複選)' : '';
  $('feedback').innerHTML = '';
  updateStar();

  const box = $('options');
  box.innerHTML = '';
  box.className = 'options';

  if (quiz.mode === 'meaning') {
    $('btn-action').classList.add('hidden');
    const distractors = shuffle(WORDS.filter(w => w.word !== q.word && w.meaning !== q.meaning));
    const opts = [q];
    for (const d of distractors) {
      if (opts.length >= 4) break;
      if (!opts.some(o => o.meaning === d.meaning)) opts.push(d);
    }
    shuffle(opts).forEach(o => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = o.meaning;
      b.dataset.word = o.word;
      b.onclick = () => answerMeaning(b, o === q);
      box.appendChild(b);
    });
  } else {
    box.classList.add('pos-grid');
    $('btn-action').textContent = '確認';
    $('btn-action').classList.remove('hidden');
    POS_CHOICES.forEach(p => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = POS_LABEL[p];
      b.dataset.pos = p;
      b.onclick = () => {
        if (quiz.answered) return;
        quiz.selected.has(p) ? quiz.selected.delete(p) : quiz.selected.add(p);
        b.classList.toggle('selected');
      };
      box.appendChild(b);
    });
  }
}

function answerMeaning(btn, ok) {
  if (quiz.answered) return;
  quiz.answered = true;
  const q = quiz.list[quiz.i];
  document.querySelectorAll('#options .opt').forEach(b => {
    if (b.dataset.word === q.word) b.classList.add('correct');
  });
  if (!ok) btn.classList.add('wrong');
  finishAnswer(ok);
}

function answerPos() {
  const q = quiz.list[quiz.i];
  if (!quiz.selected.size) { $('feedback').innerHTML = '<span class="ng">請至少選一個詞性</span>'; return; }
  quiz.answered = true;
  const answer = new Set(q.pos);
  const ok = answer.size === quiz.selected.size && [...answer].every(p => quiz.selected.has(p));
  document.querySelectorAll('#options .opt').forEach(b => {
    const p = b.dataset.pos, sel = quiz.selected.has(p), right = answer.has(p);
    b.classList.remove('selected');
    if (sel && right) b.classList.add('correct');
    else if (sel && !right) b.classList.add('wrong');
    else if (!sel && right) b.classList.add('missed');
  });
  finishAnswer(ok);
}

function finishAnswer(ok) {
  const q = quiz.list[quiz.i];
  record(q.word, ok);
  if (ok) quiz.correct++;
  else quiz.wrongs.push(q);
  updateStar();
  $('feedback').innerHTML =
    (ok ? '<span class="ok">✔ 答對了</span>' : '<span class="ng">✘ 答錯了</span>') +
    `<br>${esc(q.word)}  ${esc(q.meaning)}`;
  $('btn-action').textContent = quiz.i + 1 < quiz.list.length ? '下一題' : '看結果';
  $('btn-action').classList.remove('hidden');
}

function next() {
  quiz.i++;
  if (quiz.i >= quiz.list.length) showResult();
  else renderQuestion();
}

$('btn-action').onclick = () => {
  if (!quiz.answered) answerPos();
  else next();
};
$('word-card').onclick = () => speak(quiz.list[quiz.i].word);

$('btn-hint').onclick = () => {
  if (quiz.answered) return;
  const q = quiz.list[quiz.i];
  if (quiz.mode === 'meaning') {
    // 刪掉一個錯誤選項
    const wrongOpts = [...document.querySelectorAll('#options .opt:not(.faded)')]
      .filter(b => b.dataset.word !== q.word);
    if (wrongOpts.length > 1) {
      const b = wrongOpts[Math.floor(Math.random() * wrongOpts.length)];
      b.classList.add('faded'); b.disabled = true;
    }
  } else {
    $('word-sub').textContent = `提示:共有 ${q.pos.length} 個詞性`;
  }
};

function updateStar() {
  const q = quiz.list[quiz.i];
  const r = stats[q.word];
  $('btn-star').textContent = r && r.star ? '★' : '☆';
}
$('btn-star').onclick = () => {
  const r = rec(quiz.list[quiz.i].word);
  r.star = !r.star;
  save();
  updateStar();
};

$('btn-end').onclick = () => {
  if (quiz.i === 0 && !quiz.answered) { refreshHome(); show('home'); return; }
  // 已作答的題目才算進結果
  quiz.list = quiz.list.slice(0, quiz.i + (quiz.answered ? 1 : 0));
  showResult();
};
$('btn-back').onclick = () => { refreshHome(); show('home'); };

// ---------- 結果 ----------
function showResult() {
  const total = quiz.list.length;
  const pct = total ? Math.round(quiz.correct / total * 100) : 0;
  $('score-pct').textContent = pct + '%';
  $('score-detail').textContent = `${total} 題答對 ${quiz.correct} 題`;
  const ul = $('wrong-list');
  ul.innerHTML = '';
  if (!quiz.wrongs.length) {
    $('wrong-title').textContent = total ? '全部答對!🎉' : '';
    $('btn-retry-wrong').classList.add('hidden');
  } else {
    $('wrong-title').textContent = `答錯的單字(${quiz.wrongs.length})`;
    $('btn-retry-wrong').classList.remove('hidden');
    quiz.wrongs.forEach(w => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning)}</span>`;
      ul.appendChild(li);
    });
  }
  show('result');
}
$('btn-retry-wrong').onclick = () => startQuiz(quiz.wrongs, quiz.mode);
$('btn-home').onclick = () => { refreshHome(); show('home'); };

// ---------- 不熟清單 ----------
function renderWeakList() {
  const ul = $('weak-list');
  ul.innerHTML = '';
  const list = weakWords();
  if (!list.length) {
    ul.innerHTML = '<li class="empty">目前沒有不熟的單字</li>';
    return;
  }
  list.forEach(w => {
    const r = rec(w.word);
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="w">${r.star ? '★ ' : ''}${esc(w.word)}</span>` +
      `<span class="m">${esc(w.meaning)}</span>` +
      `<span class="n">錯 ${r.wrong}</span>` +
      `<button class="x" aria-label="移除">✕</button>`;
    li.querySelector('.x').onclick = () => {
      r.star = false; r.streak = GRADUATE_STREAK; save();
      renderWeakList();
    };
    ul.appendChild(li);
  });
}
document.querySelectorAll('.btn-to-home').forEach(b => b.onclick = () => { refreshHome(); show('home'); });
$('btn-reset').onclick = () => {
  if (!confirm('確定要清除所有練習紀錄嗎?')) return;
  stats = {}; save();
  renderWeakList();
};

refreshHome();
