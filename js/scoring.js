/* More or Less Party - ALL scoring rules and constants live here (used by the TV host and by the unit tests). */
(function (root) {
  'use strict';
  const POINTS = {
    MOL_CORRECT: 2,          // Mode 1: right MORE/LESS call
    CLOSEST: [3, 2, 1],      // Modes 2 & 3: points for rank 1, 2, 3 (by distance to the true answer)
    EXACT_BONUS: 5,          // Modes 2 & 3: estimate counted as "exact"
    CHAIN_BET: 2             // Mode 3: right MORE/LESS bet on the previous player's estimate
  };
  const EXACT_TOLERANCE = 0.005; // "exact" = within 0.5 % of the answer (years and small counts: must be equal, see isExact)
  const REF_OFFSET = [0.10, 0.40]; // Mode 1: reference value is 10-40 % away from the truth

  // An estimate is "exact" if it is within 0.5 % of the answer. For years, 0.5 % would be ±10 years, so a year must be exact;
  // for small numbers (< 200) the tolerance can't exceed rounding, so they must match after rounding to the question precision.
  function isExact(value, q) {
    if (value == null || !isFinite(value)) return false;
    const a = q.answer, p = q.precision || 0, f = Math.pow(10, p);
    if (Math.round(value * f) === Math.round(a * f)) return true;
    if (q.unit === 'year') return false;
    return Math.abs(value - a) <= Math.abs(a) * EXACT_TOLERANCE + 1e-9;
  }

  // Standard competition ranking ("1224"): ties share a rank; the next rank skips. Each tied player gets that rank's points.
  // entries: [{id, value}] (value null/undefined = no estimate -> unranked, 0 points). Returns Map id -> {dist, rank, points, exact}
  function rankClosest(entries, q) {
    const out = new Map();
    const valid = entries.filter(e => e.value != null && isFinite(e.value)).map(e => ({ id: e.id, value: +e.value, dist: Math.abs(+e.value - q.answer) }));
    // compare distances after rounding to avoid float noise (e.g. 9.58 vs 9.580000001)
    const key = (d) => Math.round(d * 1e6);
    valid.sort((x, y) => key(x.dist) - key(y.dist));
    valid.forEach((e, i) => {
      const rank = i > 0 && key(e.dist) === key(valid[i - 1].dist) ? out.get(valid[i - 1].id).rank : i + 1;
      const exact = isExact(e.value, q);
      const pts = (POINTS.CLOSEST[rank - 1] || 0);
      out.set(e.id, { value: e.value, dist: e.dist, rank, points: pts, exact, bonus: exact ? POINTS.EXACT_BONUS : 0 });
    });
    entries.forEach(e => { if (!out.has(e.id)) out.set(e.id, { value: null, dist: null, rank: null, points: 0, exact: false, bonus: 0 }); });
    return out;
  }

  // Mode 1 / Mode 3 bet. choice: 'more' | 'less' | null. Returns {correct: bool|null, points}. If the compared value equals
  // the truth exactly, nobody can be right: correct=null and 0 points ("push").
  function judgeBet(choice, compared, answer) {
    if (compared === answer) return { correct: null, points: 0, push: true };
    const truth = answer > compared ? 'more' : 'less';
    if (choice !== 'more' && choice !== 'less') return { correct: false, points: 0, missed: true };
    const ok = choice === truth;
    return { correct: ok, points: ok ? POINTS.MOL_CORRECT : 0 };
  }
  function judgeChainBet(choice, compared, answer) { const r = judgeBet(choice, compared, answer); r.points = r.correct ? POINTS.CHAIN_BET : 0; return r; }

  // Chain order for a question: players (sorted by join slot) rotated by the chain-question index, so a different player
  // starts each time. Players without an estimate are removed (nothing to reveal, nothing to bet on).
  function chainOrder(ids, rotation) {
    const n = ids.length; if (!n) return [];
    const r = ((rotation % n) + n) % n;
    return ids.slice(r).concat(ids.slice(0, r));
  }
  // Bets: order[i] bets on order[i-1]'s estimate, and order[0] (the first revealed) judges the LAST estimate (the loop).
  // Every player bets exactly once. Returns [{bettor, target}] in reveal order. 1 player -> no bets.
  function chainBets(order) {
    const n = order.length; if (n < 2) return [];
    const bets = [];
    for (let i = 1; i < n; i++) bets.push({ bettor: order[i], target: order[i - 1] });
    bets.push({ bettor: order[0], target: order[n - 1] });
    return bets;
  }

  // Nice rounding for the Mode 1 reference: 2 significant figures (or 1 step of 5 for years). Never equal to the answer.
  function niceRound(x) {
    if (x === 0) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1); // 2 significant digits
    let step = mag; if (Math.abs(x) / mag >= 50) step = mag * 5; // 2 sig. digits, coarser (x5) above 50: 8,600 -> 8,500, 1,300 -> 1,300
    return Math.round(x / step) * step;
  }
  function makeReference(q, rnd) {
    rnd = rnd || Math.random;
    const a = q.answer, p = q.precision || 0, f = Math.pow(10, p);
    for (let tries = 0; tries < 50; tries++) {
      const up = rnd() < 0.5;
      let ref;
      if (q.unit === 'year') {
        // a percentage of a year number is meaningless (10 % of 1989 = 199 years); use 4-40 years instead, rounded to 1 or 5
        const off = 4 + Math.floor(rnd() * 37);
        ref = a + (up ? off : -off); if (off > 12) ref = Math.round(ref / 5) * 5;
      } else {
        const off = REF_OFFSET[0] + rnd() * (REF_OFFSET[1] - REF_OFFSET[0]);
        ref = a * (up ? 1 + off : 1 - off);
        ref = niceRound(ref);
        if (Math.abs(a) < 20 && p === 0) ref = Math.round(a * (up ? 1 + off : 1 - off)); // small counts: whole numbers
        ref = Math.round(ref * f) / f;
      }
      if (ref !== a && ref > 0 && Math.abs(ref - a) >= 1 / f) return ref;
    }
    return Math.round((a + Math.max(1 / f, Math.abs(a) * 0.2)) * f) / f;
  }

  const api = { POINTS, EXACT_TOLERANCE, REF_OFFSET, isExact, rankClosest, judgeBet, judgeChainBet, chainOrder, chainBets, makeReference, niceRound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MOLScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
