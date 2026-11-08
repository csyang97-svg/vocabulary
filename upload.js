'use strict';
// ---------- 上傳課本照片 → 確認 → 加入題庫 ----------
// 伺服器在家裡電腦(turn_on_vocab_server.bat),網址每次啟動都會變,寫在 repo 的 server.json。
// 用 GitHub API 讀 server.json(GitHub Pages 有快取,剛換的網址要等好幾分鐘)。
const SERVER_JSON_API = 'https://api.github.com/repos/csyang97-svg/vocabulary/contents/server.json';
const JOB_KEY = 'vocab_upload_job_' + UID;   // 登入憑證見 app.js 的 authOf()
const MAX_SIDE = 2400;               // 上傳前在手機上縮小,長邊最多 2400px
const REVIEW_POS = ['n', 'v', 'adj', 'adv', 'prep', 'conj'];

let server = null, maxFiles = 10, picked = [], pollTimer = null, reviewJob = null;

async function findServer() {
  // 測試用:在本機開網頁時可以用 ?server=http://localhost:8300 指定伺服器(公開網址上不接受,避免密碼被騙走)
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  let url = local ? new URLSearchParams(location.search).get('server') : null;
  if (!url) try {
    const r = await fetch(SERVER_JSON_API, { cache: 'no-store' });
    if (r.ok) url = JSON.parse(atob((await r.json()).content.replace(/\s/g, ''))).url;
  } catch {}
  if (!url) {
    try { url = (await (await fetch('server.json', { cache: 'no-store' })).json()).url; } catch {}
  }
  if (!url) return null;
  try {
    const r = await fetch(url + '/api/ping', { cache: 'no-store' });
    const d = await r.json();
    if (!d.ok) return null;
    maxFiles = d.max_files || 10;
    return { url, strata: d.strata };
  } catch { return null; }
}

