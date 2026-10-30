/* More or Less Party - phone controller (thin client: renders the view the host sends, sends answers back) */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const LS = 'molparty.player.v1' + (params.get('slot') || ''); // 'slot' only used by automated tests (several players in one browser)
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } })();
  let room = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '');
  let client = null, me = null, view = null, renderedKey = '', deadline = 0, rafT = null, entry = '';
  const screen = $('#screen'), Snd = () => window.MOLSound;

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouch < 350 && !e.target.closest('input')) e.preventDefault(); lastTouch = n; }, { passive: false });
  function setStatus(cls, txt) { const s = $('#status'); s.className = 'st ' + cls; s.textContent = txt; }
  function save() { localStorage.setItem(LS, JSON.stringify(saved)); }
  function myId() { if (!saved.id || !/^[a-z0-9]{6,24}$/i.test(saved.id)) { saved.id = 'p' + Math.random().toString(36).slice(2, 12); save(); } return saved.id; }
  let wake = null;
  async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (client) client.retryNow(); } });
  const vib = () => { if (navigator.vibrate) navigator.vibrate(25); };

  /* ---------- join ---------- */
  function joinForm(err) {
    renderedKey = 'join';
    screen.innerHTML = '<div class="center"><div class="big-ico">⬆️⬇️</div><h1>MORE OR LESS PARTY</h1><div class="mut">Join the game on the big screen</div>' +
      '<div class="field"' + (room && !err ? ' style="display:none"' : '') + '><label for="code">Room code</label><input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" value="' + esc(room) + '" placeholder="ABCD"></div>' +
      '<div class="field"><label for="name">Your nickname</label><input id="name" maxlength="16" autocomplete="nickname" value="' + esc(saved.name || '') + '" placeholder="e.g. Mathieu"></div>' +
      '<div class="err" id="err">' + esc(err || '') + '</div><button class="pbtn" id="go">Join ▶</button></div>';
    const go = () => {
      const code = ($('#code').value || '').toUpperCase().replace(/[^A-Z]/g, ''), name = $('#name').value.trim();
      if (code.length !== 4) { $('#err').textContent = 'The room code has 4 letters.'; return; }
      if (!name) { $('#err').textContent = 'Please enter a nickname.'; return; }
      saved.name = name; saved.room = code; save();
      if (room !== code && client) { location.search = '?room=' + code + (params.get('transport') ? '&transport=' + params.get('transport') : ''); return; }
      room = code; Snd().unlock(); keepAwake(); connect();
    };
    $('#go').onclick = go;
    screen.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
  }
  function connect() {
    if (client) { sendHello(); return; }
    waitScreen('📡', 'Connecting…', 'Room ' + room);
    client = window.MOLNet.createClient(room, {
      onStatus(s) {
        if (s === 'open') { setStatus('ok', 'Connected'); sendHello(); }
        else if (s === 'connecting') setStatus('', 'Connecting…');
        else if (s === 'nohost') { setStatus('bad', 'Game not found'); if (!me) waitScreen('🔎', 'Looking for room ' + room + '…', 'Make sure the big screen shows this code. Retrying…'); }
        else setStatus('bad', 'Reconnecting…');
      },
      onMessage: onMsg
    });
  }
  function sendHello() { if (client && client.open) client.send({ t: 'hello', id: myId(), name: saved.name }); }
  setInterval(() => { if (client && client.open && me) client.send({ t: 'ping' }); }, 4000);
  function onMsg(m) {
    if (!m) return;
    if (m.t === 'welcome') { me = m; saved.id = m.id; saved.room = room; save(); $('#me').innerHTML = '<span class="avatar" style="background:' + m.color + '">' + m.emoji + '</span>' + esc(m.name); }
    else if (m.t === 'error') { me = null; joinForm(m.msg); }
    else if (m.t === 'kicked') { me = null; $('#me').innerHTML = ''; joinForm('You were removed from the game by the host.'); }
    else if (m.t === 'view') { view = m.v; window.__lastView = m.v; render(); }
    else if (m.t === 'sync') { if (view && view.qid === m.qid) deadline = Date.now() + m.left; }
  }
  function waitScreen(icon, title, sub) { renderedKey = 'wait:' + title + sub; screen.innerHTML = '<div class="center"><div class="big-ico">' + icon + '</div><div class="ttl">' + esc(title) + '</div><div class="mut">' + esc(sub || '') + '</div></div>'; }

  /* ---------- render ---------- */
  function render() {
    const v = view; if (!v) return;
    $('#myscore').textContent = v.score != null ? v.score + ' pts' : '';
    const key = [v.screen, v.qid, v.locked ? 1 : 0, v.step, v.waiting ? 1 : 0, v.screen === 'wait' ? v.text + v.sub : ''].join(':');
    if (key === renderedKey) { if (v.left != null) deadline = Date.now() + v.left; return; }
    if (v.screen === 'estimate' && !renderedKey.startsWith('estimate:' + v.qid + ':')) entry = '';
    renderedKey = key; cancelAnimationFrame(rafT);
    const fn = { lobby: rLobby, mol: rMol, estimate: rEstimate, chain: rChain, result: rResult, wait: () => waitScreen(v.icon || '⏳', v.text, v.sub), final: rFinal }[v.screen];
    if (fn) fn(v);
  }
  function rLobby(v) { screen.innerHTML = '<div class="center"><span class="avatar big-ava" style="background:' + v.you.color + '">' + v.you.emoji + '</span><div class="ttl">You\'re in, ' + esc(v.you.name) + '!</div><div class="mut">Waiting for the host to start the game…<br>Keep this page open.</div></div>'; }
  function timerBar() {
    const bar = $('#ptb'); if (!bar || !view) return;
    const left = Math.max(0, deadline - Date.now()); bar.style.width = (left / view.time * 100) + '%';
    const n = $('#psec'); if (n) n.textContent = Math.ceil(left / 1000) + 's';
    if (left > 0) rafT = requestAnimationFrame(timerBar);
  }
  const head = (v) => '<div class="qhead"><span>Q' + v.qnum + '/' + v.qof + ' <span class="mbadge">' + esc(v.modeTitle) + '</span></span><span id="psec"></span></div><div class="ptimer"><div id="ptb"></div></div>';
  const unitOf = (v) => v.unit === 'year' ? '' : v.unit;
  function rMol(v) {
    deadline = Date.now() + v.left;
    screen.innerHTML = head(v) + '<div class="qtext">' + esc(v.text) + '</div><div class="refbox"><div class="lb">Reference</div><div class="v">' + esc(v.refText) + '</div></div>' +
      '<div class="ml' + (v.locked ? ' locked' : '') + '" id="ml"><button class="more' + (v.choice === 'more' ? ' mine' : '') + '" data-c="more">▲ MORE<small>the true answer is higher</small></button><button class="less' + (v.choice === 'less' ? ' mine' : '') + '" data-c="less">▼ LESS<small>the true answer is lower</small></button></div>' +
      '<div class="locked-msg" id="lmsg">' + (v.locked ? '🔒 Locked - wait for the others…' : '') + '</div>';
    if (!v.locked) screen.querySelectorAll('#ml button').forEach(b => b.onclick = () => {
      if ($('#ml').classList.contains('locked')) return; $('#ml').classList.add('locked'); b.classList.add('mine'); $('#lmsg').textContent = '🔒 Locked - wait for the others…'; vib();
      client.send({ t: 'answer', qid: v.qid, choice: b.dataset.c });
    });
    timerBar();
  }
  function fmtEntry(s, v) {
    if (!s) return '';
    if (v.unit === 'year') return s;
    const [i, d] = s.split('.'); return Number(i || '0').toLocaleString('en-US') + (d != null ? '.' + d : '');
  }
  function rEstimate(v) {
    deadline = Date.now() + v.left;
    if (v.locked) {
      screen.innerHTML = head(v) + '<div class="qtext">' + esc(v.text) + '</div><div class="locked-big"><div class="big-ico">🔒</div><div class="mut">Your secret estimate</div><div class="v">' + esc(v.valueText) + '</div><div class="mut">' + (v.mode === 'chain' ? 'Locked! Get ready to bet on someone else\'s estimate…' : 'Locked - wait for the others…') + '</div></div>';
      return timerBar();
    }
    const dec = v.precision > 0;
    screen.innerHTML = head(v) + '<div class="qtext">' + esc(v.text) + '</div><div class="disp" id="disp"></div><div class="keypad" id="kp">' +
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => '<button data-k="' + k + '"' + (k === '.' ? ' class="dot"' + (dec ? '' : ' disabled') : k === '⌫' ? ' class="bk"' : '') + '>' + k + '</button>').join('') +
      '</div><button class="lockbtn" id="lock" disabled>Lock in my estimate 🔒</button>';
    const upd = () => { $('#disp').innerHTML = entry ? esc(fmtEntry(entry, v)) + (unitOf(v) ? '<span class="u">' + esc(unitOf(v)) + '</span>' : '') : '<span class="ph">Your estimate' + (unitOf(v) ? ' (' + esc(unitOf(v)) + ')' : '') + '</span>'; $('#lock').disabled = !entry || entry === '.'; };
    screen.querySelectorAll('#kp button').forEach(b => b.onclick = () => {
      const k = b.dataset.k; vib();
      if (k === '⌫') entry = entry.slice(0, -1);
      else if (k === '.') { if (dec && !entry.includes('.')) entry = (entry || '0') + '.'; }
      else { const [i, d] = entry.split('.'); if (d != null ? d.length < Math.max(v.precision, 2) : (i || '').replace(/^0+/, '').length < 12) entry = (entry === '0' ? '' : entry) + k; }
      upd();
    });
    $('#lock').onclick = () => { const val = parseFloat(entry); if (!isFinite(val)) return; $('#lock').disabled = true; vib(); client.send({ t: 'answer', qid: v.qid, value: val }); };
    upd(); timerBar();
  }
  function rChain(v) {
    deadline = Date.now() + (v.left || 0);
    let h = '<div class="qhead"><span>Q' + v.qnum + '/' + v.qof + ' <span class="mbadge">Chain · bet ' + (v.step + 1) + '/' + v.steps + '</span></span><span id="psec"></span></div><div class="ptimer"><div id="ptb"></div></div><div class="qtext">' + esc(v.text) + '</div>';
    if (v.isBettor && v.waiting) {
      h += '<div class="chainq">Your turn! Is the <b>TRUE answer</b> MORE or LESS than ' + esc(v.target) + '\'s estimate?<span class="tv">' + esc(v.targetText) + '</span></div>' +
        '<div class="ml" id="ml"><button class="more" data-c="more">▲ MORE</button><button class="less" data-c="less">▼ LESS</button></div><div class="locked-msg" id="lmsg"></div>';
      screen.innerHTML = h;
      screen.querySelectorAll('#ml button').forEach(b => b.onclick = () => { if ($('#ml').classList.contains('locked')) return; $('#ml').classList.add('locked'); b.classList.add('mine'); vib(); client.send({ t: 'bet', qid: v.qid, step: v.step, choice: b.dataset.c }); });
      return timerBar();
    }
    const icon = v.waiting ? '⏳' : v.choice === 'more' ? '▲' : v.choice === 'less' ? '▼' : '⌛';
    const msg = v.waiting ? 'Waiting for ' + esc(v.bettor) + ' to bet on ' + (v.targetIsMe ? 'your' : esc(v.target) + '\'s') + ' estimate (' + esc(v.targetText) + ')…' : esc(v.bettor) + (v.choice ? ' says <b>' + v.choice.toUpperCase() + '</b>' : ' ran out of time') + ' vs ' + esc(v.targetText);
    h += '<div class="locked-big"><div class="big-ico">' + icon + '</div><div class="ttl" style="font-size:22px">' + msg + '</div>' + (v.myEstimate ? '<div class="mut">Your estimate: <b>' + esc(v.myEstimate) + '</b>' + (v.myBetDone ? ' · your bet is in' : '') + '</div>' : '<div class="mut">You have no estimate this time.</div>') + '</div>';
    screen.innerHTML = h; if (v.waiting) timerBar(); else { const b = $('#ptb'); if (b) b.style.width = '0%'; }
  }
  function rResult(v) {
    screen.innerHTML = '<div class="center"><div class="res-mark">' + (v.good ? '🎉' : '😬') + '</div><div class="res-pts ' + (v.good ? 'good' : 'bad') + '">+' + v.points + '</div>' +
      '<div class="mut">Correct answer: <b>' + esc(v.answerText) + '</b></div>' + v.lines.map(l => '<div class="res-line">' + esc(l) + '</div>').join('') +
      '<div class="res-total">Your total: <b>' + v.total + '</b> pts</div></div>';
    v.good ? Snd().reveal() : Snd().pop();
  }
  function rFinal(v) {
    screen.innerHTML = '<div class="center"><div class="mut">Final rank</div><div class="rank-big">#' + v.rank + '</div><div class="ttl">' + (v.rank === 1 ? '🏆 You win!' : v.rank <= 3 ? '🥉 On the podium!' : 'Well played!') + '</div><div class="res-total">Your score: <b>' + v.score + '</b> pts · ' + v.of + ' players</div></div>';
  }
  /* ---------- boot ---------- */
  if (room && saved.name && saved.room === room) { Snd().unlock(); connect(); } else joinForm();
})();
