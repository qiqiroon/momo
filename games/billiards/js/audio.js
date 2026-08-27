/**
 * MOMO Billiards — 音（BGM・効果音）
 * 仕様書 momo_billiards_spec.md 第11章11.9節／MOMO 共通素材 assets/readme.md
 *
 * ・BGM は共通素材 assets/bgm/ の目録（manifest.json）から選ぶ。曲名はここに書かない。
 *   洋風フォルダ（game-western）がまだ空なので、無ければ game-japanese へ落とす。
 *   曲を足したら目録を作り直すだけでこのファイルは触らない。
 * ・撞球音・玉どうしの衝突音・クッション音は素材ではなく合成音にした。
 *   強さに応じて音の高さと大きさが変わる必要があり、固定の音源では手応えが返らないため。
 * ・音は表示層に属し、決定論の対象外（11.9.2節）。物理の結果に影響してはならない。
 */
const BilliardsAudio = (() => {
  'use strict';

  const ASSETS = '../../assets/';
  const KEY_BGM = 'billiards_bgm_vol', KEY_SFX = 'billiards_sfx_vol';
  const KEY_BGM_MUTE = 'billiards_bgm_muted', KEY_SFX_MUTE = 'billiards_sfx_muted';
  const DEF_BGM = 35, DEF_SFX = 55;

  // プール名 → BGM フォルダの候補（先頭から順に、目録にあるものを使う）
  const BGM_FOLDERS = { lobby: ['lobby'], game: ['game-western', 'game-japanese'] };

  let ctx = null, bgmGain = null, sfxGain = null;
  let bgmVol = DEF_BGM, sfxVol = DEF_SFX, loaded = false;
  let bgmMuted = false, sfxMuted = false;
  let audioOn = false, desiredPool = 'lobby';

  function clampVol(v) { v = v | 0; return v < 0 ? 0 : v > 100 ? 100 : v; }
  function loadPersisted() {
    if (loaded) return; loaded = true;
    try {
      const b = localStorage.getItem(KEY_BGM), s = localStorage.getItem(KEY_SFX);
      if (b !== null) bgmVol = clampVol(+b);
      if (s !== null) sfxVol = clampVol(+s);
      bgmMuted = localStorage.getItem(KEY_BGM_MUTE) === '1';
      sfxMuted = localStorage.getItem(KEY_SFX_MUTE) === '1';
    } catch (e) {}
  }
  function applyGains() {
    if (bgmGain) bgmGain.gain.value = bgmMuted ? 0 : bgmVol / 100;
    if (sfxGain) sfxGain.gain.value = sfxMuted ? 0 : sfxVol / 100;
  }
  function persistMute() {
    try {
      localStorage.setItem(KEY_BGM_MUTE, bgmMuted ? '1' : '0');
      localStorage.setItem(KEY_SFX_MUTE, sfxMuted ? '1' : '0');
    } catch (e) {}
  }
  function ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    bgmGain = ctx.createGain(); sfxGain = ctx.createGain();
    applyGains();
    bgmGain.connect(ctx.destination); sfxGain.connect(ctx.destination);
  }

  function getBgmVolume() { loadPersisted(); return bgmVol; }
  function getSfxVolume() { loadPersisted(); return sfxVol; }
  function setBgmVolume(v) { loadPersisted(); bgmVol = clampVol(v); try { localStorage.setItem(KEY_BGM, String(bgmVol)); } catch (e) {} applyGains(); }
  function setSfxVolume(v) { loadPersisted(); sfxVol = clampVol(v); try { localStorage.setItem(KEY_SFX, String(sfxVol)); } catch (e) {} applyGains(); }
  function getMuted(kind) { loadPersisted(); return kind === 'sfx' ? sfxMuted : bgmMuted; }
  function setMuted(kind, val) {
    loadPersisted(); val = !!val;
    if (kind === 'sfx') sfxMuted = val; else bgmMuted = val;
    persistMute(); applyGains();
    if (kind !== 'sfx' && !val && audioOn) { resumeCtx(); if (!curSource) playRandomBgm(desiredPool); }
  }

  // ───────── BGM ─────────
  let bgmManifest = null, bgmFetching = null;
  function loadBgmManifest() {
    if (bgmManifest) return Promise.resolve(bgmManifest);
    if (bgmFetching) return bgmFetching;
    bgmFetching = fetch(ASSETS + 'bgm/manifest.json')
      .then(r => r.ok ? r.json() : null)
      .then(m => { bgmManifest = m; return m; })
      .catch(() => null)
      .finally(() => { bgmFetching = null; });
    return bgmFetching;
  }
  async function bgmPoolUrls(pool) {
    const m = await loadBgmManifest();
    if (!m) return [];
    for (const folder of (BGM_FOLDERS[pool] || [])) {
      const files = m[folder];
      if (files && files.length) return files.map(f => ASSETS + 'bgm/' + folder + '/' + f);
    }
    console.warn('[audio] BGM の目録に "' + pool + '" 用のフォルダがありません (assets/bgm/manifest.json)');
    return [];
  }

  const bgmBufs = new Map(), bgmLoading = new Map();
  let curSource = null, curPool = null, reqGen = 0;
  function loadBgm(url) {
    if (bgmBufs.has(url)) return Promise.resolve(bgmBufs.get(url));
    if (bgmLoading.has(url)) return bgmLoading.get(url);
    ensureCtx(); if (!ctx) return Promise.resolve(null);
    const p = fetch(url).then(r => r.ok ? r.arrayBuffer() : null)
      .then(b => b ? ctx.decodeAudioData(b) : null)
      .then(buf => { if (buf) bgmBufs.set(url, buf); return buf; })
      .catch(() => null)
      .finally(() => bgmLoading.delete(url));
    bgmLoading.set(url, p); return p;
  }
  function stopBgm() {
    reqGen++;
    if (curSource) { try { curSource.stop(); } catch (e) {} curSource = null; }
    curPool = null;
  }
  async function playRandomBgm(pool) {
    if (curPool === pool && curSource) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const myGen = ++reqGen;
    ensureCtx(); if (!ctx || !bgmGain) return;
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
    if (myGen !== reqGen) return;
    const urls = await bgmPoolUrls(pool);
    if (myGen !== reqGen || !urls.length) return;
    // 曲選びは演出であって盤面に影響しない。共有PRNGは使わない（5.2.4節）
    const url = urls[Math.floor(Math.random() * urls.length)];
    const buf = await loadBgm(url);
    if (myGen !== reqGen || !buf || !ctx || !bgmGain) return;
    if ((typeof document !== 'undefined' && document.hidden) || ctx.state !== 'running') return;
    if (curSource) { try { curSource.stop(); } catch (e) {} curSource = null; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.connect(bgmGain); src.start();
    curSource = src; curPool = pool;
  }
  function setBgm(mode) {
    const pool = (mode === 'lobby') ? 'lobby' : (mode === 'off') ? null : 'game';
    if (pool === null) { stopBgm(); desiredPool = 'game'; return; }
    desiredPool = pool;
    if (audioOn) playRandomBgm(pool);
  }

  async function resumeCtx() { ensureCtx(); if (!ctx) return; if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} } }
  async function suspendCtx() { if (!ctx) return; if (ctx.state === 'running') { try { await ctx.suspend(); } catch (e) {} } }
  async function enable() { loadPersisted(); audioOn = true; bgmMuted = false; sfxMuted = false; persistMute(); applyGains(); await resumeCtx(); playRandomBgm(desiredPool); preloadSfx(); }
  async function enableMuted() { loadPersisted(); audioOn = true; bgmMuted = true; sfxMuted = true; persistMute(); applyGains(); await resumeCtx(); preloadSfx(); }
  async function enableAuto() { loadPersisted(); audioOn = true; applyGains(); await resumeCtx(); if (!bgmMuted) playRandomBgm(desiredPool); preloadSfx(); }
  function isOn() { return audioOn; }

  // 可視性：隠れたらBGMを止め、復帰しても「次の操作」まで鳴らし直さない
  let visBound = false;
  function bindVisibility() {
    if (visBound) return; visBound = true;
    let armed = false;
    const armResume = () => {
      if (!audioOn || armed) return;
      armed = true;
      const h = () => {
        armed = false;
        window.removeEventListener('pointerdown', h);
        window.removeEventListener('keydown', h);
        if (audioOn && !bgmMuted) { resumeCtx(); playRandomBgm(desiredPool); }
      };
      window.addEventListener('pointerdown', h, { once: true });
      window.addEventListener('keydown', h, { once: true });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { stopBgm(); suspendCtx(); }
      else if (audioOn) { resumeCtx(); armResume(); }
    });
    window.addEventListener('pagehide', () => { stopBgm(); suspendCtx(); });
    window.addEventListener('pageshow', e => { if (e.persisted) { stopBgm(); armResume(); } });
  }

  // ───────── 効果音：素材（共通 assets/se/） ─────────
  const SFX_URLS = {
    button: ASSETS + 'se/se-button.mp3',
    select: ASSETS + 'se/se-select.mp3',
    fanfare: ASSETS + 'se/se-fanfare-win.mp3',
    fanfare2: ASSETS + 'se/se-fanfare-win-2.mp3',
    lose: ASSETS + 'se/se-game-lose.mp3',
    chatRecv: ASSETS + 'se/se-chat-recv.mp3',
  };
  const sfxBufs = new Map(), sfxLoading = new Map();
  function loadSfx(name) {
    const url = SFX_URLS[name]; if (!url) return Promise.resolve(null);
    if (sfxBufs.has(name)) return Promise.resolve(sfxBufs.get(name));
    if (sfxLoading.has(name)) return sfxLoading.get(name);
    ensureCtx(); if (!ctx) return Promise.resolve(null);
    const p = fetch(url).then(r => r.ok ? r.arrayBuffer() : null)
      .then(b => b ? ctx.decodeAudioData(b) : null)
      .then(buf => { if (buf) sfxBufs.set(name, buf); return buf; })
      .catch(() => null).finally(() => sfxLoading.delete(name));
    sfxLoading.set(name, p); return p;
  }
  function preloadSfx() { Object.keys(SFX_URLS).forEach(loadSfx); warmup(); }

  /**
   * 合成音の道を一度だけ空回しして温めておく。
   * ブレイクは玉の音を20個ほど同時に組み立てるが、その1回目だけ 26ms かかり
   * （実測）、よりによってブレイクの瞬間に画面が引っかかる。
   * 出口をどこにも繋がない入れ物にするので、音は出ない。
   */
  let warmed = false;
  function warmup() {
    if (warmed || !ctx) return;
    warmed = true;
    const dead = ctx.createGain(); dead.gain.value = 0;   // destination へ繋がない＝無音
    const t = ctx.currentTime;
    // 実際に使う長さの雑音を先に作っておく（撞球・玉・クッション・ブレイク）
    [0.02, 0.045, 0.05, 0.06, 0.075, 0.09, 0.35].forEach(noiseBuf);
    for (let i = 0; i < 24; i++) {
      let out = dead;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.connect(dead); out = p; }
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.045);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      const g = ctx.createGain(); env(g, t, 0.001, 0.0002, 0.02);
      src.connect(bp).connect(g).connect(out); src.start(t); src.stop(t + 0.03);
      const o = ctx.createOscillator(); o.type = 'triangle';
      const g2 = ctx.createGain(); g2.gain.value = 0;
      o.connect(g2).connect(out); o.start(t); o.stop(t + 0.03);
    }
  }
  function playBuf(name, opts) {
    if (!audioOn || !ctx || !sfxGain) return; opts = opts || {};
    const doPlay = buf => {
      if (!buf || !ctx || !sfxGain) return;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const at = ctx.currentTime + (opts.at || 0);
      if (opts.gain != null) { const g = ctx.createGain(); g.gain.value = opts.gain; src.connect(g).connect(sfxGain); }
      else src.connect(sfxGain);
      src.start(at);
    };
    const cached = sfxBufs.get(name);
    if (cached) doPlay(cached); else loadSfx(name).then(doPlay);
  }

  // ───────── 効果音：合成（打球・衝突・クッション・落球） ─────────
  /*
   * 雑音の素は長さごとに1本だけ作って使い回す。
   * 毎回作り直すと、鳴らすたびに数千個の乱数を書き込むことになり、
   * 20個を同時に組み立てるブレイクで、その1回目に画面が引っかかる。
   * 中身が同じでも、通す帯域・音量・長さ・左右が違うので聞き分けはつかない。
   */
  /*
   * 左右へ寄せる装置は5か所ぶんだけ作って使い回す。
   * 音1つごとに作ると、ブレイクの一瞬で百個以上の部品を組むことになる。
   */
  const panners = new Map();
  function panNode(pan) {
    if (!ctx.createStereoPanner) return sfxGain;
    const k = Math.max(-2, Math.min(2, Math.round(pan * 2.5)));
    let n = panners.get(k);
    if (!n) { n = ctx.createStereoPanner(); n.pan.value = k / 2.5; n.connect(sfxGain); panners.set(k, n); }
    return n;
  }

  const noiseCache = new Map();
  function noiseBuf(dur) {
    const n = Math.max(1, (ctx.sampleRate * dur) | 0);
    const key = n >> 6;                      // 近い長さは同じものを使う
    const hit = noiseCache.get(key);
    if (hit && hit.length >= n) return hit;
    const len = Math.max(n, (key + 1) << 6);
    const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(key, b);
    return b;
  }
  function env(g, t0, a, peak, dur) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  // strength: 0〜1。撞いた強さ・当たった速さをそのまま音へ返す
  /**
   * 玉どうしがぶつかる音。撞球音・クッション音もこれの味付け違い。
   * @param {number} [at] 鳴らす時刻（省略時は今すぐ）。ブレイクで粒をばらまくのに使う
   * @param {number} [pan] 左右の寄せ -1〜1
   */
  function clack(strength, baseFreq, dur, tone, at, pan) {
    if (!audioOn || !ctx || !sfxGain) return;
    const s = Math.max(0.04, Math.min(1, strength));
    const t = at != null ? at : ctx.currentTime + 0.005;
    const out = (pan != null) ? panNode(pan) : sfxGain;
    const f = baseFreq * (0.82 + 0.45 * s);
    // 打点（短いノイズ）
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = tone || 2.2;
    bp.frequency.setValueAtTime(f * 1.6, t);
    bp.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
    const g = ctx.createGain(); env(g, t, 0.0015, 0.55 * s + 0.06, dur);
    src.connect(bp).connect(g).connect(out); src.start(t); src.stop(t + dur + 0.02);
    // 芯（正弦）
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + dur * 0.9);
    const g2 = ctx.createGain(); env(g2, t, 0.001, 0.30 * s + 0.03, dur * 0.9);
    o.connect(g2).connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  /**
   * ブレイクの音。
   * ラックが割れる瞬間は 1 コマに 12 発の衝突が同時に来る（実測）。
   * それを 12 回の同じ衝突音で鳴らすと団子になって、ただの雑音に聞こえる。
   * そこで「一発の大きな割れ」＋「散らばっていく粒」＋「下に敷く唸り」の
   * 3 層に作り替えて、一度きりの出来事として鳴らす。
   * @param {number} strength 0〜1
   */
  function breakSlam(strength) {
    if (!audioOn || !ctx || !sfxGain) return;
    const s = Math.max(0.3, Math.min(1, strength == null ? 0.8 : strength));
    const t = ctx.currentTime + 0.005;
    const BALL_F = 1500, BALL_D = 0.045, BALL_Q = 3.0;   // 玉どうしの音の味付け（'ball' と同じ）

    /*
     * ブレイクは「玉どうしの衝突がたくさん、ほぼ同時に起きる」出来事なので、
     * 材料は玉の音そのものにする。低い唸りやノイズの掃引を足すと、
     * ビリヤードではなく破裂音になる（一度そうして作り直した）。
     */
    // ① 手玉が先頭の玉を叩く最初の一撃。いちばん強く、わずかに長い
    clack(1.0, BALL_F, 0.06, BALL_Q, t, 0);
    // ② その直後、先頭の玉が後ろの玉へ押し込む厚み。音の高さだけ下げて重さを出す
    clack(0.85 * s + 0.15, BALL_F * 0.62, 0.075, 2.2, t + 0.006, 0);

    /*
     * ③ 広がっていく玉どうしの衝突。だんだん間延びし、弱くなり、左右へ散る。
     * 20個ぶんを一度に組み立てると1コマ（16.7ms）に収まらないので、
     * 3回に分けて組む。鳴らす時刻は先に決めてあるので、音のほうはずれない。
     */
    const n = 10 + Math.round(9 * s);
    const one = i => {
      const at = t + 0.03 + Math.pow(i / n, 0.8) * 0.55 + Math.random() * 0.045;
      const lvl = (1 - i / n) * 0.62 + 0.10;
      const freq = BALL_F * (0.75 + Math.random() * 0.75);
      clack(s * lvl, freq, BALL_D, BALL_Q, at, (Math.random() * 2 - 1) * 0.8);
    };
    const chunk = Math.ceil(n / 3);
    for (let i = 0; i < chunk; i++) one(i);
    setTimeout(() => { for (let i = chunk; i < chunk * 2 && i < n; i++) one(i); }, 0);
    setTimeout(() => { for (let i = chunk * 2; i < n; i++) one(i); }, 16);
  }

  function pocketDrop() {
    if (!audioOn || !ctx || !sfxGain) return;
    const t = ctx.currentTime + 0.005;
    // ころんと落ちて転がる：下がる2音＋短い転がりノイズ
    [[520, 0, 0.10], [300, 0.09, 0.20]].forEach(a => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = a[0];
      const g = ctx.createGain(); env(g, t + a[1], 0.004, 0.34, a[2]);
      o.connect(g).connect(sfxGain); o.start(t + a[1]); o.stop(t + a[1] + a[2] + 0.02);
    });
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.35);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); env(g, t + 0.10, 0.02, 0.14, 0.32);
    src.connect(lp).connect(g).connect(sfxGain); src.start(t + 0.10); src.stop(t + 0.45);
  }
  /** 単音。秒読みと時間切れに使う */
  function beep(freq, dur, peak, delay) {
    if (!audioOn || !ctx || !sfxGain) return;
    const t = ctx.currentTime + 0.005 + (delay || 0);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = ctx.createGain(); env(g, t, 0.004, peak, dur);
    o.connect(g).connect(sfxGain); o.start(t); o.stop(t + dur + 0.02);
  }
  function tick2(f1, f2) {
    if (!audioOn || !ctx || !sfxGain) return;
    const t = ctx.currentTime + 0.005;
    [[f1, 0, 0.09], [f2, 0.07, 0.13]].forEach(a => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = a[0];
      const g = ctx.createGain(); env(g, t + a[1], 0.004, 0.26, a[2]);
      o.connect(g).connect(sfxGain); o.start(t + a[1]); o.stop(t + a[1] + a[2] + 0.02);
    });
  }

  /**
   * 効果音の統一入口。
   * @param {string} name
   * @param {number} strength 0〜1（打球・衝突の強さ）
   */
  function sfx(name, strength) {
    if (!audioOn || !ctx || !sfxGain) return;
    switch (name) {
      case 'cue': clack(strength != null ? strength : 0.6, 320, 0.075, 1.4); break;   // 撞球音
      case 'ball': clack(strength != null ? strength : 0.5, 1500, 0.045, 3.0); break; // 玉どうし
      case 'cushion': clack(strength != null ? strength : 0.5, 240, 0.09, 1.0); break;// クッション
      case 'break': breakSlam(strength); break;                                       // ラックが割れる
      case 'pocket': pocketDrop(); break;                                             // 落球
      case 'jump': clack(0.35, 900, 0.05, 2.0); break;
      case 'foul': tick2(330, 220); break;
      case 'tick': beep(1046, 0.07, 0.22); break;        // 残り5秒からの秒読み
      case 'timeup': beep(392, 0.16, 0.30); beep(294, 0.30, 0.26, 0.14); break;
      case 'turn': tick2(880, 1318); break;   // 自分の手番
      case 'join': tick2(988, 659); break;
      case 'button': playBuf('button', { gain: 0.85 }); break;
      case 'select': playBuf('select', { gain: 0.7 }); break;
      case 'win': playBuf('fanfare'); playBuf('fanfare2', { at: 0.8 }); break;
      case 'lose': playBuf('lose'); break;
      case 'chat': playBuf('chatRecv', { gain: 0.9 }); break;
    }
  }

  return {
    getBgmVolume, getSfxVolume, setBgmVolume, setSfxVolume, getMuted, setMuted,
    enable, enableMuted, enableAuto, isOn, setBgm, stopBgm, playRandomBgm,
    bindVisibility, sfx, preloadSfx,
  };
})();

if (typeof window !== 'undefined') window.BilliardsAudio = BilliardsAudio;