async function api(path, opts = {}) {
  const r = await fetch(server.url + path, {
    ...opts,
    headers: { ...(opts.headers || {}), 'X-User': UID || '', 'X-Token': authOf().token || '' },
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) {
    const err = new Error(d.detail || `伺服器錯誤(${r.status})`);
    err.status = r.status;
    throw err;
  }
  return d;
}

function upMsg(text, err = false) {
  $('up-msg').textContent = text;
  $('up-msg').classList.toggle('err', err);
  $('up-msg').classList.toggle('hidden', !text);
}
function upShow(part) {
  ['up-login', 'up-form', 'up-progress'].forEach(id => $(id).classList.toggle('hidden', id !== part));
  $('up-resume').classList.toggle('hidden', part !== 'up-form' || addTab !== 'photo' || !localStorage.getItem(JOB_KEY));
}

// ---------- 加入新單字:「從照片」或「手動輸入」 ----------
const TAB_KEY = 'vocab_add_tab';
let addTab = localStorage.getItem(TAB_KEY) || 'photo';
function setAddTab(t) {
  addTab = t;
  localStorage.setItem(TAB_KEY, t);
  document.querySelectorAll('#add-tabs .chip').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('up-photo').classList.toggle('hidden', t !== 'photo');
  $('up-manual').classList.toggle('hidden', t !== 'manual');
  upShow('up-form');
  if (t === 'manual' && !$('mn-senses').children.length) resetManual();
}
document.querySelectorAll('#add-tabs .chip').forEach(b => b.onclick = () => setAddTab(b.dataset.tab));

// 手動輸入:單字、頁碼、每個意思(詞性、中文意思、英文例句、例句翻譯)
function senseBox(s = {}) {
  const d = document.createElement('div');
  d.className = 'mn-sense';
  d.innerHTML = `<div class="mn-head"><span class="mn-n"></span><button class="x" aria-label="刪除這個意思">✕</button></div>
    <div class="mn-row"><select class="txt mn-pos"><option value="">詞性</option>${['n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron'].map(p => `<option value="${p}">${p}.</option>`).join('')}</select>
    <input class="txt mn-zh" placeholder="中文意思"></div>
    <textarea class="txt mn-en" rows="2" autocapitalize="sentences" spellcheck="false" placeholder="英文例句"></textarea>
    <textarea class="txt mn-tw" rows="2" placeholder="例句的中文翻譯"></textarea>`;
  d.querySelector('.mn-pos').value = s.pos || '';
  d.querySelector('.mn-zh').value = s.zh || '';
  d.querySelector('.mn-en').value = s.en || '';
  d.querySelector('.mn-tw').value = s.tw || '';
  d.querySelector('.x').onclick = () => { d.remove(); if (!$('mn-senses').children.length) $('mn-senses').appendChild(senseBox()); numberSenses(); };
  return d;
}
function numberSenses() {
  const all = [...$('mn-senses').children];
  all.forEach((d, i) => { d.querySelector('.mn-n').textContent = all.length > 1 ? `意思 ${i + 1}` : '意思'; });
}
function setSenses(list) {
  $('mn-senses').innerHTML = '';
  (list.length ? list : [{}]).forEach(s => $('mn-senses').appendChild(senseBox(s)));
  numberSenses();
}
function readSenses() {
  return [...$('mn-senses').children].map(d => ({
    pos: d.querySelector('.mn-pos').value, zh: d.querySelector('.mn-zh').value.trim(),
    en: d.querySelector('.mn-en').value.trim(), tw: d.querySelector('.mn-tw').value.trim(),
  }));
}
function resetManual() {
  $('mn-word').value = ''; $('mn-page').value = '';
  setSenses([]);
  $('mn-notes').classList.add('hidden');
  $('mn-msg').textContent = '';
  guessPageHint();
}
$('mn-more').onclick = () => { $('mn-senses').appendChild(senseBox()); numberSenses(); };

// 課本單字是照字母排的:用題庫裡前後兩個字的頁碼猜
// 只在前後都有字時猜(比題庫第一個字前面、最後一個字後面的就猜不出來,要自己填)
function guessPage(word) {
  if (BY_WORD[word]) return BY_WORD[word].page;
  const list = WORDS.slice().sort((a, b) => a.word.localeCompare(b.word));
  const next = list.find(w => w.word.localeCompare(word) > 0);
  const prev = [...list].reverse().find(w => w.word.localeCompare(word) < 0);
  return word && prev && next ? prev.page : null;
}
function guessPageHint() {
  const w = $('mn-word').value.trim().toLowerCase();
  const g = guessPage(w);
  $('mn-page').placeholder = !w ? '可不填,會照字母順序猜' : g ? `可不填,照字母順序猜是 p.${g}` : '這個字要自己填頁碼';
}
$('mn-word').oninput = guessPageHint;

$('mn-auto').onclick = async () => {
  const word = $('mn-word').value.trim();
  if (!word) { $('mn-msg').textContent = '請先輸入單字'; $('mn-word').focus(); return; }
  const btn = $('mn-auto');
  btn.disabled = true; btn.textContent = '產生中(約 10–30 秒)…';
  $('mn-msg').textContent = '';
  try {
    const d = await api('/api/autofill', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, senses: readSenses().filter(s => s.pos || s.zh || s.en || s.tw) }),
    });
    $('mn-word').value = d.word;
    setSenses(d.senses);
    guessPageHint();
    const have = BY_WORD[d.word];
    const notes = [...d.notes];
    if (have) notes.push(`題庫裡已經有 ${d.word}(p.${have.page}):加入時只會補上新的意思和例句。`);
    $('mn-notes').innerHTML = notes.length ? '<b>已自動改正:</b><ul>' + notes.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>' : '已補上空白的欄位,沒有發現錯誤。';
    $('mn-notes').classList.remove('hidden');
  } catch (e) {
    $('mn-msg').textContent = e.message || '自動產生失敗';
  } finally {
    btn.disabled = false; btn.textContent = '✨ 自動產生';
  }
};

