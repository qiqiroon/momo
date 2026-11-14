/* MOMO 1024 — 効果音（仕様書 §17.3）。音のファイルは使わず、Web Audio でその場で作る。
   window.M1024Sound = { unlock, suspend, resume, setVolume(0..1), setMute(bool), play(name, opt) } */
(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, vol = 0.7, muted = false, noiseBuf = null;

  function ensure() {
    if (ctx || !AC) return ctx;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    apply();
    // 雑音（かちゃっ の材料）
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function apply() { if (master) master.gain.value = muted ? 0 : vol * vol; }   // 耳の感じに合わせて2乗

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function tone(freq, t, dur, opt) {
    opt = opt || {};
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t + dur);
    env(g, t, opt.a || 0.005, opt.peak || 0.3, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // かちゃっ：短い雑音を高めの帯域で鳴らし、少し低い2つ目を重ねる
  function click(t, f, peak) {
    var s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    env(g, t, 0.002, peak, 0.035);
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.1, 0.06);
  }

  var SOUNDS = {
    // opt.count：動いた札の数。多いほど、少しずらして重ねる（最大4つ）
    slide: function (t, opt) {
      var k = Math.min(4, Math.max(1, Math.ceil((opt && opt.count || 1) / 3)));
      for (var i = 0; i < k; i++) {
        var f = 2600 + Math.random() * 1400;
        click(t + i * 0.018, f, 0.5 - i * 0.07);
        click(t + i * 0.018 + 0.012, f * 0.55, 0.25);
      }
    },
    // opt.n：できた札の n。大きいほど少し高く
    merge: function (t, opt) {
      var n = opt && opt.n || 1, f = 330 * Math.pow(2, Math.min(n, 16) / 12);
      tone(f, t, 0.12, { type: 'triangle', peak: 0.35, to: f * 1.5 });
      tone(f * 2, t + 0.01, 0.08, { peak: 0.12 });
    },
    spawn: function (t) { tone(900, t, 0.09, { peak: 0.16, to: 1500 }); },
    bump: function (t) { tone(160, t, 0.08, { type: 'triangle', peak: 0.3, to: 110 }); click(t, 900, 0.2); },
    clear: function (t) {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, t + i * 0.11, 0.25, { type: 'triangle', peak: 0.3 }); });
      [1046.5, 1318.5, 1568].forEach(function (f) { tone(f, t + 0.48, 0.9, { type: 'triangle', peak: 0.18 }); });
      tone(2093, t + 0.5, 0.6, { peak: 0.06 });
    },
    over: function (t) {
      [392, 349.23, 311.13, 261.63].forEach(function (f, i) { tone(f, t + i * 0.18, 0.32, { type: 'triangle', peak: 0.25, to: f * 0.97 }); });
    }
  };

  window.M1024Sound = {
    unlock: function () { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume: function () { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setVolume: function (v) { vol = Math.max(0, Math.min(1, v)); apply(); },
    setMute: function (m) { muted = !!m; apply(); },
    play: function (name, opt) {
      if (!ctx || muted || vol <= 0 || ctx.state !== 'running' || !SOUNDS[name]) return;
      try { SOUNDS[name](ctx.currentTime + 0.005, opt); } catch (e) {}
    }
  };
})();
