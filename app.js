'use strict';

// ---------- 使用者(多人版) ----------
// 每個人有自己的題庫 data/users/<id>.json = {name, words}。網址 ?u=<id> 打開就記住是誰,之後不帶也可以。
// 這支手機現在是誰:localStorage vocab_user;登入憑證(上傳用)存在 vocab_auth_<id> = {name, token}
const USER_KEY = 'vocab_user';
const LEGACY_UID = 'ss844w';   // 多人版以前的練習紀錄(vocab_stats_v1 等)歸給第一個使用者
const urlUid = new URLSearchParams(location.search).get('u');
if (urlUid && /^[a-z0-9]{6}$/.test(urlUid)) localStorage.setItem(USER_KEY, urlUid);
// 用過多人版以前的網頁(有舊的練習紀錄或上傳密碼)→ 就是第一個使用者
if (!localStorage.getItem(USER_KEY) && LEGACY_UID &&
    ['vocab_stats_v1', 'vocab_home_v1', 'vocab_browse_v1', 'vocab_upload_pw'].some(k => localStorage.getItem(k) != null)) {
  localStorage.setItem(USER_KEY, LEGACY_UID);
  localStorage.removeItem('vocab_upload_pw');
}
const UID = localStorage.getItem(USER_KEY);
function authOf(uid = UID) { try { return JSON.parse(localStorage.getItem('vocab_auth_' + uid)) || {}; } catch { return {}; } }
function setAuth(uid, a) { localStorage.setItem('vocab_auth_' + uid, JSON.stringify(a)); }
if (UID && UID === LEGACY_UID) {   // 舊的練習紀錄搬過來(只做一次)
  for (const k of ['stats', 'home', 'browse']) {
    const old = localStorage.getItem(`vocab_${k}_v1`);
    if (old != null && localStorage.getItem(`vocab_${k}_${UID}`) == null) localStorage.setItem(`vocab_${k}_${UID}`, old);
    localStorage.removeItem(`vocab_${k}_v1`);
  }
}

// ---------- 題庫 ----------
const POS_LABEL = { n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.', conj: 'conj.', pron: 'pron.' };
const POS_CHOICES = ['n', 'v', 'adj', 'adv', 'prep', 'conj'];   // 詞性題 6 個選項

// 題庫在 data/users/<id>.json,啟動時載入(見最下方 init)
// 每個字:{word, page, senses:[{pos, zh, ex:[{en, zh, audio}]}]},課本上每個意思和它的例句(audio 是例句音檔 audio/e/<audio>.mp3)
// 照課本頁碼(同頁照字母)排好,每 GROUP_SIZE 個字分成一「頁」(GROUPS),複習和考試都用這個分頁
const GROUP_SIZE = 40;
let WORDS = [], BY_WORD = {}, GROUPS = [];

function setWords(list) {
  list = list.slice().sort((a, b) => a.page - b.page || a.word.localeCompare(b.word));
  WORDS = list.map(w => ({
    ...w,
    senses: w.senses.map(s => ({ ...s, ex: s.ex || [] })),
    pos: [...new Set(w.senses.map(s => s.pos))],
    meaning: w.senses.map(s => `${POS_LABEL[s.pos]} ${s.zh}`).join('  '),
  }));
  BY_WORD = Object.fromEntries(WORDS.map(w => [w.word, w]));
  GROUPS = [];
  for (let i = 0; i < WORDS.length; i += GROUP_SIZE) {
    const words = WORDS.slice(i, i + GROUP_SIZE);
    GROUPS.push({ n: GROUPS.length + 1, words, from: words[0].page, to: words[words.length - 1].page });
  }
}
function bookPages(g) { return g.from === g.to ? `p.${g.from}` : `p.${g.from}–${g.to}`; }

// ---------- 紀錄(存在瀏覽器 localStorage) ----------
const STORE_KEY = 'vocab_stats_' + UID;
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
// 播放預先產生的音檔(audio/w/<單字>.mp3、audio/e/<例句的 audio>.mp3),沒有音檔時改用瀏覽器語音
let currentAudio = null;
function play(kind, key, text) {
  if (!text) return;
  if (currentAudio) currentAudio.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!key) { speak(text); return; }
  const audio = currentAudio = new Audio(`audio/${kind}/${encodeURIComponent(key)}.mp3`);
  let fellBack = false;
  const fallback = () => { if (!fellBack) { fellBack = true; speak(text); } };
  audio.onerror = fallback;
  audio.play().catch(fallback);
}
const SPEAKER_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
function sayWord(word) {
  return `<button class="say" data-kind="w" data-key="${esc(word)}" data-text="${esc(word)}" aria-label="唸單字">${SPEAKER_SVG}</button>`;
}
function sayEx(ex) {
  return `<button class="say" data-kind="e" data-key="${esc(ex.audio || '')}" data-text="${esc(ex.en)}" aria-label="唸例句">${SPEAKER_SVG}</button>`;
}
// 所有喇叭按鈕共用一個點擊處理
document.addEventListener('click', e => {
  const b = e.target.closest('.say');
  if (!b) return;
  e.stopPropagation();
  play(b.dataset.kind, b.dataset.key, b.dataset.text);
}, true);