$('mn-add').onclick = async () => {
  const say = t => { $('mn-msg').textContent = t; };
  const word = $('mn-word').value.trim().toLowerCase();
  if (!/^[a-z][a-z\- ]*$/.test(word)) { say('請輸入英文單字'); return; }
  let page = parseInt($('mn-page').value, 10);
  if (!$('mn-page').value.trim()) page = guessPage(word);
  if (!(page >= 1 && page <= 999)) { say('請填課本頁碼(這個字在題庫所有單字的最前面或最後面,猜不出頁碼)'); $('mn-page').focus(); return; }
  const raw = readSenses();
  if (raw.some(s => (s.zh || s.en) && !s.pos)) { say('每個意思都要選詞性(或按「自動產生」)'); return; }
  const senses = raw.filter(s => s.pos && s.zh).map(s => ({ pos: s.pos, zh: s.zh, ex: s.en ? [{ en: s.en, zh: s.tw }] : [] }));
  if (!senses.length) { say('至少要有一個詞性和中文意思(或按「自動產生」)'); return; }
  const btn = $('mn-add');
  btn.disabled = true; btn.textContent = '加入中(產生語音)…';
  say('');
  try {
    const entry = { word, page, senses };
    const d = await api('/api/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual: true, words: [entry] }),
    });
    if (d.skipped.length) { say(`題庫裡已經有 ${word},而且沒有新的意思或例句。`); return; }
    addLocal(entry);
    resetManual();
    say(d.added.length ? `已加入 ${word}(p.${page})!可以繼續輸入下一個字。` : `已補充 ${word} 的意思/例句。`);
  } catch (e) {
    say(e.message || '加入失敗');
  } finally {
    btn.disabled = false; btn.textContent = '加入題庫';
  }
};
// 同一個意思(例如「敏銳」和「敏銳的,熱切的」),和伺服器的 zh_overlap 一樣
function zhSet(zh) { return new Set(zh.split(/[,,、;;\/]/).map(t => t.trim().replace(/的$/, '')).filter(Boolean)); }
function zhOverlap(a, b) { const A = zhSet(a); return [...zhSet(b)].some(t => A.has(t)); }
// 先放進這支手機的題庫,馬上可以練習(網站約 1–2 分鐘後更新)
function addLocal(e) {
  const raw = WORDS.map(w => ({ word: w.word, page: w.page, senses: w.senses.map(s => ({ ...s, ex: [...s.ex] })) }));
  const old = raw.find(w => w.word === e.word);
  if (!old) raw.push(e);
  else for (const s of e.senses) {
    const same = old.senses.find(o => o.pos === s.pos && zhOverlap(o.zh, s.zh));
    if (!same) old.senses.push(s);
    else for (const x of s.ex) if (!same.ex.some(y => y.en === x.en)) same.ex.push(x);
  }
  setWords(raw);
}

$('btn-upload').onclick = openUpload;
async function openUpload() {
  show('upload');
  upShow(null);
  upMsg('連線中…');
  server = await findServer();
  if (!server) {
    upMsg('伺服器目前沒有開,請稍後再試。', true);
    return;
  }
  if (!authOf().token) { upMsg(''); showUpLogin(); return; }
  try { await api('/api/me'); }
  catch (e) {
    if (e.status === 401) { setAuth(UID, { name: authOf().name }); upMsg('請重新登入', true); showUpLogin(); return; }
    upMsg(e.message, true); return;
  }
  // 這支手機沒記錄的上傳(別支手機傳的、或家裡重新辨識的)也找得到
  if (!localStorage.getItem(JOB_KEY)) {
    try { const js = await api('/api/jobs'); if (js.length) localStorage.setItem(JOB_KEY, js[0].id); } catch {}
  }
  const jid = localStorage.getItem(JOB_KEY);
  if (jid) {
    try {
      const job = await api('/api/job/' + jid);
      if (job.status === 'queued' || job.status === 'running') { upMsg(''); watchJob(jid); return; }
    } catch { localStorage.removeItem(JOB_KEY); }
  }
  upMsg(server.strata ? '' : '⚠ 伺服器的辨識模型目前沒開,上傳後會等它開好才處理。', !server.strata);
  resetForm();
  setAddTab(addTab);
}

