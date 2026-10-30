// Unit tests for js/scoring.js - run: node tests/scoring.test.js
const assert = require('assert');
const S = require('../js/scoring.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const q = (answer, extra) => Object.assign({ answer, unit: 'm', precision: 0 }, extra);

t('constants', () => { assert.deepStrictEqual(S.POINTS.CLOSEST, [3, 2, 1]); assert.strictEqual(S.POINTS.EXACT_BONUS, 5); assert.strictEqual(S.POINTS.MOL_CORRECT, 2); assert.strictEqual(S.POINTS.CHAIN_BET, 2); });
t('More or Less: right/wrong/none/push', () => {
  assert.deepStrictEqual(S.judgeBet('more', 5000, 6650), { correct: true, points: 2 });
  assert.strictEqual(S.judgeBet('less', 5000, 6650).points, 0);
  assert.strictEqual(S.judgeBet('less', 8000, 6650).points, 2);
  assert.strictEqual(S.judgeBet(null, 5000, 6650).points, 0);
  assert.strictEqual(S.judgeBet('more', 6650, 6650).push, true); assert.strictEqual(S.judgeBet('more', 6650, 6650).points, 0);
});
t('exact = within 0.5 % (years and rounding rules)', () => {
  assert.ok(S.isExact(8849, q(8848.86, { precision: 2 })) === true);   // 0.002 % off
  assert.ok(S.isExact(8800, q(8849)) === false);                       // 0.55 % off
  assert.ok(S.isExact(8805, q(8849)) === true);                        // 0.497 %
  assert.ok(S.isExact(1990, q(1989, { unit: 'year' })) === false);     // years must be exact
  assert.ok(S.isExact(1989, q(1989, { unit: 'year' })) === true);
  assert.ok(S.isExact(9.58, q(9.58, { precision: 2 })) === true);
  assert.ok(S.isExact(9.6, q(9.58, { precision: 2 })) === true); assert.ok(S.isExact(9.7, q(9.58, { precision: 2 })) === false);
  assert.ok(S.isExact(null, q(3)) === false);
});
t('Closest: simple ranking 3/2/1, 4th gets 0', () => {
  const r = S.rankClosest([{ id: 'a', value: 8000 }, { id: 'b', value: 9200 }, { id: 'c', value: 8850 }, { id: 'd', value: 7500 }], q(8848.86, { precision: 2 }));
  assert.deepStrictEqual(['c', 'b', 'a', 'd'].map(id => r.get(id).rank), [1, 2, 3, 4]);
  assert.deepStrictEqual(['c', 'b', 'a', 'd'].map(id => r.get(id).points), [3, 2, 1, 0]);
  assert.strictEqual(r.get('c').exact, true); assert.strictEqual(r.get('c').bonus, 5); assert.strictEqual(r.get('b').bonus, 0);
});
t('Closest ties: competition ranking 1,1,3 and 1,2,2,4', () => {
  let r = S.rankClosest([{ id: 'a', value: 90 }, { id: 'b', value: 110 }, { id: 'c', value: 130 }], q(100));
  assert.deepStrictEqual(['a', 'b', 'c'].map(i => [r.get(i).rank, r.get(i).points]), [[1, 3], [1, 3], [3, 1]]);
  r = S.rankClosest([{ id: 'a', value: 100 }, { id: 'b', value: 95 }, { id: 'c', value: 105 }, { id: 'd', value: 150 }], q(100));
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map(i => [r.get(i).rank, r.get(i).points]), [[1, 3], [2, 2], [2, 2], [4, 0]]);
  r = S.rankClosest([{ id: 'a', value: 50 }, { id: 'b', value: 50 }, { id: 'c', value: 50 }, { id: 'd', value: 40 }], q(100));
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map(i => r.get(i).points), [3, 3, 3, 0]); // all three tied first, 4th is rank 4
  r = S.rankClosest([{ id: 'a', value: 100 }, { id: 'b', value: 100 }], q(100));
  assert.ok(r.get('a').exact && r.get('b').exact && r.get('a').points === 3 && r.get('b').points === 3); // tied exact: both 3 + 5
  r = S.rankClosest([{ id: 'a', value: 9.58 }, { id: 'b', value: 9.57 }, { id: 'c', value: 9.59 }], q(9.58, { precision: 2 })); // float noise
  assert.deepStrictEqual(['a', 'b', 'c'].map(i => r.get(i).rank), [1, 2, 2]);
});
t('Closest: missing estimates are unranked with 0', () => {
  const r = S.rankClosest([{ id: 'a', value: null }, { id: 'b', value: 3 }], q(5));
  assert.strictEqual(r.get('a').rank, null); assert.strictEqual(r.get('a').points, 0); assert.strictEqual(r.get('b').rank, 1);
});
t('Chain: loop for 2, 3 and 10 players - each bets exactly once, never on self', () => {
  for (const n of [2, 3, 10]) {
    const ids = Array.from({ length: n }, (_, i) => 'p' + i), bets = S.chainBets(ids);
    assert.strictEqual(bets.length, n);
    assert.deepStrictEqual(bets.map(b => b.bettor).sort(), ids.slice().sort());
    assert.deepStrictEqual(bets.map(b => b.target).sort(), ids.slice().sort());
    bets.forEach(b => assert.notStrictEqual(b.bettor, b.target));
    for (let i = 0; i < n - 1; i++) assert.deepStrictEqual(bets[i], { bettor: ids[i + 1], target: ids[i] });
    assert.deepStrictEqual(bets[n - 1], { bettor: ids[0], target: ids[n - 1] }); // P1 judges the last estimate
  }
  assert.deepStrictEqual(S.chainBets(['solo']), []); assert.deepStrictEqual(S.chainBets([]), []);
  assert.deepStrictEqual(S.chainBets(['a', 'b']), [{ bettor: 'b', target: 'a' }, { bettor: 'a', target: 'b' }]);
});
t('Chain: rotation gives each player the first slot in turn', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(r => S.chainOrder(ids, r)[0]), ['a', 'b', 'c', 'd', 'a']);
  assert.deepStrictEqual(S.chainOrder(ids, 1), ['b', 'c', 'd', 'a']);
  assert.deepStrictEqual(S.chainOrder([], 3), []);
});
t('Chain bet: independent of own estimate, exact-equal estimate = no points, timeout = 0', () => {
  // Nile 6650: J1 says 5000, J2 (who wrote 6000) bets MORE -> correct
  assert.strictEqual(S.judgeChainBet('more', 5000, 6650).points, 2);
  assert.strictEqual(S.judgeChainBet('less', 5000, 6650).points, 0);
  assert.strictEqual(S.judgeChainBet('more', 6650, 6650).points, 0); assert.strictEqual(S.judgeChainBet('less', 6650, 6650).push, true);
  assert.strictEqual(S.judgeChainBet(null, 5000, 6650).points, 0);
});
t('Reference value: 10-40 % off, never equal, positive, respects precision; years 4-40 away', () => {
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (const [a, p, u] of [[8849, 0, 'm'], [450295, 0, 'km²'], [9.58, 2, 's'], [7.32, 2, 'm'], [3, 0, 'hearts'], [7, 0, 'x'], [193, 0, 'x'], [42195, 0, 'm'], [1989, 0, 'year'], [1066, 0, 'year'], [45.52, 2, 'carats']]) {
    for (let i = 0; i < 300; i++) {
      const r = S.makeReference({ answer: a, precision: p, unit: u }, rnd);
      assert.ok(r !== a && r > 0, a + ' -> ' + r);
      assert.strictEqual(Math.round(r * 100) / 100, r);
      if (u === 'year') assert.ok(Math.abs(r - a) >= 2 && Math.abs(r - a) <= 42, a + ' -> ' + r);
      else if (a >= 20) { const off = Math.abs(r - a) / a; assert.ok(off >= 0.04 && off <= 0.5, a + ' -> ' + r + ' (' + off + ')'); } // rounding may move it a little outside 10-40 %
      if (p === 0) assert.strictEqual(Math.round(r), r);
    }
  }
});
t('Full chain question scoring example (4 players, from the spec)', () => {
  const Q = q(6650), est = { J1: 5000, J2: 6000, J3: 7200, J4: 6400 };
  const order = S.chainOrder(['J1', 'J2', 'J3', 'J4'], 0), bets = S.chainBets(order);
  const choices = { J2: 'more', J3: 'less', J4: 'more', J1: 'less' }; // J2 vs 5000 ok, J3 vs 6000 wrong, J4 vs 7200 wrong, J1 vs 6400 wrong
  const rank = S.rankClosest(Object.entries(est).map(([id, value]) => ({ id, value })), Q);
  const tot = {}; for (const id in est) tot[id] = rank.get(id).points + rank.get(id).bonus;
  bets.forEach(b => tot[b.bettor] += S.judgeChainBet(choices[b.bettor], est[b.target], Q.answer).points);
  assert.deepStrictEqual(tot, { J1: 0, J2: 2 + 1, J3: 2, J4: 3 }); // J4 6400 (250 off) #1, J3 7200 (550) #2, J2 6000 (650) #3
});
console.log(n + ' test groups passed');
