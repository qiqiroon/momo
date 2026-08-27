/**
 * MOMO Billiards — 音（BGM・効果音）
 * 仕様書 momo_billiards_spec.md 第11章11.9節／MOMO 共通素材 assets/readme.md
 *
 * ・BGM は共通素材 assets/bgm/ の目録（manifest.json）から選ぶ。曲名はここに書かない。
 *   洋風（game-western）を先に探し、無ければ和風（game-japanese）へ落とす。
 *   曲を足したら目録を作り直すだけでこのファイルは触らない。
 * ・撞球・衝突・クッション・ブレイク・落球は**録音した素材**を鳴らす（効果音ラボ）。
 *   もとは合成音だったが、音程のある芯が滑り落ちる作りだったため電子音に聞こえた。
 *   強さへの応じ方は素材でも残す＝強いほど大きく、わずかに高く鳴らす。
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
    // ビリヤードの音（効果音ラボ／商用可・表示不要）。合成音は電子音に聞こえたのでやめた
    bilCue: ASSETS + 'se/se-billiards-cue.mp3',
    bilBall: ASSETS + 'se/se-billiards-ball.mp3',
    bilBreak: ASSETS + 'se/se-billiards-break.mp3',
    bilPocket: ASSETS + 'se/se-billiards-pocket.mp3',
  };
  const sfxBufs = new Map(), sfxLoading = new Map();
  const sfxHead = new Map();     // 素材ごとの「頭の無音」の長さ（秒）

  /**
   * MP3 は変換のときに先頭へ 26ms ほどの無音が入る（実測）。
   * 撞いた音がそのぶん遅れて鳴ると、手応えが1テンポずれて感じられる。
   * 読み込んだ時に音の立ち上がりを測っておき、鳴らすときはそこから始める。
   */
  function measureHead(buf) {
    const ch = buf.getChannelData(0);
    const n = Math.min(ch.length, buf.sampleRate * 0.2 | 0);
    const TH = 0.01;
    for (let i = 0; i < n; i++) if (Math.abs(ch[i]) > TH) return Math.max(0, i / buf.sampleRate - 0.001);
    return 0;
  }
  function loadSfx(name) {
    const url = SFX_URLS[name]; if (!url) return Promise.resolve(null);
    if (sfxBufs.has(name)) return Promise.resolve(sfxBufs.get(name));
    if (sfxLoading.has(name)) return sfxLoading.get(name);
    ensureCtx(); if (!ctx) return Promise.resolve(null);
    const p = fetch(url).then(r => r.ok ? r.arrayBuffer() : null)
      .then(b => b ? ctx.decodeAudioData(b) : null)
      .then(buf => { if (buf) { sfxBufs.set(name, buf); sfxHead.set(name, measureHead(buf)); } return buf; })
      .catch(() => null).finally(() => sfxLoading.delete(name));
    sfxLoading.set(name, p); return p;
  }
  function preloadSfx() { Object.keys(SFX_URLS).forEach(loadSfx); }

  /**
   * 素材を鳴らす。
   * @param {object} opts at 遅らせる秒 ／ gain 音量 ／ rate 再生の速さ（＝音の高さ）
   *                      ／ lp 低い音だけ通す上限 Hz ／ pan 左右
   */
  function playBuf(name, opts) {
    if (!audioOn || !ctx || !sfxGain) return; opts = opts || {};
    const doPlay = buf => {
      if (!buf || !ctx || !sfxGain) return;
      const src = ctx.createBufferSource(); src.buffer = buf;
      if (opts.rate) src.playbackRate.value = opts.rate;
      const at = ctx.currentTime + (opts.at || 0);
      let node = src;
      if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; node = node.connect(f); }
      if (opts.gain != null) { const g = ctx.createGain(); g.gain.value = opts.gain; node = node.connect(g); }
      node.connect(opts.pan != null ? panNode(opts.pan) : sfxGain);
      src.start(at, sfxHead.get(name) || 0);      // 頭の無音を飛ばす
    };
    const cached = sfxBufs.get(name);
    if (cached) doPlay(cached); else loadSfx(name).then(doPlay);
  }

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

  function env(g, t0, a, peak, dur) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
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
    /*
     * 撞球・衝突・ブレイク・落球は録音した素材（効果音ラボ）を鳴らす。
     * 以前は合成していたが、音程のある芯が滑り落ちる作りだったため
     * 「ぴこぴこした電子音」に聞こえていた。
     * 強さへの応じ方は素材でも残す＝強く撞くほど大きく、わずかに高く鳴らす。
     */
    const s = strength != null ? strength : 0.5;
    const vary = () => 0.97 + Math.random() * 0.06;      // 同じ音が続いても機械的に聞こえないように
    switch (name) {
      case 'cue':                                                                     // 撞球音
        playBuf('bilCue', { gain: 0.35 + 0.65 * s, rate: (0.94 + 0.14 * s) * vary() }); break;
      case 'ball':                                                                    // 玉どうし
        playBuf('bilBall', { gain: 0.18 + 0.82 * s, rate: (0.90 + 0.26 * s) * vary() }); break;
      case 'cushion':                                                                 // クッション
        playBuf('bilBall', { gain: 0.14 + 0.5 * s, rate: (0.58 + 0.16 * s) * vary(), lp: 1100 }); break;
      case 'break':                                                                   // ラックが割れる
        playBuf('bilBreak', { gain: 0.55 + 0.45 * s, rate: 0.96 + 0.08 * s }); break;
      case 'pocket': playBuf('bilPocket', { gain: 0.95, rate: vary() }); break;        // 落球
      case 'jump':
        playBuf('bilBall', { gain: 0.30, rate: 0.72 * vary(), lp: 2200 }); break;
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