// 上傳要登入(暱稱 + 密碼),而且只能上傳到自己的題庫
function showUpLogin() {
  $('up-name').value = authOf().name || $('who').textContent || '';
  upShow('up-login');
}
$('up-pw-ok').onclick = async () => {
  const name = $('up-name').value.trim(), password = $('up-pw').value;
  if (!name || !password) return;
  try {
    const r = await fetch(server.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { upMsg(d.detail || '登入失敗', true); return; }
    if (d.id !== UID) { upMsg(`這是「${$('who').textContent}」的題庫,只能用這個暱稱登入上傳。要用自己的題庫請按首頁右上角「切換」。`, true); return; }
    setAuth(UID, { name: d.name, token: d.token });
    $('up-pw').value = '';
    openUpload();
  } catch { upMsg('連不到伺服器', true); }
};

function resetForm() {
  picked = [];
  $('up-files').value = '';
  $('up-thumbs').innerHTML = '';
  $('up-max').textContent = maxFiles;
  $('up-go').classList.add('hidden');
}
$('up-files').onchange = () => {
  picked = [...$('up-files').files].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (picked.length > maxFiles) {
    upMsg(`一次最多 ${maxFiles} 張,只會上傳前 ${maxFiles} 張`, true);
    picked = picked.slice(0, maxFiles);
  } else upMsg('');
  $('up-thumbs').innerHTML = '';
  picked.forEach(f => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    $('up-thumbs').appendChild(img);
  });
  $('up-go').textContent = `開始辨識(${picked.length} 張)`;
  $('up-go').classList.toggle('hidden', !picked.length);
};

// 用 canvas 縮小並轉成 JPEG(iPhone 的 HEIC 也會變成 JPEG)
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? resolve(b) : reject(new Error('轉檔失敗')), 'image/jpeg', 0.9);
    };
    img.onerror = () => reject(new Error(`${file.name} 無法讀取`));
    img.src = URL.createObjectURL(file);
  });
}

$('up-go').onclick = async () => {
  $('up-go').disabled = true;
  try {
    upMsg('準備照片…');
    const fd = new FormData();
    for (let i = 0; i < picked.length; i++) fd.append('files', await shrink(picked[i]), `${i + 1}.jpg`);
    upMsg('上傳中…');
    const d = await api('/api/upload', { method: 'POST', body: fd });
    localStorage.setItem(JOB_KEY, d.job);
    upMsg('');
    watchJob(d.job);
  } catch (e) {
    upMsg(e.message || '上傳失敗', true);
  } finally {
    $('up-go').disabled = false;
  }
};

function watchJob(jid) {
  upShow('up-progress');
  clearTimeout(pollTimer);
  const tick = async () => {
    if (!$('upload').classList.contains('active')) return;   // 離開畫面就不再輪詢
    let job;
    try { job = await api('/api/job/' + jid); }
    catch (e) { $('up-state').textContent = '連不到伺服器,稍後重試…'; pollTimer = setTimeout(tick, 8000); return; }
    $('up-bar').style.width = `${Math.round(100 * job.done / job.total)}%`;
    if (job.status === 'queued') {
      $('up-state').textContent = job.ahead ? `排隊中(前面還有 ${job.ahead} 批)` : '排隊中…';
    } else if (job.status === 'running') {
      $('up-state').textContent = job.current ? `辨識中:第 ${job.current} / ${job.total} 張` : '準備中…';
    } else if (job.status === 'error') {
      localStorage.removeItem(JOB_KEY);
      upMsg(job.error || '處理失敗', true);
      resetForm(); upShow('up-form');
      return;
    } else {
      openReview(job);
      return;
    }
    pollTimer = setTimeout(tick, 4000);
  };
  tick();
}

