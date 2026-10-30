// End-to-end test: 1 TV host + 4 phones over the local test transport (BroadcastChannel), through all 3 modes + Mixed.
// Usage: (serve the repo root on :8766) NODE_PATH=<dir with playwright> node tools/e2e.cjs
const { chromium } = require('playwright');
const SC = require('../js/scoring.js');
const BASE = process.env.BASE || 'http://localhost:8766/';
const SHOTS = __dirname + '/../screens/';
const T = '&transport=local', COUNT = 5;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// manual polling (page.waitForFunction polling proved unreliable with several pages in this Playwright build)
const until = async (page, fn, arg, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(100); } return false; };
let fails = 0; const check = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } else log('ok:', m); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  const host = await ctx.newPage();
  host.on('pageerror', e => errors.push('host: ' + e.message)); host.on('dialog', d => d.accept());
  host.on('console', m => { if (m.type() === 'error') errors.push('host console: ' + m.text()); });
  await host.goto(BASE + 'index.html?fast=0.5' + T);
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#roomCode').textContent) && window.__mol.bank, null, { timeout: 20000 });
  const code = await host.textContent('#roomCode'), qrUrl = await host.getAttribute('#qr', 'data-url');
  check(/play\.html\?room=[A-Z]{4}/.test(qrUrl), 'QR encodes play.html?room=CODE (' + qrUrl + ')');
  check(await host.$('#qr svg') !== null, 'QR code rendered as SVG');

  const names = ['Mathieu', 'Björn', 'Lovisa', 'Camille'];
  const phones = [];
  const newPhone = async (slot) => { const p = await ctx.newPage(); await p.setViewportSize({ width: 390, height: 844 }); p.on('pageerror', e => errors.push('phone ' + slot + ': ' + e.message)); await p.goto(BASE + 'play.html?room=' + code + T + '&slot=' + slot); return p; };
  for (let i = 0; i < 4; i++) {
    const p = await newPhone(i); await p.fill('#name', names[i]); await p.click('#go'); phones.push(p);
    if (i === 0) { await p.waitForSelector('text=You\'re in'); check(await host.$eval('#startBtn', b => b.disabled), 'start disabled with only 1 player'); }
  }
  await host.waitForFunction(() => [...window.__mol.players.values()].filter(p => p.connected).length === 4, null, { timeout: 20000 });
  for (const p of phones) await p.waitForSelector('text=You\'re in', { timeout: 10000 });
  check(true, '4 players joined');
  const dup = await newPhone('dup'); await dup.fill('#name', 'mathieu'); await dup.click('#go');
  await dup.waitForSelector('text=already taken', { timeout: 10000 }).then(() => check(true, 'duplicate nickname refused')).catch(() => check(false, 'duplicate nickname refused'));
  await dup.close();

  const st = () => host.evaluate(() => { const S = window.__mol, g = S.game, c = g && g.list[g.i];
    return { phase: S.phase, qid: g && (g.uid + '-q' + g.i), i: g ? g.i : -1, n: g ? g.list.length : 0, mode: c && c.mode, q: c && c.q, ref: c && c.ref, chain: g && g.chain && { order: g.chain.order, step: g.chain.step, waiting: g.chain.waiting, bets: g.chain.bets },
      players: [...S.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, slot: p.slot })),
      results: g && g.results ? Object.fromEntries([...g.results].map(([k, v]) => [k, v])) : null, answers: g ? Object.fromEntries([...g.answers].map(([k, v]) => [k, v])) : null }; });
  const pid = async (name) => (await st()).players.find(p => p.name === name).id;
  const ids = {}; for (const n of names) ids[n] = await pid(n);
  const shot = {}; const snap = async (page, file) => { if (shot[file]) return; shot[file] = 1; await page.screenshot({ path: SHOTS + file }); };
  const fmtKey = (v, q) => q.precision ? v.toFixed(q.precision) : String(Math.round(v));
  async function typeEstimate(page, v, q, qidNow) {
    await page.bringToFront(); let okKp = false;
    for (let w = 0; w < 100 && !okKp; w++) { okKp = await page.evaluate((qid) => !!(window.__lastView && window.__lastView.qid === qid && window.__lastView.screen === 'estimate' && document.querySelector('#kp')), qidNow); if (!okKp) await sleep(100); }
    if (!okKp) throw new Error('keypad for ' + q.id + ' not shown: ' + await page.textContent('#screen'));
    for (const ch of fmtKey(v, q)) await page.click('#kp [data-k="' + ch + '"]', { timeout: 5000 }); await page.click('#lock', { timeout: 5000 }); }
  const estimatesFor = (q) => { const a = q.answer, f = Math.pow(10, q.precision), d = Math.max(1 / f, Math.round(a * 0.2 * f) / f);
    return { Mathieu: a, 'Björn': Math.round((a + d) * f) / f, Lovisa: Math.round((a - d) * f) / f, Camille: Math.round(a * 3 * f) / f }; };

  async function setup(mode) {
    await host.click('#modePicks [data-mode="' + mode + '"]'); await host.click('#countPick [data-count="' + COUNT + '"]'); await host.click('#timerPick [data-timer="15"]');
    if (mode === 'mol' && !shot.lobby) { await sleep(300); await snap(host, '01-tv-lobby-qr.png'); await snap(phones[0], '02-phone-joined.png'); shot.lobby = 1; }
    await host.click('#startBtn');
    await host.waitForFunction(() => window.__mol.phase === 'question', null, { timeout: 20000 });
  }

  async function playGame(mode, opts) {
    await setup(mode);
    const done = new Set(); let qCount = 0, silentDone = false, betTimeoutDone = false, reloadDone = false, replaceDone = false, before = null;
    while (true) {
      const s = await st();
      if (s.phase === 'podium') break;
      const key = s.phase + ':' + s.i + ':' + (s.chain ? s.chain.step + ':' + s.chain.waiting : '');
      if (done.has(key) || !['question', 'chain', 'reveal', 'standings'].includes(s.phase)) { await sleep(120); continue; }
      done.add(key);
      if (s.phase === 'standings') { await sleep(500); await snap(host, '12-tv-standings.png'); continue; }
      if (s.phase === 'question') {
        qCount++; before = Object.fromEntries(s.players.map(p => [p.name, p.score]));
        if (s.mode === 'mol') {
          await phones[0].waitForSelector('#ml button');
          await sleep(shot['03-tv-more-or-less.png'] ? 100 : 900); await snap(host, '03-tv-more-or-less.png'); await snap(phones[0], '04-phone-more-less.png');
          const truth = s.q.answer > s.ref ? 'more' : 'less', wrong = truth === 'more' ? 'less' : 'more';
          check(s.ref !== s.q.answer && s.ref > 0, 'MOL reference ' + s.ref + ' != answer ' + s.q.answer);
          await phones[0].click('#ml .' + truth); await phones[1].click('#ml .' + wrong); await phones[2].click('#ml .' + truth);
          if (!silentDone && opts.silent) { silentDone = true; log('Camille stays silent (answer timeout test)'); } else await phones[3].click('#ml .' + (s.i % 2 ? wrong : truth));
        } else {
          const E = estimatesFor(s.q);
          for (let k = 0; k < 4; k++) {
            if (k === 1) { await sleep(200); await snap(phones[1], '06-phone-keypad.png'); }
            await typeEstimate(phones[k], E[names[k]], s.q, s.qid);
            if (k === 0) { // secrecy: nobody else's view contains Mathieu's locked estimate
              const leak = await host.evaluate(({ id, v }) => [...window.__mol.players.values()].filter(p => p.id !== id).some(p => JSON.stringify(window.__mol.viewFor(p)).includes(JSON.stringify(v).replace(/"/g, ''))), { id: ids.Mathieu, v: 'Your estimate' });
              check(!leak, 'estimate phase: other phones get no estimate of others');
            }
            if (k === 2 && s.mode === 'closest' && !shot['05-tv-closest-question.png']) await sleep(600), await snap(host, '05-tv-closest-question.png');
          }
        }
      } else if (s.phase === 'chain' && s.chain.waiting) {
        const b = s.chain.bets[s.chain.step], bettor = s.players.find(p => p.id === b.bettor), bi = names.indexOf(bettor.name);
        // secrecy: estimates of players not revealed yet must not appear in other players' views
        const revealedIds = new Set(s.chain.bets.slice(0, s.chain.step + 1).map(x => x.target));
        const leak = await host.evaluate(({ hidden }) => { const S = window.__mol; return [...S.players.values()].some(p => { const j = JSON.stringify(S.viewFor(p)); return hidden.some(h => h.id !== p.id && j.includes('"' + h.txt)); }); },
          { hidden: s.chain.order.filter(id => !revealedIds.has(id)).map(id => ({ id, txt: String(s.answers[id].value) })) });
        check(!leak, 'chain step ' + (s.chain.step + 1) + ': unrevealed estimates stay secret');
        await phones[bi].waitForSelector('#ml button.more', { timeout: 10000 });
        const others = phones.filter((_, k) => k !== bi);
        const waitTxt = await others[0].textContent('#screen');
        check(/Waiting for/.test(waitTxt) && !(await others[0].$('#ml')), 'only the bettor (' + bettor.name + ') gets MORE/LESS, others wait');
        if (s.chain.step === 1) { await sleep(1600); await snap(host, '07-tv-chain-bet.png'); await snap(phones[bi], '08-phone-chain-bet.png'); await snap(others[0], '09-phone-chain-waiting.png'); }
        const tv = s.answers[b.target].value, truth = s.q.answer > tv ? 'more' : 'less';
        if (opts.betTimeout && !betTimeoutDone && s.chain.step === 2) { betTimeoutDone = true; log(bettor.name + ' lets the bet time out'); }
        else await phones[bi].click('#ml .' + (bettor.name === 'Lovisa' ? (truth === 'more' ? 'less' : 'more') : truth));
        if (opts.reload && !reloadDone && s.i === 1 && s.chain.step === 0) { // reconnect test: a phone reloads mid-chain and gets its state + score back
          reloadDone = true; const best = s.players.filter(p => p.id !== b.bettor).sort((x, y) => y.score - x.score)[0], idx = names.indexOf(best.name), nm = names[idx], sc0 = s.players.find(p => p.name === nm).score;
          await phones[idx].reload();
          await host.waitForFunction((id) => { const p = window.__mol.players.get(id); return p && p.connected; }, ids[nm], { timeout: 15000 });
          check(await until(phones[idx], () => /Q\d+\/\d+/.test(document.querySelector('#screen').textContent)), 'reloaded phone shows the current question');
          const s2 = await st(); check(s2.players.length === 4 && s2.players.find(p => p.name === nm).score === sc0, 'reload mid-chain: ' + nm + ' rejoined automatically, same score (' + sc0 + ')');
        }
      } else if (s.phase === 'reveal') {
        if (!shot['rv-' + s.mode]) { shot['rv-' + s.mode] = 1; await sleep(1800); } // let the reveal animation finish before the screenshot
        const E = s.q && estimatesFor(s.q), r = s.results, after = Object.fromEntries(s.players.map(p => [p.name, p.score]));
        if (s.mode === 'mol') {
          await snap(host, '10-tv-mol-reveal.png');
          check(r[ids.Mathieu].points === 2 && r[ids['Björn']].points === 0 && r[ids.Lovisa].points === 2, 'MOL: right +2, wrong 0');
        } else {
          if (s.mode === 'closest') await snap(host, '11-tv-closest-reveal.png'); else await snap(host, '13-tv-chain-reveal.png');
          const rk = SC.rankClosest(names.filter(n => s.answers[ids[n]]).map(n => ({ id: ids[n], value: s.answers[ids[n]].value })), s.q);
          const exp = {}; names.forEach(n => { const x = rk.get(ids[n]); exp[n] = x ? x.points + x.bonus : 0; });
          if (s.mode === 'chain') s.chain.bets.forEach(b => { const n = names.find(n => ids[n] === b.bettor); exp[n] += SC.judgeChainBet(b.choice, s.answers[b.target].value, s.q.answer).points; });
          const got = Object.fromEntries(names.map(n => [n, r[ids[n]].points]));
          check(JSON.stringify(got) === JSON.stringify(exp), s.mode + ' q' + (s.i + 1) + ' points ' + JSON.stringify(got) + ' = expected');
          check(r[ids.Mathieu].exact && r[ids.Mathieu].rank === 1 && r[ids['Björn']].rank === r[ids.Lovisa].rank, s.mode + ': exact bonus for Mathieu, tie Björn/Lovisa share rank ' + r[ids.Lovisa].rank);
          if (s.mode === 'chain') check(new Set(s.chain.bets.map(b => b.bettor)).size === 4 && s.chain.bets.length === 4, 'chain: each of 4 players bet exactly once');
        }
        check(names.every(n => after[n] === before[n] + r[ids[n]].points), 'scores accumulate');
        const shown = await Promise.all(phones.map((ph, k) => until(ph, (x) => parseInt(document.querySelector('#myscore').textContent) === x, after[names[k]], 4000)));
        check(shown.every(Boolean), 'each phone shows its own total = host score ' + JSON.stringify(shown));
        if (s.mode === 'chain' && !shot.chainOrder) { shot.chainOrder = [] }
        if (s.mode === 'chain') (shot.chainOrder).push(s.chain.order[0]);
        if (opts.replace && !replaceDone && s.i === 1) { // new device, same nickname -> takes over the score
          replaceDone = true; const sc0 = after.Camille; await phones[3].close();
          await host.waitForFunction((id) => !window.__mol.players.get(id).connected, ids.Camille, { timeout: 10000 });
          const np = await newPhone('new3'); await np.fill('#name', 'Camille'); await np.click('#go'); phones[3] = np;
          await host.waitForFunction((id) => window.__mol.players.get(id).connected, ids.Camille, { timeout: 15000 });
          const s3 = await st(); check(s3.players.length === 4 && s3.players.find(p => p.name === 'Camille').score === sc0, 'new phone, same nickname: Camille keeps her score (' + sc0 + ')');
        }
      }
    }
    check(qCount === COUNT, mode + ': ' + COUNT + ' questions played (' + qCount + ')');
    if (mode === 'mixed') { const modes = await host.evaluate(() => window.__mol.game.list.map(x => x.mode)); check(modes.join() === 'mol,closest,chain,mol,closest', 'mixed rotates modes: ' + modes.join()); }
    if (mode === 'chain') check(new Set(shot.chainOrder).size === Math.min(4, COUNT), 'chain order rotates the starting player: ' + shot.chainOrder.map(id => names.find(n => ids[n] === id)).join(','));
    await sleep(2500);
    const fin = await st(); const sorted = fin.players.slice().sort((a, b) => b.score - a.score);
    await host.waitForSelector('.podium'); await sleep(shot['14-tv-podium.png'] ? 0 : 1500); await snap(host, '14-tv-podium.png');
    const top = await host.textContent('.pod.p1 .pn'); check(fin.players.find(p => p.name === top).score === sorted[0].score, mode + ': podium #1 is ' + top + ' (' + sorted[0].score + ' pts)');
    await phones[0].waitForSelector('.rank-big', { timeout: 8000 }); await snap(phones[0], '15-phone-final-rank.png');
    log(mode, 'final', fin.players.map(p => p.name + ':' + p.score).join(' '));
    await host.click('#againBtn'); await host.waitForFunction(() => window.__mol.phase === 'lobby');
  }

  const GAMES = (process.env.GAMES || 'mol,closest,chain,mixed').split(',');
  const OPTS = { mol: { silent: true }, closest: {}, chain: { reload: true, betTimeout: true }, mixed: { replace: true } };
  for (const g of GAMES) await playGame(g, OPTS[g]);
  const seenTxt = await host.textContent('#seenInfo'); check(new RegExp((GAMES.length * COUNT) + ' of 60').test(seenTxt), 'played questions remembered: ' + seenTxt);
  const seenIds = await host.evaluate(() => JSON.parse(localStorage.getItem('molparty.seen.v1')));
  check(new Set(seenIds).size === GAMES.length * COUNT, '4 games x 5 questions: no question repeated (' + new Set(seenIds).size + ' distinct)');
  await host.click('#resetSeen'); check(/none played/.test(await host.textContent('#seenInfo')), 'reset played questions');
  check(errors.length === 0, 'no JS errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  log(fails ? fails + ' FAILURES' : 'ALL CHECKS PASSED');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
