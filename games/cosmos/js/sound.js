/*
 * MOMO Cosmos — 音（仕様書 第16章）
 * BGM は共通の assets/bgm/ から目録（manifest.json）を読んで選ぶ。曲の性格ごとのフォルダ：
 *   lobby（タイトル・全アプリ共通）／game-cosmos（通常期とブラックホール期）／ending-cosmos（エンディング）
 * 音量は Web Audio の GainNode でかける（iPhone は audio 要素の volume が効かないため）。
 * 効果音（2026-10-30〜）：短い音はファイルを読み込んで AudioBuffer で鳴らす。着地の「とん」はプログラムで作る。
 *   同じ音が短い間に重なりすぎないよう、最短の間と同時に鳴らす数を決めている（config.js の se）。
 */
(function (root) {
  'use strict';

  const BGM_BASE = '../../assets/bgm/';
  const FADE_SEC = 0.8;

  class CosmosSound {
    /** getSet：設定（se, bgm, seMute, bgmMute）を返す関数 */
    constructor(getSet, seConf) {
      this.getSet = getSet;
      this.seConf = seConf;
      this.seGain = null;
      this.buf = {};             // 効果音の AudioBuffer（ファイルの場所ごと）
      this.voices = {};          // 鳴っている数
      this.lastAt = {};          // 最後に鳴らした時刻（ms）
      this.ac = null; this.bgmGain = null;
      this.sceneGain = null;     // 場面の音量（最終吸収でだんだん小さくする。第12.1節）。利用者の音量とは別
      this.sceneLevel = 1;
      this.pool = null;          // 目録：{ フォルダ名: [ファイル名…] }
      this.folder = null;        // 鳴らしたいフォルダ
      this.cur = null;           // 鳴っている曲：{ el, gain, folder, file }
      this.last = {};            // フォルダごとの直前の曲（同じ曲を続けない）
      this.loops = 0;            // 今のフォルダで、曲が終わって次を鳴らした回数（エンドロールのレシピに使う）
      this._loadPool();
    }

    async _loadPool() {
      try {
        const r = await fetch(BGM_BASE + 'manifest.json', { cache: 'no-cache' });
        this.pool = await r.json();
      } catch (e) { console.warn('[cosmos] BGM の目録を読めません', e); this.pool = {}; }
      if (this.ac && this.folder) this._play(this.folder);
    }

    /** 利用者の操作の中で呼ぶ（音の許可パネルの「再生する／再生しない」） */
    unlock() {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      if (!this.ac) {
        this.ac = new AC();
        this.bgmGain = this.ac.createGain();
        this.bgmGain.connect(this.ac.destination);
        this.sceneGain = this.ac.createGain();
        this.sceneGain.gain.value = this.sceneLevel;
        this.sceneGain.connect(this.bgmGain);
        this.seGain = this.ac.createGain();
        this.seGain.connect(this.ac.destination);
        this.applyGain(true);
        this._loadSe();
      }
      this.resume();   // 1時間以上離れて戻ったとき：止めていた曲もここで再開する
      if (this.folder && !this.cur) this._play(this.folder);
    }

    get unlocked() { return !!this.ac; }

    /** 設定パネルの音量・ミュートを反映 */
    applyGain(now) {
      if (!this.ac) return;
      const S = this.getSet(), v = S.bgmMute ? 0 : S.bgm / 100 * 0.9;
      this.bgmGain.gain.setTargetAtTime(v, this.ac.currentTime, now ? 0.001 : 0.03);
      this.seGain.gain.setTargetAtTime(S.seMute ? 0 : S.se / 100, this.ac.currentTime, now ? 0.001 : 0.03);
    }

    // ---- 効果音 ----
    _loadSe() {
      const files = (this.seConf && this.seConf.files) || {};
      new Set(Object.values(files)).forEach(path => {
        fetch(path).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(b => this.ac.decodeAudioData(b)).then(buf => { this.buf[path] = buf; })
          .catch(e => console.warn('[cosmos] 効果音を読めません', path, e));
      });
    }

    /** 効果音を鳴らす。opt.rate＝高さ（再生の速さ）、opt.vol＝音量の倍率 */
    se(name, opt) {
      const C = this.seConf;
      if (!this.ac || !C || this.ac.state !== 'running') return;
      const now = performance.now(), gap = C.minGapMs[name] || 40, max = C.maxVoices[name] || 2;
      if (now - (this.lastAt[name] || -1e9) < gap || (this.voices[name] || 0) >= max) return;
      const vol = (C.vol[name] || 1) * (opt && opt.vol != null ? opt.vol : 1);
      let node;
      if (name === 'land') node = this._thud(vol);
      else {
        const buf = this.buf[C.files[name]];
        if (!buf) return;
        const src = this.ac.createBufferSource(), g = this.ac.createGain();
        src.buffer = buf; src.playbackRate.value = (opt && opt.rate) || 1; g.gain.value = vol;
        src.connect(g).connect(this.seGain); src.start();
        node = src;
      }
      this.lastAt[name] = now;
      this.voices[name] = (this.voices[name] || 0) + 1;
      node.onended = () => { this.voices[name]--; };
    }

    /** ビッグバンの重低音：下がっていく低い音と、こもった雑音（試聴ページと同じ作り。2.4秒） */
    rumble() {
      if (!this.ac || this.ac.state !== 'running') return;
      const c = this.ac, t = c.currentTime, dur = 2.4, v = (this.seConf.vol.rumble || 1);
      const o = c.createOscillator(), og = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + dur);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.03); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(og).connect(this.seGain); o.start(t); o.stop(t + dur);
      const nb = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
      ns.buffer = nb; lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(80, t + dur);
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      ns.connect(lp).connect(ng).connect(this.seGain); ns.start(t);
    }

    // 着地・衝突の小さな「とん」：低い音を短く減衰させる
    _thud(vol) {
      const c = this.ac, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.6 * vol), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(this.seGain); o.start(t); o.stop(t + 0.16);
      return o;
    }

    /** 場面の音量を sec 秒かけて v（0〜1）にする */
    scene(v, sec) {
      this.sceneLevel = v;
      if (!this.ac) return;
      const g = this.sceneGain.gain, now = this.ac.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      if (sec > 0) g.linearRampToValueAtTime(v, now + sec); else g.setValueAtTime(v, now);
    }

    /** 場面に合わせて鳴らすフォルダを選ぶ（同じなら何もしない。null で止める） */
    setFolder(folder) {
      if (folder === this.folder) return;
      this.folder = folder;
      this.loops = 0;
      if (!this.ac) return;          // 許可パネルの前は鳴らさない
      this._play(folder);
    }

    // ページが隠れている間は曲そのものも止める。音の出口（AudioContext）だけ止めると、
    // 曲は無音のまま先へ進み、戻ったときに途中や別の曲から鳴って「勝手に切り替わった」ように聞こえる
    suspend() {
      if (this.cur) this.cur.el.pause();
      if (this.ac && this.ac.state === 'running') this.ac.suspend();
    }
    resume() {
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
      if (this.cur && this.cur.el.paused) this.cur.el.play().catch(() => {});
    }

    _pick(folder) {
      const list = (this.pool && this.pool[folder]) || [];
      if (!list.length) return null;
      const cand = list.length > 1 ? list.filter(f => f !== this.last[folder]) : list;
      const f = cand[Math.floor(Math.random() * cand.length)];
      this.last[folder] = f;
      return f;
    }

    _play(folder) {
      if (!this.pool) return;        // 目録を読み終えたら鳴らし直す
      this._fadeOut(this.cur);
      this.cur = null;
      const file = folder && this._pick(folder);
      if (!file) return;
      const el = new Audio(BGM_BASE + folder + '/' + file);
      el.preload = 'auto';
      const src = this.ac.createMediaElementSource(el), g = this.ac.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.sceneGain);
      g.gain.setTargetAtTime(1, this.ac.currentTime, FADE_SEC / 3);
      const track = { el, gain: g, folder, file };
      // 曲が終わったら同じフォルダの別の曲へ
      el.addEventListener('ended', () => { if (this.cur === track) { this.loops++; this._play(this.folder); } });
      el.play().catch(e => console.warn('[cosmos] BGM を再生できません', e));
      this.cur = track;
    }

    _fadeOut(track) {
      if (!track) return;
      track.gain.gain.setTargetAtTime(0, this.ac.currentTime, FADE_SEC / 3);
      setTimeout(() => { track.el.pause(); track.el.src = ''; }, FADE_SEC * 1000 + 200);
    }
  }

  root.CosmosSound = CosmosSound;
})(window);