function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- 首頁 ----------
// scope:'all' 全部、'weak' 不熟,或是選了哪幾頁(陣列,1 開始)。設定記在 localStorage,下次打開一樣
const HOME_KEY = 'vocab_home_' + UID;
const settings = Object.assign({ mode: 'meaning', scope: 'all', count: 'all' },
  (() => { try { return JSON.parse(localStorage.getItem(HOME_KEY)) || {}; } catch { return {}; } })());
function saveSettings() { localStorage.setItem(HOME_KEY, JSON.stringify(settings)); }

document.querySelectorAll('.seg').forEach(seg => {
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === settings[seg.dataset.name]));
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    settings[seg.dataset.name] = btn.dataset.value;
    saveSettings();
    $('home-msg').textContent = '';
  });
});

function chip(label, sub, on, onclick) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  b.innerHTML = `${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  b.onclick = onclick;
  return b;
}

function scopePool() {
  if (settings.scope === 'weak') return weakWords();
  if (Array.isArray(settings.scope)) return settings.scope.flatMap(n => GROUPS[n - 1]?.words || []);
  return WORDS;
}

function renderScopeChips() {
  if (Array.isArray(settings.scope)) {   // 題庫變動後,不存在的頁拿掉
    settings.scope = settings.scope.filter(n => n <= GROUPS.length);
    if (!settings.scope.length) settings.scope = 'all';
  }
  const box = $('scope-chips');
  box.innerHTML = '';
  const pick = v => { settings.scope = v; saveSettings(); renderScopeChips(); $('home-msg').textContent = ''; };
  box.appendChild(chip('全部', `${WORDS.length} 字`, settings.scope === 'all', () => pick('all')));
  box.appendChild(chip('不熟', `${weakWords().length} 字`, settings.scope === 'weak', () => pick('weak')));
  GROUPS.forEach(g => {
    const on = Array.isArray(settings.scope) && settings.scope.includes(g.n);
    box.appendChild(chip(`第 ${g.n} 頁`, bookPages(g), on, () => {
      const cur = Array.isArray(settings.scope) ? settings.scope : [];
      const nextSel = on ? cur.filter(n => n !== g.n) : [...cur, g.n].sort((a, b) => a - b);
      pick(nextSel.length ? nextSel : 'all');
    }));
  });
  const n = scopePool().length;
  $('scope-info').textContent = settings.scope === 'all' ? `考全部 ${n} 個字`
    : settings.scope === 'weak' ? `考不熟的 ${n} 個字`
    : `已選 第 ${settings.scope.join('、')} 頁,共 ${n} 個字`;
}

function refreshHome() {
  $('stat-total').textContent = WORDS.length;
  $('stat-weak').textContent = weakWords().length;
  $('home-msg').textContent = '';
  renderScopeChips();
}

$('btn-start').onclick = () => {
  const pool = scopePool();
  if (!pool.length) {
    $('home-msg').textContent = !WORDS.length ? '還沒有單字,先按下面「新增課本頁」上傳課本照片'
      : settings.scope === 'weak' ? '目前沒有不熟的單字 👍' : '這個範圍沒有單字';
    return;
  }
  const n = settings.count === 'all' ? pool.length : Math.min(+settings.count, pool.length);
  startQuiz(weightedPick(pool, n), settings.mode);
};
$('btn-browse').onclick = () => openBrowse();
$('stat-weak-box').onclick = () => openBrowse('weak');

// ---------- 測驗 ----------
let quiz = null;

function startQuiz(list, mode) {
  quiz = { list: shuffle(list), mode, i: 0, correct: 0, wrongs: [], answered: false, selected: new Set(), picked: new Set() };
  show('quiz');
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.list[quiz.i];
  quiz.answered = false;
  quiz.selected = new Set();
  quiz.picked = new Set();
  $('progress').textContent = `${quiz.i + 1}/${quiz.list.length}`;
  $('word').textContent = q.word;
  $('btn-say').dataset.key = $('btn-say').dataset.text = q.word;
  quiz.answers = meaningAnswers(q);
  const multi = quiz.answers.length > 1;
  $('word-sub').textContent = {
    meaning: multi ? '複選題:選出所有正確的意思' : '',
    pos: '選出所有正確的詞性(可複選)',
    both: multi ? '選出所有中文意思(複選),並選出所有詞性' : '選中文意思,並選出所有詞性',
  }[quiz.mode];
  $('feedback').innerHTML = '';
  updateStar();

  const box = $('options');
  box.innerHTML = '';
  if (quiz.mode === 'both') box.appendChild(sectionLabel(multi ? '中文意思(複選)' : '中文意思'));
  if (quiz.mode !== 'pos') box.appendChild(buildMeaningOptions(q));
  if (quiz.mode === 'both') box.appendChild(sectionLabel('詞性(可複選)'));
  if (quiz.mode !== 'meaning') box.appendChild(buildPosGrid());

  $('btn-action').textContent = '確認';
  $('btn-action').classList.toggle('hidden', quiz.mode === 'meaning' && !multi);
}

function sectionLabel(text) {
  const d = document.createElement('div');
  d.className = 'opt-label';
  d.textContent = text;
  return d;
}

// 意思選項:每個選項是一個意思(課本上的一列)。合併模式只顯示中文(不顯示詞性,以免洩漏答案)
function senseLabel(s) { return quiz.mode === 'both' ? s.zh : `${POS_LABEL[s.pos]} ${s.zh}`; }
function meaningAnswers(q) { return [...new Set(q.senses.map(senseLabel))]; }

// 正確的意思 + 其他單字的意思當干擾選項:固定 6 個選項(正確答案很多時至少留 2 個干擾)
function buildMeaningOptions(q) {
  const answers = quiz.answers, multi = answers.length > 1;
  const zhs = new Set(q.senses.map(s => s.zh));
  const opts = answers.map(label => ({ label, ok: true }));
  const total = Math.max(6, answers.length + 2);
  for (const d of shuffle(WORDS)) {
    if (opts.length >= total) break;
    if (d.word === q.word) continue;
    const s = d.senses[Math.floor(Math.random() * d.senses.length)];
    const label = senseLabel(s);
    if (!zhs.has(s.zh) && !opts.some(o => o.label === label)) opts.push({ label, ok: false });
  }
  const wrap = document.createElement('div');
  wrap.className = 'opt-col meaning-opts' + (quiz.mode === 'both' ? ' two-col' : '');   // 合併模式選項短,排兩欄才放得下詞性
  shuffle(opts).forEach(o => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = o.label;
    b.dataset.ok = o.ok ? '1' : '';
    b.onclick = () => {
      if (quiz.answered) return;
      if (multi) {   // 複選:點一下選、再點一下取消
        quiz.picked.has(o.label) ? quiz.picked.delete(o.label) : quiz.picked.add(o.label);
        b.classList.toggle('selected');
      } else {
        quiz.picked = new Set([o.label]);
        if (quiz.mode === 'meaning') submit();
        else wrap.querySelectorAll('.opt').forEach(x => x.classList.toggle('selected', x === b));
      }
    };
    wrap.appendChild(b);
  });
  return wrap;
}

function buildPosGrid() {
  const grid = document.createElement('div');
  grid.className = 'pos-grid';
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
    grid.appendChild(b);
  });
  return grid;
}

// 標出正確/錯誤;reveal = 按提示時直接顯示答案
function markMeaning(q, reveal) {
  document.querySelectorAll('#options .meaning-opts .opt').forEach(b => {
    const right = !!b.dataset.ok, sel = !reveal && quiz.picked.has(b.textContent);
    b.classList.remove('selected');
    if (right && (sel || reveal)) b.classList.add('correct');
    else if (sel && !right) b.classList.add('wrong');
    else if (right) b.classList.add('missed');
  });
}
function markPos(q, reveal) {
  const answer = new Set(q.pos);
  document.querySelectorAll('#options .pos-grid .opt').forEach(b => {
    const p = b.dataset.pos, sel = !reveal && quiz.selected.has(p), right = answer.has(p);
    b.classList.remove('selected');
    if (right && (sel || reveal)) b.classList.add('correct');
    else if (sel && !right) b.classList.add('wrong');
    else if (right) b.classList.add('missed');
  });
}

function submit() {
  const q = quiz.list[quiz.i];
  const needMeaning = quiz.mode !== 'pos', needPos = quiz.mode !== 'meaning';
  if (needMeaning && !quiz.picked.size) return warn(quiz.answers.length > 1 ? '請選出所有正確的意思' : '請選一個中文意思');
  if (needPos && !quiz.selected.size) return warn('請至少選一個詞性');
  quiz.answered = true;

  const answer = new Set(q.pos);
  const meaningOk = !needMeaning || (quiz.picked.size === quiz.answers.length && quiz.answers.every(a => quiz.picked.has(a)));
  const posOk = !needPos || (answer.size === quiz.selected.size && [...answer].every(p => quiz.selected.has(p)));
  if (needMeaning) markMeaning(q, false);
  if (needPos) markPos(q, false);

  let msg = '';
  if (quiz.mode === 'both' && meaningOk !== posOk) msg = meaningOk ? '(意思對,詞性錯)' : '(詞性對,意思錯)';
  finishAnswer(meaningOk && posOk, msg);
}
function warn(text) { $('feedback').innerHTML = `<span class="ng">${text}</span>`; }

function finishAnswer(ok, msg = '', hinted = false) {
  const q = quiz.list[quiz.i];
  record(q.word, ok);
  if (ok) quiz.correct++;
  else quiz.wrongs.push(q);
  updateStar();
  const head = hinted
    ? '<span class="hint-tag">正確答案(看提示算答錯,已加入不熟單字)</span>'
    : ok ? '<span class="ok">✔ 答對了</span>' : `<span class="ng">✘ 答錯了${msg}</span>`;
  $('feedback').innerHTML = head + `<div class="answer">${esc(q.word)}</div>` + sensesHtml(q);
  $('btn-action').textContent = quiz.i + 1 < quiz.list.length ? '下一題' : '看結果';
  $('btn-action').classList.remove('hidden');
}

// 每個意思和它的例句,例句裡的單字(含變化形)標粗體
function sensesHtml(q) {
  const stem = q.word.length > 4 ? q.word.replace(/[ey]$/, '') : q.word;
  const re = new RegExp(`\\b(${stem}\\w*)`, 'gi');
  return q.senses.map(s =>
    `<div class="sense"><span class="pos">${POS_LABEL[s.pos]}</span> ${esc(s.zh)}</div>` +
    (s.ex || []).map(ex => `<div class="example">${sayEx(ex)}<div class="en">${esc(ex.en).replace(re, '<b>$1</b>')}</div><div class="zh">${esc(ex.zh)}</div></div>`).join('')
  ).join('');
}

function next() {
  quiz.i++;
  if (quiz.i >= quiz.list.length) showResult();
  else renderQuestion();
}

$('btn-action').onclick = () => {
  if (!quiz.answered) submit();
  else next();
};
$('word-card').onclick = () => { const w = quiz.list[quiz.i].word; play('w', w, w); };

// 提示:直接顯示正確答案與例句,這題算答錯
$('btn-hint').onclick = () => {
  if (quiz.answered) return;
  const q = quiz.list[quiz.i];
  quiz.answered = true;
  if (quiz.mode !== 'pos') markMeaning(q, true);
  if (quiz.mode !== 'meaning') markPos(q, true);
  finishAnswer(false, '', true);
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
      li.innerHTML = sayWord(w.word) + `<span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning)}</span>`;
      ul.appendChild(li);
    });
  }
  show('result');
}
$('btn-retry-wrong').onclick = () => startQuiz(quiz.wrongs, quiz.mode);
$('btn-home').onclick = () => { refreshHome(); show('home'); };

// ---------- 複習單字(每 40 個一頁 + 不熟) ----------
const BROWSE_KEY = 'vocab_browse_' + UID;
let browseSel = localStorage.getItem(BROWSE_KEY) || '1';   // '1'、'2'… 或 'weak'

function openBrowse(sel) {
  if (sel) browseSel = sel;
  if (browseSel !== 'weak' && !GROUPS[+browseSel - 1]) browseSel = GROUPS.length ? '1' : 'weak';
  renderBrowse();
  show('browse');
}

function exRow(ex) {
  return `<div class="ex">${sayEx(ex)}<div><div class="en">${esc(ex.en)}</div><div class="zh">${esc(ex.zh)}</div></div></div>`;
}

function renderBrowse() {
  localStorage.setItem(BROWSE_KEY, browseSel);
  const weak = browseSel === 'weak';
  const box = $('browse-chips');
  box.innerHTML = '';
  GROUPS.forEach(g => box.appendChild(chip(`第 ${g.n} 頁`, bookPages(g), browseSel === String(g.n), () => { browseSel = String(g.n); renderBrowse(); })));
  box.appendChild(chip('不熟', `${weakWords().length} 字`, weak, () => { browseSel = 'weak'; renderBrowse(); }));

  const list = weak ? weakWords() : GROUPS[+browseSel - 1].words;
  $('browse-info').textContent = weak
    ? '答錯會自動加入;同一個單字連續答對 3 次會自動移出。點 ✕ 可以手動移除;在其他頁點 ☆ 也可以加進來。'
    : `第 ${browseSel} 頁:${list.length} 個字(課本 ${bookPages(GROUPS[+browseSel - 1])})。點 ☆ 加入不熟。`;
  $('btn-reset').classList.toggle('hidden', !weak);
  $('browse-quiz').classList.toggle('hidden', !list.length);
  $('browse-quiz').textContent = weak ? `考不熟的單字(${list.length})` : `考這一頁(${list.length})`;

  const ul = $('browse-list');
  ul.innerHTML = '';
  if (!list.length) { ul.innerHTML = `<li class="empty">${WORDS.length ? '目前沒有不熟的單字 👍' : '還沒有單字,先上傳課本照片'}</li>`; return; }
  list.forEach(w => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="row">` + sayWord(w.word) +
      `<span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning)}</span>` +
      (weak ? `<span class="n">${rec(w.word).wrong ? '錯 ' + rec(w.word).wrong : '★'}</span><button class="x" aria-label="移除">✕</button>`
            : `<button class="x st${isWeak(w.word) ? ' on' : ''}" aria-label="加入不熟">${isWeak(w.word) ? '★' : '☆'}</button>`) +
      `</div>` +
      (w.senses.length > 1 || w.senses.some(s => s.ex.length > 1)
        ? w.senses.map(s => `<div class="sense"><span class="pos">${POS_LABEL[s.pos]}</span> ${esc(s.zh)}</div>` + s.ex.map(exRow).join('')).join('')
        : w.senses[0].ex.map(exRow).join(''));
    li.querySelector('.x').onclick = () => {
      const rr = rec(w.word);
      if (weak || isWeak(w.word)) { rr.star = false; rr.streak = GRADUATE_STREAK; }   // 移出不熟
      else rr.star = true;
      save();
      renderBrowse();
    };
    ul.appendChild(li);
  });
}
$('browse-quiz').onclick = () => {
  const list = browseSel === 'weak' ? weakWords() : GROUPS[+browseSel - 1].words;
  startQuiz(list, settings.mode);
};
document.querySelectorAll('.btn-to-home').forEach(b => b.onclick = () => { refreshHome(); show('home'); });
$('btn-reset').onclick = () => {
  if (!confirm('確定要清除所有練習紀錄嗎?')) return;
  stats = {}; save();
  renderBrowse();
};

