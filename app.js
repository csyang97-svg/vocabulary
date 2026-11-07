'use strict';

// ---------- 使用者(多人版) ----------
// 每個人有自己的題庫 data/users/<id>.json = {name, words}。網址 ?u=<id> 打開就記住是誰,之後不帶也可以。
// 這支手機現在是誰:localStorage vocab_user;登入憑證(上傳用)存在 vocab_auth_<id> = {name, token}
const USER_KEY = 'vocab_user';
const LEGACY_UID = 'ss844w';   // 多人版以前的練習紀錄(vocab_stats_v1 等)歸給第一個使用者
function authOf(uid = UID) { try { return JSON.parse(localStorage.getItem('vocab_auth_' + uid)) || {}; } catch { return {}; } }
function setAuth(uid, a) { localStorage.setItem('vocab_auth_' + uid, JSON.stringify(a)); }
// 看別人的題庫:?view=<id>(唯讀,練習紀錄不保存);已經登入的人打開別人的 ?u= 也當成看
const params = new URLSearchParams(location.search);
const okId = id => /^[a-z0-9]{6}$/.test(id || '');
let VIEW = okId(params.get('view')) ? params.get('view') : null;
const urlUid = params.get('u');
if (okId(urlUid)) {
  const cur = localStorage.getItem(USER_KEY);
  if (cur && cur !== urlUid && authOf(cur).token) VIEW = urlUid;
  else localStorage.setItem(USER_KEY, urlUid);
}
// 用過多人版以前的網頁(有舊的練習紀錄或上傳密碼)→ 就是第一個使用者
if (!localStorage.getItem(USER_KEY) && LEGACY_UID &&
    ['vocab_stats_v1', 'vocab_home_v1', 'vocab_browse_v1', 'vocab_upload_pw'].some(k => localStorage.getItem(k) != null)) {
  localStorage.setItem(USER_KEY, LEGACY_UID);
  localStorage.removeItem('vocab_upload_pw');
}
const UID = localStorage.getItem(USER_KEY);
if (VIEW === UID) VIEW = null;
const BANK_UID = VIEW || UID;   // 現在顯示誰的題庫
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
// 照課本頁碼(同頁照字母)排好,每 PAGES_PER_GROUP 頁課本一組(GROUPS:p.1–6、p.7–12…,沒有字的組不顯示)
// 用固定的課本頁碼分組:同一頁課本不會被切到兩組,之後新增前面的頁數也不會讓其他組變動。g.n = 第幾組(固定)
const PAGES_PER_GROUP = 6;
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
  const byN = {};
  for (const w of WORDS) {
    const n = Math.floor((w.page - 1) / PAGES_PER_GROUP) + 1;
    (byN[n] = byN[n] || { n, words: [], from: (n - 1) * PAGES_PER_GROUP + 1, to: n * PAGES_PER_GROUP }).words.push(w);
  }
  GROUPS = Object.values(byN).sort((a, b) => a.n - b.n);
}
function BROWSE_KEY_OF(uid) { return 'vocab_browse_' + (uid || 'guest'); }
function groupOf(n) { return GROUPS.find(g => g.n === +n); }
function groupNOf(w) { return Math.floor((w.page - 1) / PAGES_PER_GROUP) + 1; }
function inGroups(list, groups) { return groups && groups.length ? list.filter(w => groups.includes(groupNOf(w))) : list; }
function bookPages(g) { return `p.${g.from}–${g.to}`; }