$('up-resume').onclick = async () => {
  try { openReview(await api('/api/job/' + localStorage.getItem(JOB_KEY))); }
  catch (e) { localStorage.removeItem(JOB_KEY); upMsg(e.message, true); upShow('up-form'); }
};

// ---------- 確認畫面 ----------
function openReview(job) {
  reviewJob = job;
  show('review');
  const list = $('rv-list');
  list.innerHTML = '';
  const have = w => w.in_bank || !!BY_WORD[w.word];
  const fresh = (job.words || []).filter(w => !have(w));
  const words = [...fresh, ...(job.words || []).filter(have)];   // 已在題庫的放最後
  let msg = `${job.total} 張照片找到 ${words.length} 個有畫螢光筆的單字`;
  if (words.length > fresh.length) msg += `(${words.length - fresh.length} 個已經在題庫)`;
  msg += '。請檢查拼字、每個意思和例句,⚠ 是不太確定有沒有畫螢光筆的,預設不勾。';
  if (job.photo_errors?.length) msg += ` 第 ${job.photo_errors.join('、')} 張無法辨識。`;
  if (job.committed) msg = `這批已經在 ${new Date(job.committed.time * 1000).toLocaleString()} 加入題庫:${job.committed.words.join(', ')}`;
  $('rv-msg').textContent = msg;
  words.forEach(w => list.appendChild(reviewCard(w)));
  $('rv-commit').classList.toggle('hidden', !!job.committed || !fresh.length);
  updateCommitBtn();
}

// 一個意思(課本上的一列):詞性、中文意思,底下是它的例句
function senseRow(s = { pos: 'n', zh: '', ex: [] }) {
  const row = document.createElement('div');
  row.className = 'rv-sense-box';
  row.innerHTML = `<div class="rv-sense"><select>${REVIEW_POS.map(p => `<option value="${p}"${p === s.pos ? ' selected' : ''}>${POS_LABEL[p]}</option>`).join('')}</select>` +
    `<input class="txt zh" value="${esc(s.zh || '')}" placeholder="中文意思">` +
    `<button class="x" aria-label="刪除這個意思">✕</button></div>` +
    `<div class="rv-exs"></div><button class="rv-add ex-add">+ 例句</button>`;
  const exs = row.querySelector('.rv-exs');
  (s.ex?.length ? s.ex : [{ en: '', zh: '' }]).forEach(ex => exs.appendChild(exRowEdit(ex)));
  row.querySelector('.rv-sense .x').onclick = () => row.remove();
  row.querySelector('.ex-add').onclick = () => exs.appendChild(exRowEdit());
  return row;
}
function exRowEdit(ex = { en: '', zh: '' }) {
  const d = document.createElement('div');
  d.className = 'rv-exrow';
  d.innerHTML = `<textarea class="txt rv-ex en" rows="2" placeholder="英文例句">${esc(ex.en || '')}</textarea>` +
    `<textarea class="txt rv-ex zh" rows="1" placeholder="例句中文">${esc(ex.zh || '')}</textarea>` +
    `<button class="x" aria-label="刪除這個例句">✕</button>`;
  d.querySelector('.x').onclick = () => d.remove();
  return d;
}

