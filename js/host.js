/* More or Less Party - host (TV) logic. The host is the single source of truth; phones are thin clients that only
 * ever receive what they are allowed to see (never another player's secret estimate before it is revealed). */
(function () {
  'use strict';
  const SC = window.MOLScore, Snd = window.MOLSound, P = SC.POINTS;
  const params = new URLSearchParams(location.search);
  const FAST = params.has('fast') ? Math.max(0.05, parseFloat(params.get('fast')) || 0.25) : 1; // test helper: shortens pauses (not answer timers)
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#ff6b81', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac', '#a9e34b', '#9775fa'];
  const EMOJI = ['🦊', '🐼', '🐸', '🐙', '🦉', '🐯', '🐧', '🦄', '🐨', '🦁'];
  const MAX_PLAYERS = 10;
  const MODES = {
    mol: { icon: '⬆️', title: 'More or Less', desc: 'Is the true answer MORE or LESS than the reference?', rules: 'A reference number appears. Is the true answer <b>MORE</b> or <b>LESS</b>? Right call: <b>+' + P.MOL_CORRECT + '</b>.' },
    closest: { icon: '🎯', title: 'Closest Wins', desc: 'Secret estimates - nearest to the truth scores.', rules: 'Type a secret estimate. Closest: <b>3 / 2 / 1</b> points (ties share). Within 0.5 %: <b>+' + P.EXACT_BONUS + ' bonus</b>.' },
    chain: { icon: '🔗', title: 'Chain Reaction', desc: 'Estimate, then bet MORE/LESS on the previous estimate.', rules: 'Everyone locks a secret estimate. Then each estimate is revealed and the <b>next player bets</b> if the TRUE answer is MORE or LESS (+' + P.CHAIN_BET + '). The first player judges the last one. Closest estimates: <b>3 / 2 / 1</b>, exact <b>+' + P.EXACT_BONUS + '</b>.' },
    mixed: { icon: '🔀', title: 'Mixed', desc: 'Rotates the three modes, question after question.', rules: 'The three modes take turns: <b>More or Less → Closest Wins → Chain Reaction</b> → …' }
  };
  const MODE_ORDER = ['mol', 'closest', 'chain'];
  const COUNTS = [5, 10, 15, 20], TIMERS = [15, 20, 30, 45], DIFFS = { any: [1, 2, 3], easy: [1, 2], hard: [2, 3] }, DIFF_NAMES = { any: 'Any', easy: 'Easy', hard: 'Hard' };
  const BET_TIME = 15000;

  /* ---------- stage scaling ---------- */
  function fit() { const s = Math.min(innerWidth / 1920, innerHeight / 1080); const st = $('#stage'); st.style.transform = 'scale(' + s + ')'; st.style.left = (innerWidth - 1920 * s) / 2 + 'px'; st.style.top = (innerHeight - 1080 * s) / 2 + 'px'; }
  addEventListener('resize', fit); fit();

  /* ---------- formatting ---------- */
  function fmtVal(v, q) {
    if (v == null || !isFinite(v)) return '–';
    if (q.unit === 'year') return String(Math.round(v));
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: Math.max(q.precision || 0, 2) });
  }
  function unitTxt(q) { return q.unit === 'year' ? '' : q.unit; }
  function fmtU(v, q) { const u = unitTxt(q); return fmtVal(v, q) + (u ? (/^[°%]/.test(u) ? '' : ' ') + u : ''); }

  /* ---------- persistent settings & played questions ---------- */
  const SEEN_KEY = 'molparty.seen.v1', SET_KEY = 'molparty.settings.v1';
  let BANK = null, seen = new Set((() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (e) { return []; } })());
  const saveSeen = () => localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  const settings = Object.assign({ mode: 'mixed', count: 10, timer: 20, diff: 'any', cats: null }, (() => { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch (e) { return {}; } })());
  if (!MODES[settings.mode]) settings.mode = 'mixed'; if (!COUNTS.includes(settings.count)) settings.count = 10; if (!TIMERS.includes(settings.timer)) settings.timer = 20; if (!DIFFS[settings.diff]) settings.diff = 'any';
  const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));

  /* ---------- state ---------- */
  const S = { phase: 'lobby', players: new Map(), conn2pid: new Map(), pid2conn: new Map(), game: null, paused: false, pending: null, timerInt: null };
  window.__mol = S; // debug / automated tests

  /* ---------- networking ---------- */
  const savedCode = sessionStorage.getItem('molparty.room');
  const net = window.MOLNet.createHost(savedCode, {
    onOpen(code) { sessionStorage.setItem('molparty.room', code); showJoin(code); },
    onMessage(cid, m) { try { handle(cid, m); } catch (e) { console.error(e); } },
    onClose(cid) { const pid = S.conn2pid.get(cid); S.conn2pid.delete(cid); if (pid && S.pid2conn.get(pid) === cid) { S.pid2conn.delete(pid); const p = S.players.get(pid); if (p) p.connected = false; onPlayersChanged(); } },
    onError(t) { toast(t); }
  });
  function joinUrl(code) { const u = new URL('play.html', location.href); u.search = ''; u.hash = ''; u.searchParams.set('room', code); if (net.transport === 'local') u.searchParams.set('transport', 'local'); return u.toString(); }
  function showJoin(code) {
    $('#roomCode').textContent = code;
    const url = joinUrl(code), base = new URL('play.html', location.href); base.search = '';
    $('#joinUrl').textContent = base.host + base.pathname;
    try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('#qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } catch (e) { $('#qr').textContent = url; }
    $('#qr').dataset.url = url;
    const h = location.hostname; let warn = '';
    if (location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') warn = '⚠️ Opened from "' + (h || 'file') + '": phones cannot reach that address. For a real evening, open the GitHub Pages version (see README).';
    if (net.transport === 'local') warn = '🧪 Test mode (transport=local): players must be tabs of this same browser.';
    $('#netWarn').textContent = warn;
  }
  function sendTo(pid, msg) { const cid = S.pid2conn.get(pid); if (cid) net.send(cid, msg); }
  function sendView(p) { sendTo(p.id, { t: 'view', v: viewFor(p) }); }
  function sendAllViews() { S.players.forEach(p => { if (p.connected) sendView(p); }); }

  function handle(cid, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') return onHello(cid, m);
    const pid = S.conn2pid.get(cid); const p = pid && S.players.get(pid); if (!p) return;
    p.lastSeen = Date.now(); if (!p.connected) { p.connected = true; onPlayersChanged(); }
    if (m.t === 'answer') onAnswer(p, m);
    else if (m.t === 'bet') onBet(p, m);
    else if (m.t === 'ping') net.send(cid, { t: 'pong' });
  }
  function onHello(cid, m) {
    const name = String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) return net.send(cid, { t: 'error', msg: 'Please enter a name.' });
    let p = m.id && S.players.get(m.id);
    if (!p) {
      const same = [...S.players.values()].find(x => x.name.toLowerCase() === name.toLowerCase());
      if (same) {
        // a connected player who pinged recently keeps the name; a silent/disconnected one is taken over (keeps the score)
        if (same.connected && S.pid2conn.get(same.id) && Date.now() - (same.lastSeen || 0) < 10000) return net.send(cid, { t: 'error', msg: 'The name "' + name + '" is already taken - pick another one.' });
        p = same;
      }
    }
    if (!p) {
      if (S.players.size >= MAX_PLAYERS) return net.send(cid, { t: 'error', msg: 'The game is full (' + MAX_PLAYERS + ' players max).' });
      const used = new Set([...S.players.values()].map(x => x.slot)); let slot = 0; while (used.has(slot)) slot++;
      p = { id: m.id && /^[a-z0-9]{6,24}$/i.test(m.id) ? m.id : 'p' + Math.random().toString(36).slice(2, 10), name, slot, color: COLORS[slot % COLORS.length], emoji: EMOJI[slot % EMOJI.length], score: 0, connected: true };
      S.players.set(p.id, p); Snd.join();
    }
    const oldCid = S.pid2conn.get(p.id); if (oldCid && oldCid !== cid) { S.conn2pid.delete(oldCid); net.drop(oldCid); }
    p.connected = true; p.name = name; p.lastSeen = Date.now();
    S.conn2pid.set(cid, p.id); S.pid2conn.set(p.id, cid);
    net.send(cid, { t: 'welcome', id: p.id, name: p.name, color: p.color, emoji: p.emoji });
    sendView(p); onPlayersChanged();
  }
  const pub = (p) => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji });
  const avatar = (p, cls) => '<span class="avatar ' + (cls || '') + '" style="background:' + p.color + '" title="' + esc(p.name) + '">' + p.emoji + '</span>';
  const playersList = () => [...S.players.values()].sort((a, b) => a.slot - b.slot);
  const compRank = (rk, p) => rk.findIndex(x => x.score === p.score) + 1; // ties share a rank (1, 1, 3)
  const ranked = () => playersList().slice().sort((a, b) => b.score - a.score || a.slot - b.slot);

  /* ---------- lobby ---------- */
  function poolFor() { const d = DIFFS[settings.diff]; return BANK.questions.filter(q => settings.cats.includes(q.category) && d.includes(q.difficulty)); }
  function seg(el, values, cur, label, onPick, attr) {
    el.innerHTML = ''; values.forEach(v => { const b = document.createElement('button'); b.textContent = label(v); b.dataset[attr] = v; b.className = cur === v ? 'on' : ''; b.onclick = () => { onPick(v); saveSettings(); buildLobby(); }; el.appendChild(b); });
  }
  function buildLobby() {
    if (!BANK) return;
    const mp = $('#modePicks'); mp.innerHTML = '';
    Object.keys(MODES).forEach(id => { const m = MODES[id], b = document.createElement('button'); b.className = 'mpick' + (settings.mode === id ? ' on' : ''); b.dataset.mode = id; b.innerHTML = '<div class="ic">' + m.icon + '</div><div class="t">' + m.title + '</div><div class="d">' + m.desc + '</div>'; b.onclick = () => { settings.mode = id; saveSettings(); buildLobby(); }; mp.appendChild(b); });
    seg($('#countPick'), COUNTS, settings.count, String, v => settings.count = v, 'count');
    seg($('#timerPick'), TIMERS, settings.timer, v => v + ' s', v => settings.timer = v, 'timer');
    seg($('#diffPick'), Object.keys(DIFFS), settings.diff, v => DIFF_NAMES[v], v => settings.diff = v, 'diff');
    const cp = $('#catPicks'); cp.innerHTML = '';
    BANK.categories.forEach(c => {
      const n = BANK.questions.filter(q => q.category === c && DIFFS[settings.diff].includes(q.difficulty)).length, nNew = BANK.questions.filter(q => q.category === c && DIFFS[settings.diff].includes(q.difficulty) && !seen.has(q.id)).length;
      const b = document.createElement('button'); b.className = 'cpick' + (settings.cats.includes(c) ? ' on' : ''); b.dataset.cat = c; b.innerHTML = esc(c) + '<span class="n">' + nNew + '/' + n + '</span>';
      b.onclick = () => { const i = settings.cats.indexOf(c); if (i >= 0) settings.cats.splice(i, 1); else settings.cats.push(c); saveSettings(); buildLobby(); }; cp.appendChild(b);
    });
    const played = BANK.questions.filter(q => seen.has(q.id)).length;
    $('#seenInfo').textContent = played ? played + ' of ' + BANK.questions.length + ' questions already played - they will be avoided.' : BANK.questions.length + ' questions in the bank, none played yet.';
    $('#resetSeen').style.display = played ? '' : 'none';
    updateStart();
  }
  function updateStart() {
    if (!BANK) return;
    const n = [...S.players.values()].filter(p => p.connected).length, pool = poolFor().length;
    const ok = n >= 2 && pool > 0;
    $('#startBtn').disabled = !ok;
    $('#startHint').textContent = !pool ? 'Pick at least one category.' : n === 0 ? 'Waiting for players to join…' : n === 1 ? '1 player - at least 2 needed.' :
      n + ' players · ' + MODES[settings.mode].title + ' · ' + Math.min(settings.count, pool) + ' questions' + (pool < settings.count ? ' (only ' + pool + ' match)' : '');
  }
  function renderLobbyPlayers() {
    const ps = playersList(); $('#pCount').textContent = ps.length;
    const box = $('#lobbyPlayers');
    if (!ps.length) { box.innerHTML = '<div class="empty">Nobody yet - scan the QR code!</div>'; return; }
    box.innerHTML = ps.map(p => '<div class="pchip' + (p.connected ? '' : ' off') + '">' + avatar(p) + '<span>' + esc(p.name) + '</span><button class="kick" data-kick="' + p.id + '" title="Remove">✕</button></div>').join('');
    box.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => { const id = b.dataset.kick; sendTo(id, { t: 'kicked' }); const cid = S.pid2conn.get(id); if (cid) { S.conn2pid.delete(cid); net.drop(cid); } S.pid2conn.delete(id); S.players.delete(id); onPlayersChanged(); });
  }
  function onPlayersChanged() {
    if (S.phase === 'lobby') { renderLobbyPlayers(); updateStart(); }
    else if (S.phase === 'question') { renderAnswered(); checkAllAnswered(); }
    else if (S.phase === 'chain') checkBettorGone();
  }
  $('#resetSeen').onclick = () => { if (!confirm('Forget which questions were already played? They may come up again.')) return; seen.clear(); saveSeen(); buildLobby(); toast('Played questions reset'); };
  $('#startBtn').onclick = () => { Snd.unlock(); startGame(); };

  /* ---------- scheduler (auto-advance, pausable) ---------- */
  function schedule(fn, ms) { S.pending = { fn, at: Date.now() + ms * FAST }; }
  setInterval(() => { if (S.pending && !S.paused && Date.now() >= S.pending.at) { const f = S.pending.fn; S.pending = null; f(); } }, 100);
  function next() {
    if (S.phase === 'question') return closeAnswers();
    if (S.phase === 'chain' && S.game.chain.waiting) return resolveBet(null);
    if (S.pending) { const f = S.pending.fn; S.pending = null; f(); }
  }
  function setPaused(v) { S.paused = v; $('#cPause').textContent = v ? '▶' : '⏸'; $('#pausedBadge').classList.toggle('hidden', !v); if (!v && S.pending) S.pending.at = Math.max(S.pending.at, Date.now() + 600); }

  /* ---------- game flow ---------- */
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function pickQuestions(n) {
    const pool = poolFor(), fresh = shuffle(pool.filter(q => !seen.has(q.id))), old = shuffle(pool.filter(q => seen.has(q.id)));
    if (fresh.length < n && old.length) toast('Not enough new questions - ' + Math.min(old.length, n - fresh.length) + ' will be repeats. Use "Reset played questions" to start over.');
    return fresh.concat(old).slice(0, n);
  }
  function startGame() {
    const qs = pickQuestions(settings.count); if (!qs.length) return;
    const list = qs.map((q, i) => ({ q, mode: settings.mode === 'mixed' ? MODE_ORDER[i % 3] : settings.mode }));
    S.players.forEach(p => { p.score = 0; });
    S.game = { uid: Date.now().toString(36),  list, i: -1, chainCount: 0, answers: new Map(), results: null, chain: null, time: settings.timer * 1000 };
    document.body.classList.remove('in-lobby');
    $('#lobby').classList.add('hidden'); $('#game').classList.remove('hidden');
    gameIntro();
  }
  const cur = () => S.game.list[S.game.i];
  const qid = () => S.game.uid + '-q' + S.game.i;
  function gameIntro() {
    S.phase = 'intro';
    const m = MODES[settings.mode];
    $('#game').innerHTML = '<div class="center-col"><div class="round-badge">' + S.game.list.length + ' questions · ' + settings.timer + ' s to answer</div><div class="round-icon">' + m.icon + '</div><div class="big-title">' + m.title + '</div><div class="rules">' + m.rules + '</div></div>';
    Snd.whoosh(); sendAllViews();
    schedule(askQuestion, 6000);
  }
  function header(timer) {
    const g = S.game, c = cur(), m = MODES[c.mode];
    return '<div class="ghead"><span class="rname">Question ' + (g.i + 1) + '<span class="qnum"> / ' + g.list.length + '</span></span><span class="mode-badge mode-' + c.mode + '">' + m.icon + ' ' + m.title + '</span><span class="cat-badge">' + esc(c.q.category) + '</span><span class="sp"></span><span id="ansCount" class="ans-count"></span></div>' +
      (timer ? '<div class="timer"><div id="tbar"></div></div><div id="tnum" class="tnum"></div>' : '');
  }
  function startTimer(ms, onEnd) {
    const g = S.game, end = Date.now() + ms; g.endT = end; g.timerMs = ms;
    clearInterval(S.timerInt); let lastSec = -1;
    S.timerInt = setInterval(() => {
      const left = Math.max(0, end - Date.now()), sec = Math.ceil(left / 1000);
      const tn = $('#tnum'); if (tn) { tn.textContent = sec; tn.classList.toggle('low', sec <= 5); }
      const tb = $('#tbar'); if (tb) tb.style.width = (left / ms * 100) + '%';
      if (sec !== lastSec && sec <= 5 && sec > 0) Snd.tick(); lastSec = sec;
      if (left <= 0) { clearInterval(S.timerInt); S.timerInt = null; onEnd(); }
    }, 100);
  }
  function askQuestion() {
    const g = S.game; g.i++;
    if (g.i >= g.list.length) return finalReveal();
    const c = cur(); seen.add(c.q.id); saveSeen();
    c.ref = c.mode === 'mol' ? SC.makeReference(c.q) : null;
    g.answers = new Map(); g.results = null; g.chain = null;
    S.phase = 'question';
    const q = c.q;
    let h = header(true);
    if (c.mode === 'mol') h += '<div class="qbig">' + esc(q.text) + '</div><div class="ref-card"><div class="lb">Reference</div><div class="v">' + esc(fmtU(c.ref, q)) + '</div></div><div class="ml-hint"><div class="more">▲ MORE</div><div class="less">▼ LESS</div></div>';
    else h += '<div class="qbig">' + esc(q.text) + (unitTxt(q) ? '<span class="unit">Answer in ' + esc(unitTxt(q)) + '</span>' : q.unit === 'year' ? '<span class="unit">Answer with a year</span>' : '') + '</div><div class="est-hint"><span class="kp">🤫📱</span>Type your secret estimate on your phone' + (c.mode === 'chain' ? '<br><span style="font-size:32px">then get ready to bet MORE or LESS on someone else\'s estimate!</span>' : '') + '</div>';
    $('#game').innerHTML = h;
    startTimer(g.time, closeAnswers);
    renderAnswered(); Snd.question(); sendAllViews();
  }
  function renderAnswered() {
    const el = $('#ansCount'); if (!el || !S.game) return;
    const ps = playersList();
    el.innerHTML = ps.map(p => avatar(p, (S.game.answers.has(p.id) ? 'done' : '') + (p.connected ? '' : ' off'))).join('') + '<span style="margin-left:10px">' + S.game.answers.size + '/' + ps.filter(p => p.connected || S.game.answers.has(p.id)).length + ' answered</span>';
  }
  function onAnswer(p, m) {
    const g = S.game; if (S.phase !== 'question' || !g || m.qid !== qid() || g.answers.has(p.id)) return;
    const c = cur();
    if (c.mode === 'mol') { if (m.choice !== 'more' && m.choice !== 'less') return; g.answers.set(p.id, { choice: m.choice, t: Date.now() }); }
    else {
      const v = typeof m.value === 'string' ? parseFloat(m.value) : m.value;
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e13) return;
      const f = Math.pow(10, Math.max(c.q.precision || 0, 2)); g.answers.set(p.id, { value: Math.round(v * f) / f, t: Date.now() });
    }
    Snd.lock(); renderAnswered(); sendView(p); checkAllAnswered();
  }
  function checkAllAnswered() {
    if (S.phase !== 'question') return;
    const active = playersList().filter(p => p.connected);
    if (active.length && active.every(p => S.game.answers.has(p.id))) { clearInterval(S.timerInt); S.timerInt = null; const id = qid(); setTimeout(() => { if (S.phase === 'question' && qid() === id) closeAnswers(); }, 500); }
  }
  function closeAnswers() {
    if (S.phase !== 'question') return;
    clearInterval(S.timerInt); S.timerInt = null;
    const c = cur();
    if (c.mode === 'chain') return startChain();
    revealResults();
  }

  /* ---------- chain reaction ---------- */
  function startChain() {
    const g = S.game, c = cur();
    const ids = playersList().map(p => p.id);
    const order = SC.chainOrder(ids, g.chainCount++).filter(id => g.answers.has(id));
    g.chain = { order, bets: SC.chainBets(order).map(b => ({ bettor: b.bettor, target: b.target, choice: null, done: false })), step: -1, revealed: new Set(), waiting: false };
    if (g.chain.bets.length === 0) { if (order[0]) g.chain.revealed.add(order[0]); return revealResults(); }
    S.phase = 'chain';
    chainStep();
  }
  function chainStep() {
    const g = S.game, ch = g.chain; ch.step++;
    if (ch.step >= ch.bets.length) return revealResults();
    const b = ch.bets[ch.step]; ch.revealed.add(b.target); ch.waiting = true;
    startTimer(BET_TIME, () => resolveBet(null));
    renderChain(); Snd.pop(); sendAllViews();
    checkBettorGone();
  }
  function checkBettorGone() {
    const g = S.game; if (S.phase !== 'chain' || !g.chain.waiting) return;
    const b = g.chain.bets[g.chain.step], p = S.players.get(b.bettor);
    if (!p || !p.connected) { const step = g.chain.step; setTimeout(() => { if (S.phase === 'chain' && g.chain.step === step && g.chain.waiting) { const pp = S.players.get(b.bettor); if (!pp || !pp.connected) resolveBet(null); } }, 3000); }
  }
  function onBet(p, m) {
    const g = S.game; if (S.phase !== 'chain' || !g || m.qid !== qid() || !g.chain.waiting) return;
    const b = g.chain.bets[g.chain.step]; if (b.bettor !== p.id || m.step !== g.chain.step) return;
    if (m.choice !== 'more' && m.choice !== 'less') return;
    resolveBet(m.choice);
  }
  function resolveBet(choice) {
    const g = S.game, ch = g.chain; if (!ch.waiting) return;
    clearInterval(S.timerInt); S.timerInt = null;
    const b = ch.bets[ch.step]; b.choice = choice; b.done = true; ch.waiting = false;
    renderChain(); choice ? Snd.lock() : Snd.tick(); sendAllViews();
    schedule(chainStep, 2200);
  }
  function renderChain() {
    const g = S.game, c = cur(), q = c.q, ch = g.chain, b = ch.bets[ch.step];
    const P_ = (id) => S.players.get(id), many = ch.order.length > 6;
    let row = '<div class="chain-row' + (many ? ' many' : '') + '">';
    ch.order.forEach((id, i) => {
      const p = P_(id), shown = ch.revealed.has(id), bet = ch.bets.find(x => x.target === id);
      const cls = (shown ? ' shown' : '') + (b.target === id ? ' target' : '') + (b.bettor === id && ch.waiting ? ' bettor' : '');
      row += '<div class="ccard' + cls + '">' + avatar(p) + '<div class="nm">' + esc(p.name) + '</div><div class="est">' + (shown ? esc(fmtVal(g.answers.get(id).value, q)) : '🔒 ?') + '</div></div>';
      if (i < ch.order.length - 1) { const bb = ch.bets.find(x => x.target === id); row += '<div class="clink">→' + (bb && bb.done ? betChip(bb.choice) : '') + '</div>'; }
    });
    row += '</div>';
    const last = ch.bets[ch.bets.length - 1];
    const loop = ch.order.length > 2 ? '<div class="chain-loop">↩ ' + esc(P_(last.bettor).name) + ' will judge ' + esc(P_(last.target).name) + '\'s estimate at the end' + (last.done ? ': ' + betChip(last.choice) : '') + '</div>' : '';
    const tp = P_(b.target), bp = P_(b.bettor);
    const ask = ch.waiting ? '<div class="chain-ask">' + avatar(bp) + ' <b>' + esc(bp.name) + '</b>, is the TRUE answer MORE or LESS than<br>' + esc(tp.name) + '\'s estimate <span class="tv">' + esc(fmtU(g.answers.get(b.target).value, q)) + '</span>?</div>'
      : '<div class="chain-ask"><b>' + esc(bp.name) + '</b> says <span class="said">' + (b.choice ? betChip(b.choice) : '<span class="chip chip-none">no bet ⌛</span>') + '</span></div>';
    $('#game').innerHTML = header(ch.waiting) + '<div class="qsmall">' + esc(q.text) + (unitTxt(q) ? '<span class="unit">in ' + esc(unitTxt(q)) + '</span>' : '') + '</div>' + row + loop + ask;
    const el = $('#ansCount'); if (el) el.innerHTML = '<span>🔗 Bet ' + (ch.step + 1) + ' / ' + ch.bets.length + '</span>';
  }
  const betChip = (c) => c === 'more' ? '<span class="chip chip-more">▲ MORE</span>' : c === 'less' ? '<span class="chip chip-less">▼ LESS</span>' : '<span class="chip chip-none">–</span>';

  /* ---------- results ---------- */
  function revealResults() {
    const g = S.game, c = cur(), q = c.q; S.phase = 'reveal';
    const res = new Map(), ps = playersList();
    if (c.mode === 'mol') {
      ps.forEach(p => { const a = g.answers.get(p.id); const j = SC.judgeBet(a ? a.choice : null, c.ref, q.answer); res.set(p.id, { choice: a ? a.choice : null, correct: j.correct, push: !!j.push, points: j.points }); });
    } else {
      const rk = SC.rankClosest(ps.map(p => ({ id: p.id, value: g.answers.has(p.id) ? g.answers.get(p.id).value : null })), q);
      ps.forEach(p => { const r = rk.get(p.id); res.set(p.id, { value: r.value, rank: r.rank, rankPts: r.points, exact: r.exact, bonus: r.bonus, betPts: 0, bet: null, points: r.points + r.bonus }); });
      if (c.mode === 'chain' && g.chain) g.chain.bets.forEach(b => {
        const j = SC.judgeChainBet(b.choice, g.answers.get(b.target).value, q.answer), r = res.get(b.bettor);
        r.bet = { target: b.target, choice: b.choice, correct: j.correct, push: !!j.push }; r.betPts = j.points; r.points += j.points;
      });
    }
    ps.forEach(p => { const r = res.get(p.id); p.score += r.points; r.total = p.score; });
    g.results = res;
    renderReveal(); Snd.reveal(); sendAllViews();
    const n = g.list.length, k = g.i + 1;
    const showStand = k < n && (n === 5 ? k === 3 : k % 5 === 0);
    schedule(() => showStand ? standings() : askQuestion(), c.mode === 'chain' ? 10000 : 8000);
  }
  function renderReveal() {
    const g = S.game, c = cur(), q = c.q, ps = playersList();
    const src = '<div class="src">Source: ' + esc(q.source.replace(/^https?:\/\//, '').replace(/_/g, ' ')) + (q.note ? ' · ' + esc(q.note) : '') + '</div>';
    let h = header(false);
    if (c.mode === 'mol') {
      const truth = q.answer > c.ref ? 'more' : 'less';
      h += '<div class="qsmall">' + esc(q.text) + '</div><div class="answer-card"><div class="lb">Correct answer</div><div class="v">' + esc(fmtU(q.answer, q)) + '</div><div class="refl">Reference was ' + esc(fmtU(c.ref, q)) + ' → it was ' + betChip(truth) + '</div>' + src + '</div><div class="res-list">' +
        ps.map((p, i) => { const r = g.results.get(p.id); return '<div class="rrow ' + (r.correct ? 'ok' : 'ko') + '" style="animation-delay:' + (i * .08) + 's">' + avatar(p) + '<span class="nm">' + esc(p.name) + '</span>' + betChip(r.choice) + '<span class="pts' + (r.points ? '' : ' zero') + '">+' + r.points + '</span></div>'; }).join('') + '</div>';
    } else if (c.mode === 'closest') {
      const sorted = ps.slice().sort((a, b) => (g.results.get(a.id).rank || 99) - (g.results.get(b.id).rank || 99) || a.slot - b.slot);
      h += '<div class="qsmall">' + esc(q.text) + '</div><div class="answer-card" style="animation-delay:' + (ps.length * .25 + .4) + 's"><div class="lb">Correct answer</div><div class="v">' + esc(fmtU(q.answer, q)) + '</div>' + src + '</div><div class="res-list">' +
        sorted.map((p, i) => { const r = g.results.get(p.id); return '<div class="rrow" style="animation-delay:' + (i * .25) + 's"><span class="rk' + (r.rank && r.rank <= 3 ? ' r' + r.rank : '') + '">' + (r.rank || '–') + '</span>' + avatar(p) + '<span class="nm">' + esc(p.name) + '<span class="sub">' + (r.value == null ? 'no answer' : 'off by ' + esc(fmtVal(Math.abs(r.value - q.answer), q))) + '</span></span><span class="val">' + esc(fmtVal(r.value, q)) + (r.exact ? '<span class="exact">EXACT!</span>' : '') + '</span><span class="pts' + (r.points ? '' : ' zero') + '">+' + r.points + '</span></div>'; }).join('') + '</div>';
    } else {
      const many = ps.length > 6;
      h += '<div class="reveal-wide"><div class="qsmall">' + esc(q.text) + '</div><div class="answer-card"><div class="lb">Correct answer</div><div class="v">' + esc(fmtU(q.answer, q)) + '</div>' + src + '</div></div><div class="chain-table' + (many ? ' many' : '') + '"><div class="ctrow head"><span></span><span>Player</span><span>Estimate</span><span>Bet</span><span style="text-align:right">Points</span></div>' +
        ps.map((p, i) => { const r = g.results.get(p.id), b = r.bet, t = b && S.players.get(b.target);
          const betTxt = !b ? '<span class="sub">no bet</span>' : (b.choice ? betChip(b.choice) : '<span class="chip chip-none">⌛</span>') + '<span class="sub">vs ' + esc(t.name) + '</span> ' + (b.push ? '<span class="sub">= exact, no points</span>' : b.correct ? '✅ +' + r.betPts : '❌');
          return '<div class="ctrow" style="animation-delay:' + (i * .12) + 's">' + avatar(p) + '<span>' + esc(p.name) + '</span><span>' + esc(fmtVal(r.value, q)) + (r.rank ? '<span class="sub">#' + r.rank + (r.rankPts ? ' +' + r.rankPts : '') + '</span>' : '') + (r.exact ? '<span class="exact">EXACT +' + r.bonus + '</span>' : '') + '</span><span>' + betTxt + '</span><span class="tot">+' + r.points + '</span></div>'; }).join('') + '</div>';
    }
    $('#game').innerHTML = h;
  }
  function boardRows(ps, opts) {
    const max = Math.max(1, ...ps.map(p => p.score));
    return ps.map((p, i) => '<div class="brow' + (opts && opts.hidden ? ' hide' : '') + (opts && opts.markFirst && i === 0 ? ' first' : '') + '" style="animation-delay:' + (i * 0.08) + 's"><div class="bar" style="width:' + (opts && opts.hidden ? 0 : p.score / max * 100) + '%"></div><span class="rk">#' + compRank(ps, p) + '</span>' + avatar(p) + '<span class="nm">' + esc(p.name) + '</span><span class="sc">' + (opts && opts.hidden ? '' : p.score) + '</span></div>').join('');
  }
  function standings() {
    S.phase = 'standings';
    $('#game').innerHTML = '<div class="center-col"><div class="round-badge">After question ' + (S.game.i + 1) + ' of ' + S.game.list.length + '</div><div class="big-h">Standings</div><div class="board">' + boardRows(ranked(), { markFirst: true }) + '</div></div>';
    Snd.whoosh(); sendAllViews();
    schedule(askQuestion, 7000);
  }
  function finalReveal() {
    S.phase = 'final';
    const rk = ranked();
    $('#game').innerHTML = '<div class="center-col"><div class="big-h">Final results</div><div class="board" id="fboard">' + boardRows(rk, { hidden: true }) + '</div></div>';
    sendAllViews(); Snd.drum();
    const rows = [...document.querySelectorAll('#fboard .brow')]; const max = Math.max(1, ...rk.map(p => p.score));
    let i = rk.length - 1;
    const revealOne = () => {
      if (i < 0) return schedule(podium, 3000);
      const p = rk[i], row = rows[i]; row.classList.remove('hide'); row.style.animation = 'fadeUp .5s both';
      if (i === 0) row.classList.add('first');
      const sc = row.querySelector('.sc'), bar = row.querySelector('.bar');
      requestAnimationFrame(() => { bar.style.width = (p.score / max * 100) + '%'; });
      const t0 = performance.now(), D = 1300 * Math.max(0.3, FAST);
      const tick = (t) => { const u = Math.min(1, (t - t0) / D); sc.textContent = Math.round(p.score * (1 - Math.pow(1 - u, 3))); if (u < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      i === 0 ? Snd.fanfare() : Snd.pop();
      i--;
      schedule(revealOne, i === 0 ? 3000 : 2000);
    };
    schedule(revealOne, 1500);
  }
  function podium() {
    S.phase = 'podium';
    const rk = ranked(), top = [rk[1], rk[0], rk[2]], cls = ['p2', 'p1', 'p3'], num = [2, 1, 3];
    const tiedTop = rk.filter(p => p.score === rk[0].score);
    let h = '<div class="center-col"><div class="big-h">🏆 ' + (tiedTop.length > 1 ? tiedTop.map(p => esc(p.name)).join(' & ') + ' tie!' : esc(rk[0].name) + ' wins!') + '</div><div class="podium">';
    top.forEach((p, i) => { if (!p) return; num[i] = compRank(rk, p); h += '<div class="pod ' + cls[i] + '">' + (num[i] === 1 ? '<div class="crown">👑</div>' : '') + avatar(p) + '<div class="pn">' + esc(p.name) + '</div><div class="ps">' + p.score + ' pts</div><div class="blk">' + num[i] + '</div></div>'; });
    h += '</div>';
    if (rk.length > 3) h += '<div class="others">' + rk.slice(3).map(p => '#' + compRank(rk, p) + ' ' + esc(p.name) + ' - ' + p.score).join(' · ') + '</div>';
    h += '<div class="game-end-btns"><button class="btn primary big" id="againBtn">Play again ↻</button></div></div>';
    $('#game').innerHTML = h;
    $('#againBtn').onclick = backToLobby;
    Snd.fanfare(); confetti(); sendAllViews();
  }
  function backToLobby() {
    S.phase = 'lobby'; S.pending = null; clearInterval(S.timerInt); S.game = null; setPaused(false);
    $('#game').classList.add('hidden'); $('#game').innerHTML = ''; $('#lobby').classList.remove('hidden'); document.body.classList.add('in-lobby');
    stopConfetti(); buildLobby(); renderLobbyPlayers(); sendAllViews();
  }

  /* ---------- views for phones (only what that player may see) ---------- */
  function viewFor(p) {
    const base = { you: pub(p), score: p.score, phase: S.phase }, g = S.game;
    if (S.phase === 'lobby') return Object.assign(base, { screen: 'lobby' });
    const c = g && cur(), q = c && c.q;
    if (S.phase === 'intro') { const m = MODES[settings.mode]; return Object.assign(base, { screen: 'wait', icon: m.icon, text: m.title, sub: 'Get ready - ' + g.list.length + ' questions!' }); }
    const common = () => ({ qid: qid(), qnum: g.i + 1, qof: g.list.length, mode: c.mode, modeTitle: MODES[c.mode].title, text: q.text, unit: q.unit, precision: q.precision || 0, left: Math.max(0, (g.endT || 0) - Date.now()), time: g.timerMs || g.time });
    if (S.phase === 'question') {
      const a = g.answers.get(p.id);
      if (c.mode === 'mol') return Object.assign(base, common(), { screen: 'mol', ref: c.ref, refText: fmtU(c.ref, q), locked: !!a, choice: a ? a.choice : null });
      return Object.assign(base, common(), { screen: 'estimate', locked: !!a, value: a ? a.value : null, valueText: a ? fmtU(a.value, q) : null });
    }
    if (S.phase === 'chain') {
      const ch = g.chain, b = ch.bets[ch.step], mine = g.answers.get(p.id), tp = S.players.get(b.target), bp = S.players.get(b.bettor);
      const myBet = ch.bets.find(x => x.bettor === p.id);
      return Object.assign(base, common(), { screen: 'chain', step: ch.step, steps: ch.bets.length, waiting: ch.waiting, isBettor: b.bettor === p.id, bettor: bp.name, target: tp.name, targetIsMe: b.target === p.id,
        targetText: fmtU(g.answers.get(b.target).value, q), choice: b.choice, myEstimate: mine ? fmtU(mine.value, q) : null, myBetDone: !!(myBet && myBet.done), inChain: ch.order.includes(p.id) });
    }
    if (S.phase === 'reveal') {
      const r = g.results.get(p.id) || { points: 0 };
      const lines = [];
      if (c.mode === 'mol') lines.push(r.choice ? 'You said ' + r.choice.toUpperCase() + ' than ' + fmtU(c.ref, q) + (r.correct ? ' ✅ +' + r.points : ' ❌') : 'No answer ⌛');
      else {
        lines.push(r.value == null ? 'No estimate ⌛' : 'Your estimate: ' + fmtU(r.value, q) + (r.rank ? ' · #' + r.rank + (r.rankPts ? ' +' + r.rankPts : '') : ''));
        if (r.exact) lines.push('EXACT! +' + r.bonus + ' bonus');
        if (c.mode === 'chain' && r.bet) lines.push('Bet ' + (r.bet.choice ? r.bet.choice.toUpperCase() : '- (time out)') + ' vs ' + S.players.get(r.bet.target).name + (r.bet.push ? ' · exact estimate, no points' : r.bet.correct ? ' ✅ +' + r.betPts : ' ❌'));
      }
      return Object.assign(base, { screen: 'result', qid: qid(), answerText: fmtU(q.answer, q), points: r.points, lines, good: r.points > 0, total: p.score });
    }
    if (S.phase === 'standings') { const rk = ranked(); return Object.assign(base, { screen: 'wait', icon: '📊', text: 'Standings on the big screen!', sub: 'You are #' + compRank(rk, p) + ' with ' + p.score + ' pts' }); }
    if (S.phase === 'final') return Object.assign(base, { screen: 'wait', icon: '🥁', text: 'Look at the big screen…', sub: 'Final results are coming!' });
    if (S.phase === 'podium') { const rk = ranked(); const i = rk.findIndex(x => x.score === p.score); return Object.assign(base, { screen: 'final', rank: i + 1, of: rk.length, winner: rk[0] && rk[0].name }); }
    return Object.assign(base, { screen: 'wait', text: '…' });
  }
  S.viewFor = viewFor; // tests

  /* ---------- confetti ---------- */
  let confT = null;
  function confetti() {
    const cv = $('#confetti'); cv.width = 1920; cv.height = 1080; const x = cv.getContext('2d');
    const cols = ['#ffd23f', '#ff6b81', '#4dabf7', '#69db7c', '#da77f2', '#ff922b', '#fff'];
    const Pc = []; for (let i = 0; i < 260; i++) Pc.push({ x: Math.random() * 1920, y: -Math.random() * 1080, vx: (Math.random() - .5) * 4, vy: 3 + Math.random() * 5, r: Math.random() * 6.28, vr: (Math.random() - .5) * .3, w: 10 + Math.random() * 12, h: 6 + Math.random() * 8, c: cols[i % cols.length] });
    const t0 = Date.now();
    const frame = () => {
      x.clearRect(0, 0, 1920, 1080); const el = Date.now() - t0;
      Pc.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx += Math.sin((el + p.y) / 300) * .05; if (p.y > 1100 && el < 6000) { p.y = -20; p.x = Math.random() * 1920; } x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); });
      if (el < 11000) confT = requestAnimationFrame(frame); else x.clearRect(0, 0, 1920, 1080);
    };
    cancelAnimationFrame(confT); frame();
  }
  function stopConfetti() { cancelAnimationFrame(confT); const cv = $('#confetti'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }

  /* ---------- controls ---------- */
  let toastT;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 4500); }
  $('#cPause').onclick = () => setPaused(!S.paused);
  $('#cNext').onclick = () => next();
  const syncMute = () => { $('#cMute').textContent = Snd.muted ? '🔇' : '🔊'; };
  $('#cMute').onclick = () => { Snd.setMuted(!Snd.muted); syncMute(); };
  $('#cFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); };
  $('#cQuit').onclick = () => { if (confirm('End this game and go back to the setup screen?')) backToLobby(); };
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && S.phase !== 'lobby') { e.preventDefault(); if (S.paused) setPaused(false); else next(); }
    else if (e.key === 'p' || e.key === 'P') { if (S.phase !== 'lobby') setPaused(!S.paused); }
    else if (e.key === 'm' || e.key === 'M') $('#cMute').click();
    else if (e.key === 'f' || e.key === 'F') $('#cFull').click();
  });
  // stale players (phone asleep without closing the connection) and timer sync
  setInterval(() => { let ch = false; S.players.forEach(p => { if (p.connected && Date.now() - (p.lastSeen || 0) > 15000) { p.connected = false; ch = true; } }); if (ch) onPlayersChanged(); }, 2000);
  setInterval(() => { if ((S.phase === 'question' || S.phase === 'chain') && S.game.endT) S.players.forEach(p => { if (p.connected) sendTo(p.id, { t: 'sync', qid: qid(), left: Math.max(0, S.game.endT - Date.now()) }); }); }, 3000);

  /* ---------- boot: load the question bank ---------- */
  document.body.classList.add('in-lobby'); syncMute();
  fetch('data/questions.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(b => {
    BANK = b; S.bank = b;
    if (!Array.isArray(settings.cats) || !settings.cats.some(c => b.categories.includes(c))) settings.cats = b.categories.slice();
    settings.cats = settings.cats.filter(c => b.categories.includes(c));
    buildLobby(); renderLobbyPlayers();
  }).catch(e => { $('#stage').insertAdjacentHTML('beforeend', '<div class="load-err">Could not load data/questions.json (' + esc(e.message) + ').<br>Open the game through its web address (GitHub Pages or a local web server), not as a file.</div>'); });
})();
