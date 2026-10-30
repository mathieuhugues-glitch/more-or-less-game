/* More or Less Party - tiny WebAudio sound effects (no audio files) */
(function () {
  'use strict';
  let ctx = null, muted = localStorage.getItem('molparty.muted') === '1';
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  function tone(freq, dur, type, vol, delay, slide) {
    if (muted) return; const c = ac(); if (!c) return;
    const t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const S = {
    unlock() { ac(); },
    get muted() { return muted; },
    setMuted(m) { muted = m; localStorage.setItem('molparty.muted', m ? '1' : '0'); },
    join() { tone(660, 0.12, 'triangle', 0.2); tone(990, 0.15, 'triangle', 0.2, 0.1); },
    tick() { tone(1200, 0.05, 'square', 0.06); },
    lock() { tone(520, 0.08, 'triangle', 0.15); },
    question() { tone(440, 0.1, 'triangle', 0.15); tone(660, 0.14, 'triangle', 0.15, 0.09); },
    reveal() { tone(523, 0.12, 'triangle', 0.2); tone(659, 0.12, 'triangle', 0.2, 0.1); tone(784, 0.25, 'triangle', 0.22, 0.2); },
    whoosh() { tone(300, 0.35, 'sawtooth', 0.05, 0, 1200); },
    pop() { tone(880, 0.08, 'sine', 0.2, 0, 440); },
    drum() { for (let i = 0; i < 14; i++) tone(90 + (i % 2) * 20, 0.06, 'square', 0.05, i * 0.07); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.22, i * 0.14)); tone(1047, 0.8, 'triangle', 0.2, 0.6); tone(784, 0.8, 'triangle', 0.15, 0.6); }
  };
  window.MOLSound = S;
})();