function reviewCard(w) {
  const have = w.in_bank || !!BY_WORD[w.word];
  const card = document.createElement('div');
  card.className = 'rv-card';
  if (have) {   // 已在題庫:只顯示一行
    card.classList.add('off');
    card.innerHTML = `<div class="rv-head"><input type="checkbox" class="on" disabled><span class="rv-have">${esc(w.word)}</span><span class="rv-tag have">已在題庫</span></div>`;
    return card;
  }
  card.innerHTML =
    `<div class="rv-head"><input type="checkbox" class="on"${!have && w.sure ? ' checked' : ''}${have ? ' disabled' : ''}>` +
    `<input class="txt word" value="${esc(w.word)}" autocapitalize="off" autocorrect="off" spellcheck="false">` +
    `<input class="txt pg" type="number" inputmode="numeric" value="${w.page ?? ''}" placeholder="頁"></div>` +
    (have ? '<span class="rv-tag have">已在題庫</span>' : '') +
    (!w.sure && !have ? '<span class="rv-tag warn">⚠ 不確定有沒有畫螢光筆</span>' : '') +
    (!w.page ? '<span class="rv-tag warn">⚠ 照片上讀不到頁碼,請在右上角填課本頁碼</span>' : '') +
    `<div class="senses"></div><button class="rv-add sense-add">+ 意思</button>`;
  const box = card.querySelector('.senses');
  if (w.example?.en && w.senses?.length && !w.senses.some(s => s.ex?.length))   // 舊格式:例句放在第一個意思底下
    w.senses[0].ex = [w.example];
  (w.senses?.length ? w.senses : [{ pos: 'n', zh: '', ex: [] }]).forEach(s => box.appendChild(senseRow(s)));
  card.querySelector('.sense-add').onclick = () => box.appendChild(senseRow());
  const pg = card.querySelector('.pg');
  pg.classList.toggle('need', !pg.value);
  pg.oninput = () => pg.classList.toggle('need', !pg.value);
  const cb = card.querySelector('.on');
  const sync = () => { card.classList.toggle('off', !cb.checked); updateCommitBtn(); };
  cb.onchange = sync;
  sync();
  return card;
}

function checkedCards() { return [...document.querySelectorAll('#rv-list .rv-card')].filter(c => c.querySelector('.on').checked); }
function updateCommitBtn() { $('rv-commit').textContent = `加入題庫(${checkedCards().length})`; }

$('rv-back').onclick = () => { show('upload'); upMsg(''); resetForm(); upShow('up-form'); };

$('rv-commit').onclick = async () => {
  const cards = checkedCards();
  if (!cards.length) { alert('沒有勾選任何單字'); return; }
  const words = [];
  for (const c of cards) {
    const word = c.querySelector('.word').value.trim().toLowerCase();
    const page = parseInt(c.querySelector('.pg').value, 10);
    const senses = [...c.querySelectorAll('.rv-sense-box')]
      .map(r => ({
        pos: r.querySelector('select').value,
        zh: r.querySelector('.rv-sense .zh').value.trim(),
        ex: [...r.querySelectorAll('.rv-exrow')]
          .map(e => ({ en: e.querySelector('.en').value.trim(), zh: e.querySelector('textarea.zh').value.trim() }))
          .filter(e => e.en),
      }))
      .filter(s => s.zh);
    if (!/^[a-z][a-z\- ]*$/.test(word)) { alert(`單字「${word}」格式不對`); return; }
    if (!(page >= 1 && page <= 999)) { alert(`「${word}」要填頁碼`); return; }
    if (!senses.length) { alert(`「${word}」至少要有一個中文意思`); return; }
    words.push({ word, page, senses });
  }
  const btn = $('rv-commit');
  btn.disabled = true; btn.textContent = '加入中(產生語音)…';
  try {
    const d = await api('/api/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: reviewJob.id, words }),
    });
    localStorage.removeItem(JOB_KEY);
    btn.classList.add('hidden');
    $('rv-msg').textContent = d.added.length
      ? `已加入 ${d.added.length} 個單字:${d.added.join(', ')}。網站約 1–2 分鐘後更新,之後重新整理網頁就會出現在題庫裡。`
      : '勾選的單字都已經在題庫裡了。';
    window.scrollTo(0, 0);
  } catch (e) {
    alert(e.message || '加入失敗');
    updateCommitBtn();
  } finally {
    btn.disabled = false;
  }
};
