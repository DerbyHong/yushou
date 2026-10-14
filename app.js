/* 湯守者：北投溫泉走讀實境解謎 —— 主程式 */
'use strict';
(() => {
  const $app = document.getElementById('app');
  const $ov = document.getElementById('overlay');
  const IMG = (n) => `assets/img/${n}.webp`;
  const KEY = 'yushou_state_v1';
  const LETTERS = 'ABCDEFGH';

  /* ---------- 小工具 ---------- */
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return e;
  }
  const isTall = (name) => { const z = (self.IMAGE_SIZES || {})[name]; return !!z && z[1] > z[0]; };
  const pic = (name, cls, alt) => el('img', { src: IMG(name), class: cls, alt: alt || '', draggable: 'false', decoding: 'async' });
  const paras = (text) => (Array.isArray(text) ? text : [text]).map((t) => el('p', null, t));
  const norm = (s) => String(s || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').replace(/台/g, '臺').toLowerCase();
  const charCount = (s) => String(s || '').replace(/\s/g, '').length;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (t) => t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '';

  const timers = new Set();
  function later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; }
  function every(fn, ms) { const t = setInterval(fn, ms); timers.add(t); return t; }
  function clearTimers() { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers.clear(); }

  /* ---------- 存檔 ---------- */
  function fresh() {
    return { v: 2, phase: 'setup', level: 0, step: 0, group: null, props: [], skills: [], skillsRevealed: false, rec: {}, met: [], started: null, finished: null };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) {
        // 舊版存檔的 level 就是關卡編號；第 1 關拿掉後改成 LEVELS 的位置
        if (s.level === 1 && s.phase !== 'setup') { s.phase = 'go'; s.step = 0; }
        s.level = Math.max(0, LEVELS.findIndex((L) => L.id >= s.level));
        s.v = 2;
      }
      if (s && s.v === 2) return Object.assign(fresh(), s);
    } catch (e) { /* 讀不到就重新開始 */ }
    return fresh();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 空間不足時忽略 */ } }
  let S = load();
  let onHome = true;
  let view = null;          // 回顧模式時正在看的步驟
  let afterSetup = null;    // 修改組別資料後要回到的階段
  const rk = (l, s) => `${l}-${s}`;
  const recOf = (l, s) => (S.rec[rk(l, s)] ||= { wrong: 0, hints: 0 });
  // S.level 是 LEVELS 陣列的位置；畫面上的關卡編號用 L.id
  const lvName = (L) => L.id === 0 ? '序章' : `第 ${L.id} 關`;
  const idxOf = (id) => Math.max(0, LEVELS.findIndex((L) => L.id >= id));
  const hasProgress = () => !!S.group && S.phase !== 'setup';

  /* ---------- 照片（IndexedDB，存 dataURL 最相容） ---------- */
  const DB = {
    p: null,
    open() {
      return (this.p ||= new Promise((res, rej) => {
        const r = indexedDB.open('yushou', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('photos');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('photos', mode);
        const out = fn(t.objectStore('photos'));
        t.oncomplete = () => res(out && out.result);
        t.onerror = () => rej(t.error);
      });
    },
    put(k, v) { return this.tx('readwrite', (s) => s.put(v, k)); },
    get(k) { return this.tx('readonly', (s) => s.get(k)); },
    async all() {
      const keys = await this.tx('readonly', (s) => s.getAllKeys());
      const vals = await this.tx('readonly', (s) => s.getAll());
      const o = {};
      (keys || []).forEach((k, i) => { o[k] = vals[i]; });
      return o;
    },
    clear() { return this.tx('readwrite', (s) => s.clear()); },
  };

  /* ---------- 音效（不需要音檔） ---------- */
  let actx;
  function tone(seq) {
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      let t = actx.currentTime + 0.02;
      for (const [f, d, type = 'sine', vol = 0.16] of seq) {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g); g.connect(actx.destination);
        o.start(t); o.stop(t + d + 0.02);
        t += d * 0.75;
      }
    } catch (e) { /* 沒聲音也沒關係 */ }
  }
  const sfx = {
    ok: () => tone([[660, 0.12], [880, 0.12], [1320, 0.3]]),
    bad: () => tone([[240, 0.16, 'triangle', 0.2], [180, 0.28, 'triangle', 0.2]]),
    tap: () => tone([[600, 0.05, 'sine', 0.05]]),
    reward: () => tone([[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.5]]),
  };

  /* ---------- 離線狀態 ---------- */
  async function offlineStatus() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return { state: 'unsupported' };
    if (!self.PRECACHE_FILES) return { state: 'loading', n: 0, total: '?' };
    const files = ['precache.js', ...self.PRECACHE_FILES];
    let n = 0;
    await Promise.all(files.map(async (f) => { try { if (await caches.match(f)) n++; } catch (e) { /* ignore */ } }));
    return { state: n === files.length ? 'ready' : 'loading', n, total: files.length };
  }
  function statusLine() {
    const box = el('div', { class: 'offline-status' }, '檢查離線資料中…');
    const tick = async () => {
      if (devHost) { box.textContent = '🛠 本機開發模式：未啟用離線快取（網址加 ?sw=1 可測試）'; return true; }
      const s = await offlineStatus();
      if (s.state === 'ready') {
        box.className = 'offline-status ok';
        box.textContent = `✅ 已下載完成，可以離線遊玩（${s.total} 個檔案）`;
        return true;
      }
      if (s.state === 'unsupported') {
        box.className = 'offline-status warn';
        box.textContent = '⚠️ 這個瀏覽器不支援離線遊玩，請用 iPad 的 Safari 開啟並「加入主畫面」。';
        return true;
      }
      box.className = 'offline-status warn';
      box.textContent = navigator.onLine
        ? `⏳ 正在下載遊戲資料… ${s.n}/${s.total}（請保持網路連線，不要關閉）`
        : `⚠️ 尚未下載完成（${s.n}/${s.total}），請先連上網路再開啟一次！`;
      return false;
    };
    tick().then((done) => { if (!done) { const t = every(async () => { if (await tick()) { clearInterval(t); timers.delete(t); } }, 1500); } });
    return box;
  }

  /* ---------- 浮層 ---------- */
  function openOverlay(content, cls) {
    $ov.replaceChildren(el('div', { class: 'ov-panel ' + (cls || '') }, content));
    $ov.hidden = false;
    $ov.onclick = (e) => { if (e.target === $ov) closeOverlay(); };
  }
  function closeOverlay() { $ov.hidden = true; $ov.replaceChildren(); }
  const closeBtn = () => el('button', { class: 'ov-close', onclick: closeOverlay, 'aria-label': '關閉' }, '✕');

  function lightbox(name, caption) {
    $ov.replaceChildren(el('div', { class: 'lightbox', onclick: closeOverlay }, pic(name), caption && el('p', null, caption), el('small', null, '點一下關閉')));
    $ov.hidden = false;
    $ov.onclick = closeOverlay;
  }
  function figure(name, caption, extra) {
    return el('figure', { class: 'fig', onclick: () => lightbox(name, caption) }, el('div', { class: 'fig-img' }, pic(name, '', caption), extra), caption && el('figcaption', null, caption));
  }

  /* ---------- 流程 ---------- */
  function render() {
    clearTimers();
    $app.replaceChildren();
    window.scrollTo(0, 0);
    let nodes;
    if (onHome) nodes = homeScreen();
    else if (S.phase === 'setup') nodes = setupScreen();
    else if (S.phase === 'go') nodes = goScreen();
    else if (S.phase === 'title') nodes = titleScreen();
    else if (S.phase === 'play') nodes = playScreen();
    else if (S.phase === 'reward') nodes = rewardScreen();
    else if (S.phase === 'done') nodes = doneScreen();
    else { onHome = true; nodes = homeScreen(); }
    $app.append(...[nodes].flat());
  }
  function next() {
    if (view !== null) {
      view++;
      if (view >= S.step) view = null;
      render();
      return;
    }
    S.step++;
    save();
    if (S.step >= LEVELS[S.level].steps.length) endLevel();
    else render();
  }
  function back() {
    const cur = view ?? S.step;
    if (cur > 0) { view = cur - 1; render(); }
  }
  function endLevel() {
    view = null;
    if (LEVELS[S.level].reward) S.phase = 'reward';
    else gotoNext();
    save();
    render();
  }
  function gotoNext() {
    view = null;
    if (S.level >= LEVELS.length - 1) {
      S.phase = 'done';
      S.finished ||= Date.now();
    } else {
      S.level++;
      S.step = 0;
      S.phase = LEVELS[S.level].go ? 'go' : 'title';
    }
    save();
  }
  function grantRewardsBefore(level) {
    for (const L of LEVELS.slice(0, level)) {
      if (!L.reward) continue;
      if (L.reward.prop && !S.props.includes(L.reward.prop)) S.props.push(L.reward.prop);
      if (L.reward.skill != null && !S.skills.includes(L.reward.skill)) S.skills.push(L.reward.skill);
    }
    S.props.sort((a, b) => PROP_ORDER.indexOf(a) - PROP_ORDER.indexOf(b));
  }
  function markMet(who) {
    if (CHARS[who] && CHARS[who].faces && Object.keys(CHARS[who].faces).length && !S.met.includes(who)) { S.met.push(who); save(); }
  }

  /* ---------- 首頁 ---------- */
  function homeScreen() {
    let taps = 0;
    const L = LEVELS[S.level];
    const cont = hasProgress();
    return el('div', { class: 'home' },
      el('div', { class: 'home-cover' }, pic('cover', 'cover-img', '湯守者')),
      el('div', { class: 'home-card' },
        el('p', { class: 'home-sub' }, '北投溫泉走讀實境解謎'),
        el('h1', { class: 'sr' }, '湯守者'),
        S.group && el('p', { class: 'home-group' }, `第 ${S.group.no} 組${S.group.name ? '・' + S.group.name : ''}`),
        cont && el('p', { class: 'home-progress' }, S.phase === 'done' ? '🏅 已完成全部任務！' : `目前進度：${S.level === 0 ? '序章' : `${lvName(L)}「${L.title}」`}`),
        el('button', { class: 'btn primary big', onclick: () => { sfx.tap(); onHome = false; if (!S.group) S.phase = 'setup'; render(); } }, cont ? '繼續任務 ▶' : '開始任務 ▶'),
        statusLine(),
        el('div', { class: 'home-foot' },
          el('button', { class: 'link', onclick: () => teacherGate() }, '老師專區'),
          el('span', { class: 'ver', onclick: () => { if (++taps >= 5) teacherGate(); } }, 'v' + (self.PRECACHE_VERSION || 'dev')))));
  }

  /* ---------- 報到 ---------- */
  function setupScreen() {
    const g = S.group || { no: null, name: '', members: '' };
    let no = g.no;
    const nos = [];
    const grid = el('div', { class: 'no-grid' });
    for (let i = 1; i <= 10; i++) {
      const b = el('button', { class: 'no-btn' + (no === i ? ' sel' : ''), onclick: () => { sfx.tap(); no = i; nos.forEach((x, j) => x.classList.toggle('sel', j + 1 === i)); } }, i);
      nos.push(b); grid.append(b);
    }
    const name = el('input', { class: 'inp', placeholder: '例如：硫磺小隊（可不填）', maxlength: '20', value: g.name });
    const members = el('textarea', { class: 'inp', rows: '3', placeholder: '組員姓名（可不填）' });
    members.value = g.members || '';
    const msg = el('p', { class: 'msg' });
    return el('main', { class: 'setup' },
      el('div', { class: 'card' },
        el('div', { class: 'setup-head' }, pic('badge', 'setup-badge'), el('div', null, el('h2', null, '探員報到'), el('p', null, '請選擇你們的組別'))),
        grid,
        el('label', { class: 'lbl' }, '小隊名稱'), name,
        el('label', { class: 'lbl' }, '組員'), members,
        msg,
        el('button', { class: 'btn primary big', onclick: () => {
          if (!no) { msg.textContent = '請先選擇組別喔！'; return; }
          S.group = { no, name: name.value.trim(), members: members.value.trim() };
          if (afterSetup) { S.phase = afterSetup; afterSetup = null; } else { S.phase = 'play'; S.level = 0; S.step = 0; S.started ||= Date.now(); }
          save(); sfx.ok(); render();
        } }, afterSetup ? '儲存' : '出發！')));
  }

  /* ---------- 上方資訊列 ---------- */
  function hud(withBack) {
    const L = LEVELS[S.level];
    const cur = view ?? S.step;
    const total = LEVELS.length - 1;
    const pct = S.phase === 'done' ? 100 : Math.max(0, ((S.level - 1) + (S.phase === 'play' ? cur / L.steps.length : 0)) / total * 100);
    return el('header', { class: 'hud' },
      el('div', { class: 'hud-row' },
        withBack && cur > 0 ? el('button', { class: 'icon-btn', onclick: back, 'aria-label': '上一頁' }, '◀') : el('button', { class: 'icon-btn home-btn', onclick: () => { onHome = true; view = null; render(); }, 'aria-label': '首頁' }, '⌂'),
        el('div', { class: 'hud-title' }, el('b', null, lvName(L)), el('span', null, L.title)),
        el('button', { class: 'icon-btn', onclick: openMap, 'aria-label': '地圖' }, '🗺'),
        el('button', { class: 'icon-btn bag', onclick: () => openBag(), 'aria-label': '背包' }, '🎒', el('span', { class: 'count' }, `${S.props.length}/6`))),
      el('div', { class: 'energy', title: '青磺能量' }, el('i', { style: { width: pct + '%' } })));
  }

  /* ---------- 前往下一關 ---------- */
  function goScreen() {
    const L = LEVELS[S.level];
    const g = L.go || {};
    return [hud(false), el('main', { class: 'go' },
      el('div', { class: 'card go-card' },
        el('div', { class: 'go-kicker' }, '下一站'),
        el('h2', null, `第 ${L.id} 關・${L.title}`),
        !g.riddle && el('p', { class: 'go-place' }, '📍 ', L.place),
        g.riddle && el('div', { class: 'riddle' }, el('small', null, '謎語'), el('b', null, g.riddle)),
        g.text && el('p', { class: 'go-text' }, g.text),
        g.photo && el('div', { class: 'go-photo' }, el('small', null, '找找看這個地方 👀'), figure(g.photo)),
        g.pin && miniMap(g.pin),
        el('button', { class: 'btn primary big', onclick: () => { sfx.tap(); S.phase = 'title'; save(); render(); } }, '📍 我們到了！')))];
  }
  function miniMap(pin) {
    const p = MAP_PINS[pin];
    return el('div', { class: 'mini-map', onclick: openMap },
      pic('map', '', '探索地圖'),
      el('span', { class: 'pin now', style: { left: p.x + '%', top: p.y + '%' } }, el('em', null, p.label)),
      el('small', { class: 'mini-tip' }, '點地圖可放大'));
  }

  /* ---------- 關卡標題 ---------- */
  function titleScreen() {
    const L = LEVELS[S.level];
    return [hud(false), el('main', { class: 'title-screen' },
      el('div', { class: 'title-hero' }, L.hero && pic(L.hero, 'hero-img' + (isTall(L.hero) ? ' tall' : ''))),
      el('div', { class: 'card title-card' },
        el('div', { class: 'lv-badge' }, `第 ${L.id} 關`),
        el('h1', null, L.title),
        el('p', { class: 'go-place' }, '📍 ', L.place),
        el('button', { class: 'btn primary big', onclick: () => { sfx.tap(); S.phase = 'play'; save(); render(); } }, '開始挑戰 ▶')))];
  }

  /* ---------- 關卡內容 ---------- */
  function playScreen() {
    const L = LEVELS[S.level];
    const idx = Math.min(view ?? S.step, L.steps.length - 1);
    const st = L.steps[idx];
    const ctx = { review: idx < S.step, rec: recOf(L.id, idx), key: rk(L.id, idx), idx };
    const main = el('main', { class: 'play type-' + st.type });
    if (ctx.review) main.append(el('div', { class: 'review-bar' }, '👀 回顧中', el('button', { class: 'btn small', onclick: () => { view = null; render(); } }, '回到目前進度 ⏩')));
    main.append(renderStep(st, ctx));
    main.append(el('div', { class: 'dots' }, L.steps.map((_, i) => el('i', { class: i < S.step ? 'done' : i === idx ? 'cur' : '' }))));
    return [hud(true), main];
  }
  function renderStep(st, ctx) {
    switch (st.type) {
      case 'dialog': return stepDialog(st, ctx);
      case 'story': return stepStory(st, ctx);
      case 'choice': return stepChoice(st, ctx, false);
      case 'multi': return stepChoice(st, ctx, true);
      case 'text': return stepText(st, ctx);
      case 'multitext': return stepMultiText(st, ctx);
      case 'open': return stepOpen(st, ctx);
      case 'check': return stepCheck(st, ctx);
      case 'photo': return stepPhoto(st, ctx);
      case 'teacher': return stepTeacher(st, ctx);
      case 'puzzle': return stepPuzzle(st, ctx);
      case 'match': return stepMatch(st, ctx);
      case 'drops': return stepDrops(st, ctx);
      case 'number': return stepNumber(st, ctx);
      case 'ending': return stepEnding(st, ctx);
      default: return el('div', { class: 'card' }, '（未知的步驟）', el('button', { class: 'btn primary', onclick: next }, '繼續'));
    }
  }

  /* 對話 */
  function stepDialog(st, ctx) {
    let i = 0;
    let typing = null;
    const bg = st.bg || LEVELS[S.level].hero;
    const stage = el('div', { class: 'stage' + (bg ? ' has-bg' : ''), style: bg ? { backgroundImage: `url(${IMG(bg)})` } : null });
    const name = el('div', { class: 'speaker' });
    const text = el('p', { class: 'line' });
    const prev = el('button', { class: 'btn ghost', onclick: (e) => { e.stopPropagation(); if (i > 0) { i--; show(); } } }, '◀ 上一句');
    const nxt = el('button', { class: 'btn primary', onclick: (e) => { e.stopPropagation(); advance(); } });
    const bubble = el('div', { class: 'bubble', onclick: () => advance() }, name, text);
    const wrap = el('div', { class: 'dialog' }, stage, bubble, el('div', { class: 'dlg-actions' }, prev, el('span', { class: 'dlg-count' }), nxt));
    let curImg = null;
    function show() {
      const [who, face, line] = st.lines[i];
      const c = CHARS[who] || CHARS.narr;
      markMet(who);
      const faces = c.faces || {};
      const src = faces[face] || faces.normal || Object.values(faces)[0];
      if (src !== curImg) {
        curImg = src;
        stage.replaceChildren(src ? pic(src, 'actor ' + who) : el('div', { class: 'actor-none' }));
      }
      wrap.classList.toggle('narration', who === 'narr');
      wrap.classList.toggle('no-actor', !src);
      name.textContent = c.name;
      name.hidden = !c.name;
      prev.style.visibility = i > 0 ? 'visible' : 'hidden';
      wrap.querySelector('.dlg-count').textContent = `${i + 1} / ${st.lines.length}`;
      nxt.textContent = i < st.lines.length - 1 ? '下一句 ▶' : '繼續 ▶';
      // 打字效果
      if (typing) { clearInterval(typing); timers.delete(typing); }
      let n = 0;
      text.textContent = '';
      typing = every(() => {
        n += 2;
        text.textContent = line.slice(0, n);
        if (n >= line.length) { clearInterval(typing); timers.delete(typing); typing = null; }
      }, 30);
    }
    function advance() {
      if (typing) {
        clearInterval(typing); timers.delete(typing); typing = null;
        text.textContent = st.lines[i][2];
        return;
      }
      sfx.tap();
      if (i < st.lines.length - 1) { i++; show(); } else next();
    }
    show();
    return wrap;
  }

  /* 故事卡 */
  function stepStory(st) {
    return el('article', { class: 'card story' },
      st.banner && el('div', { class: 'banner', onclick: () => lightbox(st.banner) }, pic(st.banner)),
      el('h2', null, st.icon ? st.icon + ' ' : '', st.title),
      el('div', { class: 'story-text' }, paras(st.text || [])),
      st.images && el('div', { class: 'gallery' + (st.images.length === 1 ? ' one' : '') }, st.images.map(([n, c]) => figure(n, c))),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary big', onclick: next }, '繼續 ▶')));
  }

  /* 題目共用外框 */
  function Task(st, ctx, opts = {}) {
    const r = ctx.rec;
    const box = el('section', { class: 'card task' });
    box.append(el('h2', { class: 'q' }, st.q));
    if (st.image) {
      const covers = st.covers ? st.covers.map(([x, y, w, h]) => el('span', { class: 'cover', style: { left: x + '%', top: y + '%', width: w + '%', height: h + '%' } }, '?')) : null;
      box.append(figure(st.image, null, covers));
    }
    const body = el('div', { class: 'task-body' });
    const hintBox = el('div', { class: 'hints' });
    const fb = el('div', { class: 'feedback', 'aria-live': 'polite' });
    const actions = el('div', { class: 'actions' });
    box.append(body, hintBox, fb, actions);
    const hints = st.hints || [];
    const freeHints = opts.freeHints;
    const hintBtn = el('button', { class: 'btn hint', onclick: () => { r.hints++; save(); sfx.tap(); paintHints(); } }, '💡 需要提示');
    function unlocked() { return freeHints ? hints.length : Math.min(hints.length, Math.floor((r.wrong || 0) / HINT_AFTER)); }
    function paintHints() {
      const shown = freeHints ? hints.length : Math.min(r.hints, unlocked());
      hintBox.replaceChildren(...hints.slice(0, shown).map((h, i) => el('div', { class: 'hint-item' }, el('b', null, freeHints ? '🔎 線索' : `💡 提示 ${i + 1}`), el('span', null, h))));
      hintBtn.hidden = T.locked || freeHints || unlocked() <= r.hints;
    }
    const T = {
      box, body, actions, fb, locked: false, submitBtn: null,
      submit(label, fn) {
        T.submitBtn = el('button', { class: 'btn primary big', onclick: () => { if (!T.locked) fn(); } }, label);
        actions.replaceChildren(hintBtn, T.submitBtn);
        paintHints();
      },
      say(msg) { fb.replaceChildren(el('div', { class: 'fb-note' }, msg)); },
      wrong(msg) {
        r.wrong = (r.wrong || 0) + 1;
        save();
        sfx.bad();
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        const lines = ['再想想看！', '差一點點，再試一次！', '別灰心，回去看看線索！', '仔細觀察現場，再試試看！'];
        fb.replaceChildren(el('div', { class: 'fb-wrong' }, pic('tengu_sad', 'fb-face'),
          el('div', null, el('b', null, msg || lines[(r.wrong - 1) % lines.length]),
            unlocked() > r.hints ? el('span', null, '可以按「💡 需要提示」喔！') : null)));
        paintHints();
      },
      ok(answer, msg, title) {
        r.answer = answer; r.done = true; r.at = Date.now();
        save();
        sfx.ok();
        T.solved(msg, title);
      },
      solved(msg, title) {
        T.locked = true;
        box.classList.add('solved');
        box.querySelectorAll('input,textarea,select').forEach((x) => { x.disabled = true; });
        fb.replaceChildren(el('div', { class: 'fb-ok' }, pic(opts.okFace || 'spirit_happy', 'fb-face'),
          el('div', null, el('b', null, title || (r.skipped ? '老師已協助通過' : '答對了！')), msg && el('span', null, msg))));
        actions.replaceChildren(el('button', { class: 'btn primary big', onclick: next }, '繼續 ▶'));
        paintHints();
      },
    };
    return T;
  }

  /* 單選／複選 */
  function stepChoice(st, ctx, multi) {
    const T = Task(st, ctx);
    let sel = new Set();
    const correct = new Set(multi ? st.answer : [st.answer]);
    const opts = st.options.map((o, i) => el('button', { class: 'opt', onclick: () => {
      if (T.locked) return;
      sfx.tap();
      if (multi) { if (sel.has(i)) sel.delete(i); else sel.add(i); } else sel = new Set([i]);
      paint();
    } }, el('span', { class: 'letter' }, multi ? '' : LETTERS[i]), el('span', { class: 'opt-text' }, o)));
    function paint() { opts.forEach((b, i) => b.classList.toggle('sel', sel.has(i))); }
    if (multi) T.body.append(el('div', { class: 'tag' }, '複選題：可以選不只一個'));
    T.body.append(el('div', { class: 'opts' + (multi ? ' multi' : '') }, opts));
    const showRight = () => opts.forEach((b, i) => b.classList.toggle('right', correct.has(i)));
    T.submit('確定答案', () => {
      if (!sel.size) return T.say('請先選擇答案喔！');
      const ok = sel.size === correct.size && [...sel].every((i) => correct.has(i));
      if (ok) { showRight(); T.ok([...sel].sort().map((i) => LETTERS[i]).join(''), st.explain); return; }
      if (!multi) { const b = opts[[...sel][0]]; b.classList.add('wrong'); later(() => { b.classList.remove('wrong'); sel.clear(); paint(); }, 900); }
      T.wrong(multi ? (sel.size !== correct.size ? '還不完全正確，選的數量不太對喔！' : '還不完全正確，再檢查看看！') : null);
    });
    if (ctx.rec.done) { sel = new Set(correct); paint(); showRight(); T.solved(st.explain); }
    return T.box;
  }

  /* 填答 */
  function stepText(st, ctx) {
    const T = Task(st, ctx);
    const inp = el('input', { class: 'inp big-inp', placeholder: st.placeholder || '請輸入答案', inputmode: st.inputmode, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } } });
    T.body.append(inp);
    const okSet = st.answer.map(norm);
    function check() {
      const v = inp.value;
      if (!norm(v)) return T.say('請先輸入答案喔！');
      if (okSet.includes(norm(v))) { inp.classList.add('right'); inp.blur(); T.ok(v.trim(), st.explain); } else T.wrong();
    }
    T.submit('確定答案', check);
    if (ctx.rec.done) { inp.value = ctx.rec.answer || st.answer[0]; inp.classList.add('right'); T.solved(st.explain); }
    return T.box;
  }

  /* 多格填答（第 12 關技能） */
  function stepMultiText(st, ctx) {
    const T = Task(st, ctx, { okFace: 'spirit_joy' });
    const inps = st.parts.map((p, i) => {
      const inp = el('input', { class: 'inp', placeholder: '4 個字', maxlength: '8', autocomplete: 'off',
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); (inps[i + 1] || {}).focus ? inps[i + 1].focus() : check(); } } });
      T.body.append(el('label', { class: 'lbl' }, p.label), inp);
      return inp;
    });
    function check() {
      if (inps.some((x) => !norm(x.value))) return T.say('三格都要填喔！');
      let all = true;
      inps.forEach((x, i) => {
        const ok = st.parts[i].answer.map(norm).includes(norm(x.value));
        x.classList.toggle('right', ok); x.classList.toggle('wrong', !ok);
        all = all && ok;
      });
      if (all) {
        if (st.grantSkill != null && !S.skills.includes(st.grantSkill)) S.skills.push(st.grantSkill);
        S.skillsRevealed = true;
        T.ok(inps.map((x) => x.value.trim()).join('、'), st.explain, '技能解封！');
        sfx.reward();
      } else T.wrong(`有 ${inps.filter((x) => x.classList.contains('wrong')).length} 格不對（紅色框），再想想看！`);
    }
    T.submit('確定答案', check);
    if (ctx.rec.done) { inps.forEach((x, i) => { x.value = st.parts[i].answer[0]; x.classList.add('right'); }); T.solved(st.explain, '技能解封！'); }
    return T.box;
  }

  /* 開放題 */
  function stepOpen(st, ctx) {
    const T = Task(st, ctx, { freeHints: true, okFace: 'spirit_normal' });
    const prev = Array.isArray(ctx.rec.answer) ? ctx.rec.answer : [];
    const areas = st.fields.map((f, i) => {
      const ta = el('textarea', { class: 'inp', rows: String(f.rows || 2), placeholder: '寫下你們的想法…' });
      ta.value = prev[i] || '';
      const cnt = el('small', { class: 'counter' });
      const upd = () => { const n = charCount(ta.value); cnt.textContent = `${n} 字${f.minLen ? `（至少 ${f.minLen} 字）` : ''}`; cnt.classList.toggle('enough', n >= (f.minLen || 0)); };
      ta.addEventListener('input', upd); upd();
      T.body.append(el('label', { class: 'lbl' }, f.label), ta, cnt);
      return ta;
    });
    T.submit('寫好了，送出', () => {
      for (let i = 0; i < st.fields.length; i++) {
        const f = st.fields[i]; const v = areas[i].value;
        if (charCount(v) < (f.minLen || 1)) { areas[i].focus(); return T.say(`「${f.label}」還要再多寫一點（至少 ${f.minLen || 1} 字）。`); }
        const miss = (f.mustInclude || []).filter((w) => !v.includes(w));
        if (miss.length) { areas[i].focus(); return T.say(`解說裡要提到：${miss.map((w) => `「${w}」`).join('、')}`); }
      }
      const ans = areas.map((a) => a.value.trim());
      if (st.oath) S.oath = ans[0];
      T.ok(ans, '已經記錄在「🎒 探員紀錄」裡了。', '記錄完成！能量注入中…');
    });
    if (ctx.rec.done) T.solved('已經記錄在「🎒 探員紀錄」裡了。', '記錄完成！');
    return T.box;
  }

  /* 打勾清單 */
  function stepCheck(st, ctx) {
    const T = Task(st, ctx, { okFace: 'spirit_normal' });
    const on = new Set(ctx.rec.done ? st.items.map((_, i) => i) : []);
    const btns = st.items.map((it, i) => el('button', { class: 'check-item', onclick: () => {
      if (T.locked) return;
      sfx.tap();
      if (on.has(i)) on.delete(i); else on.add(i);
      paint();
    } }, el('span', { class: 'box' }), el('span', null, it)));
    function paint() { btns.forEach((b, i) => b.classList.toggle('on', on.has(i))); }
    T.body.append(el('div', { class: 'checks' }, btns));
    paint();
    T.submit('全部完成！', () => {
      if (on.size < st.items.length) return T.say(`還有 ${st.items.length - on.size} 項還沒打勾喔！`);
      T.ok(st.items, null, '觀察完成！');
    });
    if (ctx.rec.done) T.solved(null, '觀察完成！');
    return T.box;
  }

  /* 拍照 */
  function stepPhoto(st, ctx) {
    const T = Task(st, ctx, { okFace: 'spirit_normal' });
    const preview = el('div', { class: 'photo-preview' }, el('span', null, '📷 還沒有照片'));
    // 不加 capture 屬性：iPad 會跳出「拍照／照片圖庫」選單，Safari 和 Chrome 都能正常開相機
    const input = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      T.say('照片處理中…');
      try {
        const data = await shrinkPhoto(f);
        await DB.put(ctx.key, data);
        showPhoto(data);
        T.say('拍好了！滿意的話按「使用這張照片」。');
        has = true;
      } catch (e) {
        T.say('照片儲存失敗，請再拍一次，或請老師協助。');
      }
      input.value = '';
    } });
    let has = false;
    function showPhoto(data) { preview.replaceChildren(el('img', { src: data, alt: '探員照片' })); }
    const shoot = el('button', { class: 'btn big', onclick: () => input.click() }, '📷 拍照');
    T.body.append(preview, input, shoot);
    DB.get(ctx.key).then((d) => { if (d) { has = true; showPhoto(d); shoot.textContent = '📷 重拍'; } }).catch(() => {});
    T.submit('使用這張照片', () => {
      if (!has) return T.say('請先按「📷 拍照」喔！');
      T.ok('photo', '照片存在 iPad 裡，回學校後老師可以看到。', '能量注入成功！');
    });
    if (ctx.rec.done) T.solved('照片存在 iPad 裡，回學校後老師可以看到。', '能量注入成功！');
    return T.box;
  }
  function shrinkPhoto(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const s = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * s);
        c.height = Math.round(im.naturalHeight * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.75));
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
      im.src = url;
    });
  }

  /* 老師蓋章 */
  function stepTeacher(st, ctx) {
    const T = Task(st, ctx, { okFace: 'spirit_normal' });
    const inp = el('input', { class: 'inp big-inp code', type: 'password', inputmode: 'numeric', placeholder: '老師密碼', autocomplete: 'off',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } } });
    const stamp = el('div', { class: 'stamp' }, el('span', null, '湯守'), el('span', null, '認證'));
    T.body.append(el('p', { class: 'teacher-note' }, '👩‍🏫 這一步需要老師幫忙'), inp, stamp);
    function check() {
      if (inp.value === TEACHER_CODE) { inp.value = ''; T.box.classList.add('stamped'); T.ok('teacher', null, '老師已確認！'); }
      else { inp.value = ''; T.say('密碼不對喔，請老師再輸入一次。'); }
    }
    T.submit('確認', check);
    if (ctx.rec.done) { T.box.classList.add('stamped'); T.solved(null, '老師已確認！'); }
    return T.box;
  }

  /* 拼圖 */
  function stepPuzzle(st, ctx) {
    const T = Task(st, ctx);
    const n = st.pieces.length;
    let order;
    do { order = [...Array(n).keys()].sort(() => Math.random() - 0.5); } while (order.every((v, i) => v === i));
    let selected = null;
    const board = el('div', { class: 'puzzle' });
    function paint() {
      board.replaceChildren(...order.map((p, pos) => el('button', { class: 'piece' + (selected === pos ? ' sel' : ''), onclick: () => tap(pos) }, pic(st.pieces[p]))));
    }
    function tap(pos) {
      if (T.locked) return;
      sfx.tap();
      if (selected === null) { selected = pos; paint(); return; }
      if (selected !== pos) [order[selected], order[pos]] = [order[pos], order[selected]];
      selected = null;
      paint();
      if (order.every((v, i) => v === i)) {
        board.classList.add('done');
        later(() => { board.replaceChildren(pic(st.full, 'puzzle-full')); }, 700);
        T.ok('完成', '石拱橋的時光碎片拼回來了！仔細看看橋的樣子。', '拼好了！');
      }
    }
    T.body.append(board);
    if (ctx.rec.done) { board.classList.add('done'); board.replaceChildren(pic(st.full, 'puzzle-full')); T.solved('石拱橋的時光碎片拼回來了！', '拼好了！'); }
    else { paint(); T.submit('拼好了嗎？', () => T.say('點一塊碎片，再點另一塊，就可以交換位置喔！')); }
    return T.box;
  }

  /* 配對 */
  function stepMatch(st, ctx) {
    const T = Task(st, ctx);
    const pick = st.rows.map(() => null);
    const rows = st.rows.map(([desc], r) => {
      const chips = st.choices.map((c, ci) => el('button', { class: 'chip', onclick: () => {
        if (T.locked) return;
        sfx.tap(); pick[r] = ci; row.classList.remove('wrong');
        chips.forEach((x, j) => x.classList.toggle('sel', j === ci));
      } }, c));
      const row = el('div', { class: 'match-row' }, el('p', null, desc), el('div', { class: 'chips' }, chips));
      row.chips = chips;
      return row;
    });
    T.body.append(el('div', { class: 'match' }, rows));
    T.submit('確定配對', () => {
      if (pick.some((p) => p === null)) return T.say('每一段描述都要選一個石頭喔！');
      let all = true;
      rows.forEach((row, r) => { const ok = pick[r] === st.rows[r][1]; row.classList.toggle('wrong', !ok); row.classList.toggle('right', ok); all = all && ok; });
      if (all) T.ok(pick.map((p) => st.choices[p]), st.explain);
      else T.wrong('有的配對不對喔，紅色的再想想！');
    });
    if (ctx.rec.done) {
      rows.forEach((row, r) => { row.classList.add('right'); row.chips[st.rows[r][1]].classList.add('sel'); });
      T.solved(st.explain);
    }
    return T.box;
  }

  /* 分配溫泉水滴 */
  function stepDrops(st, ctx) {
    const T = Task(st, ctx, { okFace: 'spirit_normal' });
    const prev = ctx.rec.answer;
    const counts = prev ? [...prev.counts] : st.groups.map(() => 0);
    const left = el('div', { class: 'drops-left' });
    const rows = st.groups.map((g, i) => {
      const drops = el('div', { class: 'drop-row' });
      const num = el('b', { class: 'drop-num' });
      const minus = el('button', { class: 'round', onclick: () => { if (!T.locked && counts[i] > 0) { counts[i]--; sfx.tap(); paint(); } } }, '−');
      const plus = el('button', { class: 'round', onclick: () => { if (!T.locked && sum() < st.total) { counts[i]++; sfx.tap(); paint(); } } }, '+');
      const row = el('div', { class: 'drops-group' }, el('span', { class: 'drops-name' }, g), minus, num, plus, drops);
      row.paint = () => { num.textContent = counts[i]; drops.replaceChildren(...Array.from({ length: counts[i] }, () => el('i', { class: 'drop' }))); };
      return row;
    });
    const sum = () => counts.reduce((a, b) => a + b, 0);
    function paint() {
      rows.forEach((r) => r.paint());
      const n = st.total - sum();
      left.replaceChildren(el('span', null, '還剩 '), el('b', null, n), el('span', null, ' 枚水滴'), ...Array.from({ length: n }, () => el('i', { class: 'drop' })));
      left.classList.toggle('empty', n === 0);
    }
    const reason = el('textarea', { class: 'inp', rows: '3', placeholder: '為什麼這樣分配呢？' });
    reason.value = prev ? prev.reason : '';
    T.body.append(left, el('div', { class: 'drops' }, rows), el('label', { class: 'lbl' }, '我們的理由'), reason);
    paint();
    T.submit('分配完成', () => {
      const n = st.total - sum();
      if (n > 0) return T.say(`還有 ${n} 枚水滴沒有分配喔！`);
      if (charCount(reason.value) < 8) return T.say('請寫下你們的理由（至少 8 個字）。');
      T.ok({ counts: [...counts], reason: reason.value.trim() }, '你們的分配方式已經記錄下來了！', '溫泉水滴分配完成！');
    });
    if (ctx.rec.done) T.solved('你們的分配方式已經記錄下來了！', '溫泉水滴分配完成！');
    return T.box;
  }

  /* 數數 */
  function stepNumber(st, ctx) {
    const T = Task(st, ctx, { okFace: st.answer == null ? 'spirit_normal' : 'spirit_happy' });
    const inp = el('input', { class: 'inp big-inp', type: 'number', inputmode: 'numeric', min: '1', placeholder: '數字',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } } });
    T.body.append(el('div', { class: 'num-row' }, inp, el('span', null, st.unit || '')));
    const msg = (v) => st.answer == null ? `你們數到 ${v} ${st.unit || ''}，已經記錄下來了！請和老師核對。` : st.explain;
    function check() {
      const v = parseInt(inp.value, 10);
      if (!(v > 0 && v < 1000)) return T.say('請輸入一個數字喔！');
      if (st.answer == null || v === st.answer) T.ok(v, msg(v), st.answer == null ? '記錄完成！' : null);
      else T.wrong(v > st.answer ? '好像太多了，再數一次！' : '好像太少了，再數一次！');
    }
    T.submit('確定', check);
    if (ctx.rec.done) { inp.value = ctx.rec.answer; T.solved(msg(ctx.rec.answer), st.answer == null ? '記錄完成！' : null); }
    return T.box;
  }

  /* 結局 */
  function stepEnding() {
    sfx.reward();
    return el('section', { class: 'ending' },
      el('div', { class: 'ending-art' }, pic('ending', 'ending-img')),
      el('div', { class: 'card ending-card' },
        pic('oath_logo', 'oath-logo'),
        el('h2', null, '北投守護結界，重新啟動！'),
        paras(['六件湯守道具連結在一起，青磺精靈恢復了力量，湯守觀音也醒過來了。', '從今天起，你們就是守護北投故事的「湯守者」！']),
        el('button', { class: 'btn primary big', onclick: next }, '✨ 成為湯守者')));
  }

  /* ---------- 獲得獎勵 ---------- */
  function rewardScreen() {
    const L = LEVELS[S.level];
    const R = L.reward;
    if (R.prop && !S.props.includes(R.prop)) { S.props.push(R.prop); S.props.sort((a, b) => PROP_ORDER.indexOf(a) - PROP_ORDER.indexOf(b)); }
    if (R.skill != null && !S.skills.includes(R.skill)) S.skills.push(R.skill);
    save();
    later(sfx.reward, 150);
    const n = S.props.length;
    const face = n >= 6 ? 'spirit_joy' : n >= 4 ? 'spirit_happy' : n >= 2 ? 'spirit_normal' : 'spirit_bound';
    const P = R.prop && PROPS[R.prop];
    const K = R.skill != null && SKILLS[R.skill];
    return [hud(false), el('main', { class: 'reward' },
      P && el('div', { class: 'reward-prop' }, el('div', { class: 'rays' }), pic(P.img, 'prop-card', P.name)),
      P && el('div', { class: 'card reward-card' },
        el('h2', null, `獲得道具：${P.name}`),
        el('p', null, P.desc),
        el('div', { class: 'reward-energy' }, pic(face, 'reward-face'),
          el('div', null, el('b', null, '青磺精靈恢復了一點力量！'),
            el('div', { class: 'prop-slots' }, PROP_ORDER.map((k) => el('i', { class: S.props.includes(k) ? 'on' : '' }))),
            el('small', null, `湯守道具 ${n} / 6`)))),
      K && el('div', { class: 'card reward-card skill-get' },
        el('div', { class: 'skill-badge sealed big' }, el('span', null, K.icon)),
        el('div', null, el('h2', null, '獲得湯守技能徽章！'),
          el('p', null, el('b', null, '技能名稱：？？？？（封印中）')),
          el('p', null, K.desc),
          el('small', null, '技能的名字，要到最後一關才能解封喔！'))),
      el('button', { class: 'btn primary big', onclick: () => { sfx.tap(); gotoNext(); render(); } }, '繼續前進 ▶'))];
  }

  /* ---------- 完成 ---------- */
  function doneScreen() {
    const g = S.group || {};
    const mins = S.started && S.finished ? Math.round((S.finished - S.started) / 60000) : null;
    return [hud(false), el('main', { class: 'done' },
      el('div', { class: 'cert' },
        pic('badge', 'cert-badge'),
        el('div', { class: 'cert-kicker' }, '湯守者認證'),
        el('h1', null, `第 ${g.no || '?'} 組${g.name ? '・' + g.name : ''}`),
        g.members && el('p', { class: 'cert-members' }, g.members),
        el('p', null, '走完北投百年溫泉路的所有關卡，喚醒湯守觀音，重新啟動守護北投的結界。'),
        el('div', { class: 'cert-props' }, PROP_ORDER.map((k) => el('figure', null, pic(PROPS[k].img), el('figcaption', null, PROPS[k].name)))),
        el('div', { class: 'cert-skills' }, SKILLS.map((k) => el('div', { class: 'skill-pill' }, k.icon, ' ', k.name))),
        S.oath && el('blockquote', null, '「', S.oath, '」'),
        el('p', { class: 'cert-date' }, fmtTime(S.finished), mins ? `・用時 ${mins} 分鐘` : '')),
      el('div', { class: 'done-actions' },
        el('button', { class: 'btn big', onclick: () => openBag('records') }, '🎒 看看我們的紀錄'),
        el('button', { class: 'btn big', onclick: () => lightbox('oath_card') }, '📜 湯守盟約')))];
  }

  /* ---------- 地圖 ---------- */
  function openMap() {
    const curPin = (LEVELS[S.level].go || {}).pin;
    const curIdx = S.phase === 'done' ? MAP_ROUTE.length : MAP_ROUTE.indexOf(curPin);
    const pts = MAP_ROUTE.map((k) => MAP_PINS[k]);
    const svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="route"><polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" /></svg>`;
    const wrap = el('div', { class: 'map-wrap' }, pic('map', 'map-img', '湯泉小偵探 探索地圖'));
    wrap.insertAdjacentHTML('beforeend', svg);
    MAP_ROUTE.forEach((k, i) => {
      const p = MAP_PINS[k];
      const state = i < curIdx ? 'past' : (k === curPin && S.phase !== 'done') ? 'now' : '';
      wrap.append(el('span', { class: 'pin ' + state, style: { left: p.x + '%', top: p.y + '%' } }, el('em', null, p.label)));
    });
    const scroller = el('div', { class: 'map-scroll' }, wrap);
    const zoom = el('button', { class: 'btn small', onclick: () => { scroller.classList.toggle('zoom'); zoom.textContent = scroller.classList.contains('zoom') ? '🔍 縮小' : '🔍 放大'; } }, '🔍 放大');
    const g = LEVELS[S.level].go;
    openOverlay([closeBtn(), el('h2', null, '🗺 探索地圖'),
      el('p', { class: 'map-note' }, curPin ? `閃爍的地點是下一站：${MAP_PINS[curPin].label}` : '第 2～3 關在北投國小附近，地圖從新北投公園開始。'),
      scroller,
      el('div', { class: 'map-tools' }, zoom),
      g && g.text && S.phase !== 'done' && el('div', { class: 'map-dir' }, el('b', null, `前往${lvName(LEVELS[S.level])}：`), g.text)], 'map-panel');
  }

  /* ---------- 背包 ---------- */
  function openBag(tab) {
    tab ||= 'props';
    const tabs = [['props', '道具'], ['skills', '技能'], ['chars', '角色'], ['records', '探員紀錄']];
    const content = el('div', { class: 'bag-content' });
    const bar = el('div', { class: 'tabs' }, tabs.map(([k, label]) => el('button', { class: 'tab' + (k === tab ? ' on' : ''), onclick: () => openBag(k) }, label)));
    if (tab === 'props') {
      content.append(el('div', { class: 'prop-grid' }, PROP_ORDER.map((k) => {
        const P = PROPS[k];
        const have = S.props.includes(k);
        const from = LEVELS.find((L) => L.reward && L.reward.prop === k);
        return el('button', { class: 'prop-cell' + (have ? ' have' : ''), onclick: () => have && lightbox(P.img, `${P.name}：${P.desc}`) },
          have ? pic(P.img) : el('div', { class: 'prop-locked' }, '?'),
          el('span', null, have ? P.name : from ? `${lvName(from)}後獲得` : '？？？'));
      })));
    } else if (tab === 'skills') {
      content.append(el('div', { class: 'skill-list' }, SKILLS.map((k, i) => {
        const have = S.skills.includes(i);
        const open = S.skillsRevealed;
        return el('div', { class: 'skill-row' + (have ? ' have' : '') },
          el('div', { class: 'skill-badge' + (open ? '' : ' sealed') }, el('span', null, have ? k.icon : '?')),
          el('div', null, el('b', null, have ? (open ? k.name : '？？？？（封印中）') : '尚未獲得'), el('p', null, have ? k.desc : '繼續闖關就能獲得。')));
      })), el('p', { class: 'small-note' }, S.skillsRevealed ? '三項技能已全部解封！' : '技能的名字，要到最後一關才能解封喔！'));
    } else if (tab === 'chars') {
      const list = Object.entries(CHARS).filter(([, c]) => c.bio);
      content.append(el('div', { class: 'char-grid' }, list.map(([k, c]) => {
        const met = S.met.includes(k);
        const face = Object.values(c.faces)[0];
        return el('button', { class: 'char-cell' + (met ? ' met' : ''), onclick: () => met && c.card && lightbox(c.card, c.name) },
          el('div', { class: 'char-pic' }, pic(face)),
          el('b', null, met ? c.name : '？？？'),
          el('p', null, met ? c.bio : '還沒有遇見。'),
          met && c.card && el('small', null, '點一下看介紹卡'));
      })));
    } else {
      content.append(recordsView());
    }
    openOverlay([closeBtn(), el('h2', null, '🎒 探員背包'), bar, content,
      el('div', { class: 'bag-foot' }, el('button', { class: 'link', onclick: () => teacherGate() }, '老師專區'))], 'bag-panel');
  }

  function answerText(st, r) {
    if (!r || !r.done) return '';
    const a = r.answer;
    if (r.skipped) return '（老師協助通過）';
    switch (st.type) {
      case 'open': return st.fields.map((f, i) => `${f.label}：${(a || [])[i] || ''}`).join('\n');
      case 'drops': return `${st.groups.map((g, i) => `${g} ${a.counts[i]} 枚`).join('、')}\n理由：${a.reason}`;
      case 'number': return `${a} ${st.unit || ''}`;
      case 'match': return st.rows.map((row, i) => `${row[0]} → ${(a || [])[i]}`).join('\n');
      case 'check': return '已完成觀察';
      case 'photo': return '（照片）';
      case 'teacher': return '老師已確認';
      case 'puzzle': return '拼圖完成';
      case 'choice': case 'multi': return `選了 ${a}`;
      default: return String(a ?? '');
    }
  }
  const TASK_TYPES = new Set(['choice', 'multi', 'text', 'multitext', 'open', 'check', 'photo', 'teacher', 'puzzle', 'match', 'drops', 'number']);
  function eachTask(fn) {
    LEVELS.forEach((L) => L.steps.forEach((st, i) => { if (TASK_TYPES.has(st.type)) fn(L, st, i, S.rec[rk(L.id, i)]); }));
  }
  function recordsView() {
    const box = el('div', { class: 'records' });
    let any = false;
    LEVELS.forEach((L) => {
      const items = [];
      L.steps.forEach((st, i) => {
        if (!['open', 'drops', 'number', 'photo', 'text', 'multitext'].includes(st.type)) return;
        const r = S.rec[rk(L.id, i)];
        if (!r || !r.done) return;
        const item = el('div', { class: 'rec-item' }, el('p', { class: 'rec-q' }, st.q || st.title), el('p', { class: 'rec-a' }, answerText(st, r)));
        if (st.type === 'photo') DB.get(rk(L.id, i)).then((d) => { if (d) item.append(el('img', { src: d, class: 'rec-photo', alt: '照片' })); }).catch(() => {});
        items.push(item);
      });
      if (items.length) { any = true; box.append(el('h3', null, L.id === 0 ? '序章' : `第 ${L.id} 關・${L.title}`), ...items); }
    });
    if (!any) box.append(el('p', { class: 'small-note' }, '還沒有紀錄。完成開放題或拍照後，會出現在這裡。'));
    return box;
  }

  /* ---------- 老師專區 ---------- */
  function teacherGate() {
    const inp = el('input', { class: 'inp big-inp code', type: 'password', inputmode: 'numeric', placeholder: '老師密碼', autocomplete: 'off',
      onkeydown: (e) => { if (e.key === 'Enter') go(); } });
    const msg = el('p', { class: 'msg' });
    function go() { if (inp.value === TEACHER_CODE) teacherPanel(); else { msg.textContent = '密碼錯誤'; inp.value = ''; } }
    openOverlay([closeBtn(), el('h2', null, '👩‍🏫 老師專區'), inp, msg, el('button', { class: 'btn primary big', onclick: go }, '進入')], 'teacher-panel');
    later(() => inp.focus(), 100);
  }
  function teacherPanel() {
    const L = LEVELS[S.level];
    const st = L.steps[S.step];
    const canSkip = !onHome && S.phase === 'play' && st && TASK_TYPES.has(st.type) && view === null;
    const sel = el('select', { class: 'inp' }, LEVELS.map((x, i) => el('option', { value: i, selected: i === S.level ? true : null }, x.id === 0 ? '序章' : `${lvName(x)} ${x.title}`)));
    let solvedCount = 0; let wrongTotal = 0;
    eachTask((_, __, ___, r) => { if (r && r.done) solvedCount++; if (r) wrongTotal += r.wrong || 0; });
    openOverlay([closeBtn(), el('h2', null, '👩‍🏫 老師專區'),
      statusLine(),
      el('div', { class: 't-info' },
        el('p', null, `組別：${S.group ? `第 ${S.group.no} 組 ${S.group.name || ''}` : '尚未報到'}`),
        el('p', null, `進度：${S.phase === 'done' ? '已完成' : lvName(L) + `（${{ go: '前往中', title: '抵達', play: `第 ${S.step + 1} 步`, reward: '領取道具', setup: '報到' }[S.phase] || ''}）`}`),
        el('p', null, `完成題目 ${solvedCount} 題・累計答錯 ${wrongTotal} 次`),
        S.started && el('p', null, `開始時間：${fmtTime(S.started)}`)),
      canSkip && el('button', { class: 'btn big', onclick: () => {
        const r = recOf(L.id, S.step);
        r.done = true; r.skipped = true; r.at = Date.now();
        if (st.type === 'multitext') { S.skillsRevealed = true; if (st.grantSkill != null && !S.skills.includes(st.grantSkill)) S.skills.push(st.grantSkill); }
        save(); closeOverlay(); next();
      } }, `⏭ 讓這組通過目前題目`),
      el('div', { class: 't-row' }, sel, el('button', { class: 'btn', onclick: () => {
        if (!confirm('確定要跳到這一關嗎？之前關卡的道具會自動發給這組。')) return;
        const lv = +sel.value;
        S.level = lv; S.step = 0; view = null;
        S.phase = lv === 0 ? 'play' : (LEVELS[lv].go ? 'go' : 'title');
        if (!S.group) S.group = { no: 0, name: '測試', members: '' };
        grantRewardsBefore(lv);
        save(); onHome = false; closeOverlay(); render();
      } }, '跳到這一關')),
      el('button', { class: 'btn big', onclick: () => { afterSetup = S.phase === 'setup' ? null : S.phase; S.phase = 'setup'; onHome = false; closeOverlay(); render(); } }, '✏️ 修改組別資料'),
      el('button', { class: 'btn big', onclick: exportRecords }, '📤 匯出這組的紀錄（含照片）'),
      el('button', { class: 'btn danger big', onclick: async () => {
        if (!confirm('確定要清除這台 iPad 上的所有遊戲紀錄和照片嗎？')) return;
        if (!confirm('真的要清除嗎？清除後無法復原！建議先匯出紀錄。')) return;
        try { await DB.clear(); } catch (e) { /* ignore */ }
        localStorage.removeItem(KEY);
        S = fresh(); view = null; onHome = true; closeOverlay(); render();
      } }, '🗑 重新開始（清除所有紀錄）'),
      el('p', { class: 'small-note' }, `老師密碼可在 data.js 修改。版本 ${self.PRECACHE_VERSION || 'dev'}`)], 'teacher-panel');
  }

  async function exportRecords() {
    let photos = {};
    try { photos = await DB.all(); } catch (e) { /* ignore */ }
    const g = S.group || {};
    let h = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>湯守者紀錄 第${esc(g.no)}組</title>
<style>body{font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;max-width:820px;margin:auto;padding:16px;color:#3b2a1a;background:#fbf6ec}h1{margin:0 0 4px}h2{border-bottom:2px solid #d9a441;padding-bottom:4px;margin-top:28px}.q{font-weight:600;margin:14px 0 4px;white-space:pre-line}.a{white-space:pre-line;background:#fff;border:1px solid #e3d5bb;border-radius:8px;padding:8px 12px;margin:0}.m{color:#8a7356;font-size:13px}img{max-width:100%;border-radius:8px;margin-top:6px}</style>
<h1>湯守者紀錄・第 ${esc(g.no)} 組 ${esc(g.name)}</h1><p class="m">組員：${esc(g.members) || '（未填）'}<br>開始：${esc(fmtTime(S.started))}　完成：${esc(fmtTime(S.finished)) || '尚未完成'}<br>道具：${S.props.map((k) => PROPS[k].name).join('、') || '無'}</p>`;
    if (S.oath) h += `<p><b>湯守盟約：</b>「${esc(S.oath)}」</p>`;
    let lastLv = -1;
    eachTask((L, st, i, r) => {
      if (L.id !== lastLv) { h += `<h2>${L.id === 0 ? '序章' : `第 ${L.id} 關・${esc(L.title)}`}</h2>`; lastLv = L.id; }
      h += `<p class="q">${esc(st.q)}</p>`;
      if (!r || !r.done) { h += '<p class="a m">（尚未完成）</p>'; return; }
      h += `<p class="a">${esc(answerText(st, r))}</p><p class="m">答錯 ${r.wrong || 0} 次・看提示 ${r.hints || 0} 次・${esc(fmtTime(r.at))}</p>`;
      const ph = photos[rk(L.id, i)];
      if (ph) h += `<img src="${ph}" alt="照片">`;
    });
    h += '</html>';
    const fname = `湯守者紀錄_第${g.no || 0}組.html`;
    const blob = new Blob([h], { type: 'text/html' });
    try {
      const file = new File([blob], fname, { type: 'text/html' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: fname }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = el('a', { href: URL.createObjectURL(blob), download: fname });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------- 啟動 ---------- */
  // 本機開發時（localhost）不啟用離線快取，方便修改；網址加 ?sw=1 可以測試離線功能
  const devHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]sw=1/.test(location.search);
  if ('serviceWorker' in navigator) {
    if (devHost) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    else navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$ov.hidden) closeOverlay(); });
  if (devHost && location.hash === '#play' && S.group) onHome = false;
  const jm = devHost && location.hash.match(/^#jump=(\d+),(\d+)(?:,(\w+))?(?:,(\w+))?/);
  if (jm) {
    const lv = idxOf(+jm[1]);
    S = Object.assign(fresh(), { phase: jm[3] || 'play', level: lv, step: +jm[2], group: { no: 3, name: '測試小隊', members: '王小明、李小華' }, started: Date.now() - 3600e3 });
    grantRewardsBefore(lv);
    if (jm[3] === 'done') { grantRewardsBefore(99); S.skills = [0, 1, 2]; S.skillsRevealed = true; S.finished = Date.now(); S.oath = '我願意傾聽土地的故事，把北投的記憶告訴下一個人。'; }
    onHome = false;
    if (jm[4] === 'bag') setTimeout(() => openBag(), 50);
    if (jm[4] === 'map') setTimeout(() => openMap(), 50);
  }
  if (devHost) {
    // 開發測試用：jump(關卡, 步驟, 階段, 其他狀態)
    window.jump = (id, step, phase = 'play', extra = {}) => {
      const level = idxOf(id);
      const s = Object.assign(fresh(), { phase, level, step, group: { no: 3, name: '測試小隊', members: '王小明、李小華' }, started: Date.now() - 3600e3 }, extra);
      s.props = extra.props || LEVELS.slice(0, level).filter((L) => L.reward && L.reward.prop).map((L) => L.reward.prop);
      s.skills = extra.skills || LEVELS.slice(0, level).filter((L) => L.reward && L.reward.skill != null).map((L) => L.reward.skill);
      localStorage.setItem(KEY, JSON.stringify(s));
      location.hash = 'play';
      location.reload();
    };
  }
  render();
})();