// ---------- 歡迎(建立題庫 / 登入) ----------
// 建立和登入都要家裡電腦開著(findServer 在 upload.js);之後練習只需要 GitHub Pages
function showWelcome(msg = '') {
  $('wl-msg').textContent = msg;
  show('welcome');
}
async function welcomeCall(path, body) {
  const msgEl = $(path === '/api/register' ? 'wl-reg-msg' : 'wl-msg');
  const say = t => { msgEl.textContent = t; };
  say('連線到家裡電腦…');
  const srv = await findServer();
  if (!srv) { say('家裡電腦目前沒有開服務,請稍後再試。'); return; }
  try {
    const r = await fetch(srv.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { say(d.detail || `伺服器錯誤(${r.status})`); return; }
    setAuth(d.id, { name: d.name, token: d.token });
    localStorage.setItem(USER_KEY, d.id);
    if (path === '/api/register') localStorage.setItem('vocab_new_' + d.id, '1');
    location.replace(location.pathname + '?u=' + d.id);
  } catch { say('連不到家裡電腦,請稍後再試。'); }
}
// 登入在上面;按「建立帳號」才展開建立的欄位
$('wl-new').onclick = () => {
  $('wl-new-box').classList.add('hidden');
  $('wl-reg-box').classList.remove('hidden');
  $('wl-msg').textContent = '';
  $('wl-name').focus();
};
$('wl-cancel').onclick = () => {
  $('wl-reg-box').classList.add('hidden');
  $('wl-new-box').classList.remove('hidden');
  $('wl-msg').textContent = '';
};
$('wl-reg').onclick = () => {
  const name = $('wl-name').value.trim(), password = $('wl-pw').value, invite = $('wl-invite').value.trim();
  const say = t => { $('wl-reg-msg').textContent = t; };
  if (!name || !password || !$('wl-pw2').value || !invite) { say('暱稱、密碼、確認密碼、邀請碼都要填'); return; }
  if (password.length < 4) { say('密碼要 4 個字以上'); return; }
  if (password !== $('wl-pw2').value) { say('兩次輸入的密碼不一樣,請再確認'); $('wl-pw2').value = ''; $('wl-pw2').focus(); return; }
  welcomeCall('/api/register', { name, password, invite });
};
$('li-go').onclick = () => {
  const name = $('li-name').value.trim(), password = $('li-pw').value;
  if (!name || !password) { $('wl-msg').textContent = '請填暱稱和密碼'; return; }
  welcomeCall('/api/login', { name, password });
};
$('btn-switch').onclick = () => {
  if (!confirm('切換到別人的題庫?(你的練習紀錄會留在這支手機上)')) return;
  localStorage.removeItem(USER_KEY);
  location.replace(location.pathname);
};
function myUrl() { return location.origin + location.pathname + '?u=' + UID; }
$('btn-myurl').onclick = async () => {
  try { await navigator.clipboard.writeText(myUrl()); $('btn-myurl').textContent = '已複製 ✓'; }
  catch { prompt('我的專屬網址:', myUrl()); }
};

async function init() {
  $('btn-say').innerHTML = SPEAKER_SVG;
  if (!UID) { showWelcome(); return; }
  show('home');
  let bank;
  try {
    const res = await fetch(`data/users/${UID}.json`, { cache: 'no-cache' });
    if (res.status === 404) {
      localStorage.removeItem(USER_KEY);
      showWelcome('找不到這個題庫(網址可能打錯了),請重新登入。');
      return;
    }
    bank = await res.json();
    setWords(bank.words);
  } catch {
    $('home-msg').textContent = '題庫載入失敗,請檢查網路後重新整理';
    return;
  }
  $('who').textContent = bank.name;
  $('my-url').textContent = myUrl();
  refreshHome();
  if (localStorage.getItem('vocab_new_' + UID)) {   // 剛建立:提醒存網址
    localStorage.removeItem('vocab_new_' + UID);
    $('home-note').textContent = '題庫建立好了!請把這個網頁「加入主畫面」,或複製下面的專屬網址,之後打開就是你的題庫。\n接著按「新增課本頁」上傳課本照片。';
    $('home-note').classList.remove('hidden');
  } else if (!WORDS.length) {
    $('home-note').textContent = '還沒有單字,先按下面「新增課本頁」上傳課本照片。';
    $('home-note').classList.remove('hidden');
  }
}
init();