// ---------- 紀錄 ----------
// 先存在瀏覽器 localStorage,登入過的本人再同步到伺服器 → GitHub 的 data/users/<id>.stats.json(換手機也在,別人也看得到)
// 每個字 {wrong, right, streak, star, t};t = 最後修改時間,兩邊合併時取比較新的
// star = 星號等級 0–3(自己標的,越多顆越不熟;舊版是 true/false,true 當 1 顆),和「不熟」(答錯自動加入)分開
// 看別人的題庫(VIEW):紀錄從 GitHub 讀進來,這次做題的變化只留在記憶體,不保存
const STORE_KEY = 'vocab_stats_' + UID;
const DIRTY_KEY = 'vocab_dirty_' + UID;   // 還沒傳到伺服器
const GRADUATE_STREAK = 3; // 連續答對幾次自動移出不熟清單
let stats = VIEW ? {} : load();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function save() {
  if (VIEW) return;
  localStorage.setItem(STORE_KEY, JSON.stringify(stats));
  localStorage.setItem(DIRTY_KEY, '1');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncStats, 3000);
}
function rec(word) {
  return stats[word] || (stats[word] = { wrong: 0, right: 0, streak: 0, star: false, t: 0 });
}
function touch(r) { r.t = Date.now(); return r; }
function mergeStats(a, b) {
  const out = { ...a };
  for (const [w, r] of Object.entries(b || {})) if (!out[w] || (r.t || 0) > (out[w].t || 0)) out[w] = r;
  return out;
}
// 本人(有登入憑證)才同步;伺服器沒開就留著,下次再傳
let syncTimer = null, syncSrv = null, syncTried = 0;
async function syncStats() {
  if (VIEW || !authOf().token || !localStorage.getItem(DIRTY_KEY)) return;
  if (!syncSrv) {
    if (Date.now() - syncTried < 60000) return;
    syncTried = Date.now();
    syncSrv = await findServer();
    if (!syncSrv) return;
  }
  try {
    const sent = JSON.stringify(stats);
    const r = await fetch(syncSrv.url + '/api/stats', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': UID, 'X-Token': authOf().token },
      body: JSON.stringify({ stats }),
    });
    if (!r.ok) { if (r.status === 401) setAuth(UID, { name: authOf().name }); return; }
    const merged = await r.json();
    if (JSON.stringify(stats) === sent) localStorage.removeItem(DIRTY_KEY);   // 傳的時候沒有新變化
    stats = mergeStats(stats, merged);
    localStorage.setItem(STORE_KEY, JSON.stringify(stats));
  } catch { syncSrv = null; }
}
// 打開網頁時:讀 GitHub 上的紀錄,和這支手機的合併
async function loadCloudStats() {
  try {
    const r = await fetch(`data/users/${BANK_UID}.stats.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404 && !VIEW && Object.keys(stats).length) localStorage.setItem(DIRTY_KEY, '1');   // 雲端還沒有:把這支手機的傳上去
    if (!r.ok) return;
    const cloud = await r.json();
    const before = JSON.stringify(stats);
    stats = mergeStats(stats, cloud);
    if (!VIEW) {
      localStorage.setItem(STORE_KEY, JSON.stringify(stats));
      if (Object.entries(stats).some(([w, x]) => !cloud[w] || (x.t || 0) > (cloud[w].t || 0))) localStorage.setItem(DIRTY_KEY, '1');
    }
    if (JSON.stringify(stats) !== before) refreshHome();
  } catch {}
}
const STAR_MAX = 3;
function isWeak(word) {
  const r = stats[word];
  return !!r && r.wrong > 0 && r.streak < GRADUATE_STREAK;
}
function starOf(word) {
  const s = stats[word] && stats[word].star;
  return s === true ? 1 : Math.max(0, Math.min(STAR_MAX, +s || 0));
}
function starText(n) { return n ? '★'.repeat(n) : '☆'; }
function cycleStar(word) {   // ☆ → ★ → ★★ → ★★★ → ☆
  const r = touch(rec(word));
  r.star = (starOf(word) + 1) % (STAR_MAX + 1);
  save();
}
function record(word, correct) {
  const r = touch(rec(word));
  if (correct) {
    r.right++; r.streak++;
  } else {
    r.wrong++; r.streak = 0;
  }
  save();
}
function weakWords() {
  return WORDS.filter(w => isWeak(w.word))
    .sort((a, b) => rec(b.word).wrong - rec(a.word).wrong);
}
// levels:要哪幾級(空 = 全部星號);星星多的排前面
function starWords(levels) {
  return WORDS.filter(w => { const s = starOf(w.word); return s && (!levels || !levels.length || levels.includes(s)); })
    .sort((a, b) => starOf(b.word) - starOf(a.word));
}
// src:'all' 全部、'weak' 不熟、'star' 星號
function srcWords(src, levels) { return src === 'weak' ? weakWords() : src === 'star' ? starWords(levels) : WORDS; }

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
// 不熟、星號的單字權重較高,比較容易被抽到
function weightedPick(list, n) {
  return list
    .map(w => {
      const weight = 1 + (isWeak(w.word) ? 2 + rec(w.word).wrong : 0) + 2 * starOf(w.word);
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

// 答對/答錯音效:用 Web Audio 直接產生,不用音檔
let audioCtx = null;
function beep(ok) {
  if (settings.sound === 'off') return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const notes = ok ? [[880, 0, 0.12], [1320, 0.1, 0.22]] : [[196, 0, 0.32]];   // 叮咚 / 嗡
    for (const [freq, start, len] of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = ok ? 'sine' : 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(ok ? 0.35 : 0.12, t + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + len);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + start);
      o.stop(t + start + len + 0.02);
    }
  } catch {}
}

function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- 首頁 ----------
// 範圍 = src('all' 全部、'weak' 不熟、'star' 星號)+ levels(星號要哪幾級)+ groups(哪幾組課本頁,空 = 全部頁)。設定記在 localStorage,下次打開一樣
const HOME_KEY = 'vocab_home_' + (UID || 'guest');
const settings = Object.assign({ mode: 'meaning', src: 'all', groups: [], levels: [], count: 'all', sound: 'on' },
  (() => { try { return JSON.parse(localStorage.getItem(HOME_KEY)) || {}; } catch { return {}; } })());
function saveSettings() { localStorage.setItem(HOME_KEY, JSON.stringify(settings)); }
if (settings.groupV !== 2) {   // 以前的「第 n 頁」是每 40 個字一頁,編號意思不同了 → 重設
  if (Array.isArray(settings.scope)) settings.scope = 'all';
  localStorage.removeItem(BROWSE_KEY_OF(UID));
  settings.groupV = 2;
  saveSettings();
}
if ('scope' in settings) {   // 以前是 scope:'all'/'weak'/[組]
  if (settings.scope === 'weak') settings.src = 'weak';
  else if (Array.isArray(settings.scope)) settings.groups = settings.scope;
  delete settings.scope;
  saveSettings();
}
settings.mode = settings.mode === 'pos' || settings.mode === 'both' ? 'both' : 'meaning';   // 一定考中文意思,只選要不要加考詞性(以前的「只考詞性」改成意思+詞性)
function renderAddPos() {
  $('btn-addpos').classList.toggle('on', settings.mode === 'both');
  $('btn-multi').classList.toggle('on', settings.multi !== 'off');
}
$('btn-multi').onclick = () => {   // 多義複選:一個字有好幾個意思時一次全選;不勾 → 隨機考其中一個(單選)
  settings.multi = settings.multi === 'off' ? 'on' : 'off';
  saveSettings();
  renderAddPos();
};
$('btn-addpos').onclick = () => {
  settings.mode = settings.mode === 'both' ? 'meaning' : 'both';
  saveSettings();
  renderAddPos();
};
renderAddPos();

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
  return inGroups(srcWords(settings.src, settings.levels), settings.groups);
}

const SRC_LABEL = { all: '全部單字', weak: '不熟', star: '星號' };
// 來源、星號等級、課本頁數三排按鈕(首頁和複習單字共用);sel = {src, levels, groups},onchange 之後重畫
function renderFilter(prefix, sel, onchange, multiGroups) {
  const srcBox = $(prefix + '-src');
  srcBox.innerHTML = '';
  for (const k of ['all', 'weak', 'star'])
    srcBox.appendChild(chip(SRC_LABEL[k], `${srcWords(k).length} 字`, sel.src === k, () => { sel.src = k; onchange(); }));

  $(prefix + '-level-box').classList.toggle('hidden', sel.src !== 'star');
  const lvBox = $(prefix + '-levels');
  lvBox.innerHTML = '';
  if (sel.src === 'star') for (let lv = 1; lv <= STAR_MAX; lv++) {
    const on = sel.levels.includes(lv);
    lvBox.appendChild(chip(starText(lv), `${starWords([lv]).length} 字`, on, () => {
      sel.levels = on ? sel.levels.filter(x => x !== lv) : [...sel.levels, lv].sort();
      onchange();
    }));
  }

  const base = srcWords(sel.src, sel.levels);
  const box = $(prefix + '-chips');
  box.innerHTML = '';
  if (sel.src !== 'all' || multiGroups)
    box.appendChild(chip('全部頁', `${base.length} 字`, !sel.groups.length, () => { sel.groups = []; onchange(); }));
  GROUPS.forEach(g => {
    const cnt = inGroups(base, [g.n]).length, on = sel.groups.includes(g.n);
    if (!cnt && !on && sel.src !== 'all') return;   // 不熟/星號:這組沒有字就不顯示
    box.appendChild(chip(bookPages(g), `${cnt} 字`, on, () => {
      sel.groups = !multiGroups ? [g.n] : on ? sel.groups.filter(n => n !== g.n) : [...sel.groups, g.n].sort((a, b) => a - b);
      onchange();
    }));
  });
}

function renderScopeChips() {
  settings.groups = (settings.groups || []).filter(n => groupOf(n));   // 題庫變動後,不存在的組拿掉
  settings.levels = settings.levels || [];
  renderFilter('scope', settings, () => { saveSettings(); renderScopeChips(); $('home-msg').textContent = ''; }, true);
  $('scope-info').textContent = `考${filterDesc(settings)},共 ${scopePool().length} 個字`;
}
function filterDesc(sel) {
  const where = sel.groups.length ? sel.groups.map(n => bookPages(groupOf(n))).join('、') + ' ' : '';
  const what = sel.src === 'weak' ? '的不熟單字'
    : sel.src === 'star' ? `的${sel.levels.length ? ' ' + sel.levels.map(starText).join('、') + ' ' : ''}星號單字`
    : where ? '' : '全部';
  return (where + what).replace(/^的/, '').trim();
}

function refreshHome() {
  $('stat-total').textContent = WORDS.length;
  $('stat-weak').textContent = weakWords().length;
  $('stat-star').textContent = starWords().length;
  $('home-msg').textContent = '';
  renderScopeChips();
}

$('btn-start').onclick = () => {
  const pool = scopePool();
  if (!pool.length) {
    $('home-msg').textContent = !WORDS.length ? '還沒有單字,先按下面「新增課本頁」上傳課本照片'
      : settings.src === 'weak' && !weakWords().length ? '目前沒有不熟的單字 👍'
      : settings.src === 'star' && !starWords().length ? '還沒有星號單字(做題時點右上角 ☆,或在「複習單字」裡點)' : '這個範圍沒有單字';
    return;
  }
  const n = settings.count === 'all' ? pool.length : Math.min(+settings.count, pool.length);
  startQuiz(weightedPick(pool, n), settings.mode);
};
$('btn-browse').onclick = () => openBrowse();
$('stat-weak-box').onclick = () => openBrowse('weak');
$('stat-star-box').onclick = () => openBrowse('star');

// ---------- 測驗 ----------
let quiz = null;

let autoNext = null;   // 答對後自動下一題的計時器
function startQuiz(list, mode) {
  clearTimeout(autoNext);
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
  quiz.posAnswer = q.pos;
  const many = quiz.answers.length > 1;
  if (many && settings.multi === 'off') {   // 多義不複選:隨機考其中一個意思(單選),詞性也只考這個意思的
    const s = q.senses[Math.floor(Math.random() * q.senses.length)];
    quiz.answers = [senseLabel(s)];
    quiz.posAnswer = [s.pos];
  }
  const multi = quiz.answers.length > 1;
  $('word-sub').textContent = {
    meaning: multi ? '複選題:選出所有正確的意思' : '',
    pos: '選出所有正確的詞性(可複選)',
    both: multi ? '選出所有中文意思(複選),並選出所有詞性' : many ? '選中文意思,並選出這個意思的詞性' : '選中文意思,並選出所有詞性',
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
    if (!zhs.has(s.zh) && !opts.some(o => o.label === label)) opts.push({ label, ok: false, word: d.word });
  }
  const wrap = document.createElement('div');
  wrap.className = 'opt-col meaning-opts' + (quiz.mode === 'both' ? ' two-col' : '');   // 合併模式選項短,排兩欄才放得下詞性
  shuffle(opts).forEach(o => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = o.label;
    b.dataset.ok = o.ok ? '1' : '';
    b.dataset.word = o.word || '';
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
    else if (sel && !right) {   // 選錯的是別的單字的意思:旁邊標出是哪個字
      b.classList.add('wrong');
      if (b.dataset.word) b.insertAdjacentHTML('beforeend', `<span class="from">→ ${esc(b.dataset.word)}</span>`);
    }
    else if (right) b.classList.add('missed');
  });
}
function markPos(q, reveal) {
  const answer = new Set(quiz.posAnswer);
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

  const answer = new Set(quiz.posAnswer);
  const meaningOk = !needMeaning || (quiz.picked.size === quiz.answers.length && quiz.answers.every(a => quiz.picked.has(a)));
  const posOk = !needPos || (answer.size === quiz.selected.size && [...answer].every(p => quiz.selected.has(p)));
  if (needMeaning) markMeaning(q, false);
  if (needPos) markPos(q, false);

  let msg = '';
  if (quiz.mode === 'both' && meaningOk !== posOk) msg = meaningOk ? '(意思對,詞性錯)' : '(詞性對,意思錯)';
  if (needPos && !posOk) {   // 說清楚詞性錯在哪:紅色是「你選了但不對」,不是答案
    const extra = [...quiz.selected].filter(p => !answer.has(p)).map(p => POS_LABEL[p]);
    const miss = [...answer].filter(p => !quiz.selected.has(p)).map(p => POS_LABEL[p]);
    msg += `<div class="pos-why">正確詞性:${[...answer].map(p => POS_LABEL[p]).join(' ')}` +
      (extra.length ? `;多選了 ${extra.join(' ')}` : '') + (miss.length ? `;少選了 ${miss.join(' ')}` : '') + '</div>';
  }
  finishAnswer(meaningOk && posOk, msg);
}
function warn(text) { $('feedback').innerHTML = `<span class="ng">${text}</span>`; }

function finishAnswer(ok, msg = '', hinted = false) {
  const q = quiz.list[quiz.i];
  record(q.word, ok);
  if (ok) quiz.correct++;
  else quiz.wrongs.push(q);
  updateStar();
  if (!hinted) beep(ok);
  if (ok && !hinted) {   // 答對:短暫顯示 ✔ 就自動下一題,不顯示例句
    $('feedback').innerHTML = '<span class="ok">✔ 答對了</span>';
    $('btn-action').classList.add('hidden');
    const cur = quiz;
    autoNext = setTimeout(() => { if (quiz === cur && $('quiz').classList.contains('active')) next(); }, 700);
    return;
  }
  const head = hinted
    ? '<span class="hint-tag">正確答案(看提示算答錯,已加入不熟單字)</span>'
    : ok ? '<span class="ok">✔ 答對了</span>' : `<span class="ng">✘ 答錯了${msg}</span>`;
  // 簡單解答一行;例句放在「詳解」裡,按了才展開(下一題按鈕才不會被擠到下面)
  const brief = q.senses.map(s => `<span class="pos">${POS_LABEL[s.pos]}</span> ${esc(s.zh)}`).join('<span class="sep">;</span>');
  $('feedback').innerHTML = head + `<div class="answer">${esc(q.word)} <span class="brief">${brief}</span></div>` +
    `<button class="link-btn detail-btn">看詳解(例句)▾</button><div class="detail hidden">${sensesHtml(q)}</div>`;
  $('feedback').querySelector('.detail-btn').onclick = e => {
    const d = $('feedback').querySelector('.detail');
    d.classList.toggle('hidden');
    e.target.textContent = d.classList.contains('hidden') ? '看詳解(例句)▾' : '收起詳解▴';
  };
  requestAnimationFrame(() => $('feedback').scrollIntoView({ block: 'end', behavior: 'smooth' }));   // 解答捲到下一題按鈕上面
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
  const n = starOf(q.word);
  $('btn-star').textContent = starText(n);
  $('btn-star').classList.toggle('many', n > 1);
}
$('btn-star').onclick = () => { cycleStar(quiz.list[quiz.i].word); updateStar(); };

$('btn-end').onclick = () => {
  clearTimeout(autoNext);
  if (quiz.i === 0 && !quiz.answered) { refreshHome(); show('home'); return; }
  // 已作答的題目才算進結果
  quiz.list = quiz.list.slice(0, quiz.i + (quiz.answered ? 1 : 0));
  showResult();
};
$('btn-back').onclick = () => { clearTimeout(autoNext); refreshHome(); show('home'); };

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

// ---------- 複習單字(全部 / 不熟 / 星號,再按課本頁數分組) ----------
const BROWSE_KEY = BROWSE_KEY_OF(UID);
const browse = (() => {   // {src, levels, groups:[一組] 或 [](全部頁)};以前存的是 '1'、'2'… 或 'weak'
  const v = localStorage.getItem(BROWSE_KEY) || '';
  try { const o = JSON.parse(v); if (o && o.src) return { src: o.src, levels: o.levels || [], groups: o.groups || [] }; } catch {}
  return v === 'weak' ? { src: 'weak', levels: [], groups: [] } : { src: 'all', levels: [], groups: v ? [+v] : [] };
})();

function openBrowse(src) {
  if (src && src !== browse.src) Object.assign(browse, { src, levels: [], groups: [] });
  renderBrowse();
  show('browse');
}

function exRow(ex) {
  return `<div class="ex">${sayEx(ex)}<div><div class="en">${esc(ex.en)}</div><div class="zh">${esc(ex.zh)}</div></div></div>`;
}

const BROWSE_INFO = {
  all: '點 ☆ 可以加星號,多點幾下變 ★★、★★★(越多顆越不熟),再點一下就拿掉。',
  weak: '答錯會自動加入;同一個單字連續答對 3 次會自動移出。點 ✕ 可以手動移除。',
  star: '自己標的星號,不會自動移出。點星星可以改等級:★ → ★★ → ★★★ → 拿掉。上面可以只看某幾級。',
};

function renderBrowse() {
  browse.groups = browse.groups.filter(n => groupOf(n));
  if (browse.src === 'all' && !browse.groups.length && GROUPS.length) browse.groups = [GROUPS[0].n];   // 全部單字一次看一組
  localStorage.setItem(BROWSE_KEY, JSON.stringify(browse));
  renderFilter('browse', browse, renderBrowse, false);

  const list = inGroups(srcWords(browse.src, browse.levels), browse.groups);
  $('browse-info').textContent = (browse.src === 'all' ? `課本 ${filterDesc(browse)}:${list.length} 個字。` : `${filterDesc(browse)}:${list.length} 個字。`) + BROWSE_INFO[browse.src];
  $('btn-reset').classList.toggle('hidden', browse.src === 'all');
  $('browse-quiz').classList.toggle('hidden', !list.length);
  $('browse-quiz').textContent = `考這些單字(${list.length})`;

  const ul = $('browse-list');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${!WORDS.length ? '還沒有單字,先上傳課本照片'
      : browse.src === 'weak' ? '目前沒有不熟的單字 👍' : browse.src === 'star' ? '這裡還沒有星號單字' : '沒有單字'}</li>`;
    return;
  }
  list.forEach(w => {
    const li = document.createElement('li');
    const st = starOf(w.word), wrong = rec(w.word).wrong;
    li.innerHTML =
      `<div class="row">` + sayWord(w.word) +
      `<span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning)}</span>` +
      (browse.src === 'weak' ? `<span class="n">錯 ${wrong}</span>` : '') +
      `<button class="x st${st ? ' on' : ''}${st > 1 ? ' many' : ''}" aria-label="星號">${starText(st)}</button>` +
      (browse.src === 'weak' ? `<button class="x rm" aria-label="移出不熟">✕</button>` : '') +
      `</div>` +
      (w.senses.length > 1 || w.senses.some(s => s.ex.length > 1)
        ? w.senses.map(s => `<div class="sense"><span class="pos">${POS_LABEL[s.pos]}</span> ${esc(s.zh)}</div>` + s.ex.map(exRow).join('')).join('')
        : w.senses[0].ex.map(exRow).join(''));
    li.querySelector('.st').onclick = () => { cycleStar(w.word); renderBrowse(); };
    const rm = li.querySelector('.rm');
    if (rm) rm.onclick = () => { touch(rec(w.word)).streak = GRADUATE_STREAK; save(); renderBrowse(); };
    ul.appendChild(li);
  });
}
$('browse-quiz').onclick = () => startQuiz(inGroups(srcWords(browse.src, browse.levels), browse.groups), settings.mode);
document.querySelectorAll('.btn-to-home').forEach(b => b.onclick = () => { refreshHome(); show('home'); });
$('btn-reset').onclick = () => {
  if (!confirm('確定要清除所有練習紀錄嗎?')) return;
  for (const w of Object.keys(stats)) stats[w] = { wrong: 0, right: 0, streak: 0, star: false, t: Date.now() };   // 清成 0(不刪,別的手機才會跟著清)
  save();
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
  say('連線中…');
  const srv = await findServer();
  if (!srv) { say('伺服器目前沒有開,請稍後再試。'); return; }
  try {
    const r = await fetch(srv.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { say(d.detail || `伺服器錯誤(${r.status})`); return; }
    setAuth(d.id, { name: d.name, token: d.token });
    localStorage.setItem(USER_KEY, d.id);
    if (path === '/api/register') localStorage.setItem('vocab_new_' + d.id, '1');
    location.replace(location.pathname + '?u=' + d.id);
  } catch { say('連不到伺服器,請稍後再試。'); }
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
// ---------- 看別人的題庫 ----------
async function openPeople() {
  show('people');
  const ul = $('people-list');
  ul.innerHTML = '<li class="empty">載入中…</li>';
  try {
    const list = await (await fetch('data/users/index.json?t=' + Date.now(), { cache: 'no-store' })).json();
    ul.innerHTML = '';
    for (const u of list) {
      const li = document.createElement('li');
      const me = u.id === UID;
      li.innerHTML = `<button class="person">${esc(u.name)}${me ? ' <span class="msg small">(我)</span>' : ''}</button>`;
      li.querySelector('button').onclick = () => location.href = location.pathname + (me ? '' : '?view=' + u.id);
      ul.appendChild(li);
    }
  } catch { ul.innerHTML = '<li class="empty">載入失敗,請檢查網路</li>'; }
}
$('btn-people').onclick = openPeople;
$('wl-people').onclick = openPeople;
$('people-back').onclick = () => { if (BANK_UID) { refreshHome(); show('home'); } else show('welcome'); };
$('btn-view-back').onclick = () => location.replace(location.pathname);

function myUrl() { return location.origin + location.pathname + '?u=' + UID; }
$('btn-myurl').onclick = async () => {
  try { await navigator.clipboard.writeText(myUrl()); $('btn-myurl').textContent = '已複製 ✓'; }
  catch { prompt('我的專屬網址:', myUrl()); }
};

async function init() {
  $('btn-say').innerHTML = SPEAKER_SVG;
  if (!BANK_UID) { showWelcome(); return; }
  show('home');
  let bank;
  try {
    const res = await fetch(`data/users/${BANK_UID}.json`, { cache: 'no-cache' });
    if (res.status === 404 && VIEW) { location.replace(location.pathname); return; }
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
  document.body.classList.toggle('viewing', !!VIEW);
  if (VIEW) {
    $('view-name').textContent = bank.name;
    $('btn-view-back').textContent = UID ? '回到我的題庫' : '登入 / 建立我的題庫';
  }
  refreshHome();
  loadCloudStats().then(syncStats);
  if (VIEW) return;
  if (!authOf().token && Object.keys(stats).length) {   // 沒登入過:紀錄只在這支手機
    $('home-note').textContent = '目前不熟單字只存在這支手機。到「新增課本頁」登入一次,之後就會自動存到雲端,換手機也看得到。';
    $('home-note').classList.remove('hidden');
  }
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

// 自動更新:網頁有新版(index.html 的 app-version 變了)就重新載入,不用手動清暫存
async function checkUpdate() {
  try {
    const html = await (await fetch(location.pathname + '?check=' + Date.now(), { cache: 'no-store' })).text();
    const m = html.match(/name="app-version" content="([^"]+)"/);
    const cur = document.querySelector('meta[name=app-version]')?.content;
    if (!m || m[1] === cur) return;
    if (['quiz', 'review', 'upload'].some(id => $(id)?.classList.contains('active'))) return;   // 做題或上傳中先不打斷
    if (sessionStorage.getItem('vocab_reloaded') === m[1]) return;   // 避免一直重新載入
    sessionStorage.setItem('vocab_reloaded', m[1]);
    const q = new URLSearchParams(location.search);
    q.set('_v', m[1]);   // 換網址才不會又拿到暫存的舊網頁
    location.replace(location.pathname + '?' + q);
  } catch {}
}
if (params.has('_v')) { params.delete('_v'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '')); }
$('app-ver').textContent = (document.querySelector('meta[name=app-version]')?.content || '').replace(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d).*/, '$2/$3 $4:$5');
setTimeout(checkUpdate, 1500);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
