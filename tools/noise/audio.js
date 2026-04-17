// audio.js - MOMO Noise Audio Engine v0.04
'use strict';

const AudioEngine = (() => {
  const VERSION = 'v0.04';
  let ctx         = null;
  let masterGain  = null;
  let masterVol   = 1.0;
  let masterPitch = 1.0;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVol;
    masterGain.connect(ctx.destination);
  }

  async function resume() {
    if (!ctx) return;
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch(e) {}
    }
    // Poll until running or timeout
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) {
      await new Promise(r => setTimeout(r, 50));
      try { await ctx.resume(); } catch(e) {}
    }
  }

  function getCtx()  { return ctx; }
  function getState(){ return ctx ? ctx.state : 'none'; }
  function getCurrentTime() { return ctx ? ctx.currentTime : 0; }

  // ── Silence trim ──────────────────────────────────────────────────────
  function trimSilence(buffer, thresholdDb = -40) {
    const thr = Math.pow(10, thresholdDb / 20);
    const ch  = buffer.getChannelData(0);
    let s = 0, e = ch.length - 1;
    while (s < ch.length && Math.abs(ch[s]) < thr) s++;
    while (e > s         && Math.abs(ch[e]) < thr) e--;
    if (s >= e) return buffer;
    const out = ctx.createBuffer(buffer.numberOfChannels, e - s + 1, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++)
      out.getChannelData(c).set(buffer.getChannelData(c).subarray(s, e + 1));
    return out;
  }

  // ── Decode ────────────────────────────────────────────────────────────
  async function decodeFile(ab) {
    init();
    return new Promise((res, rej) => {
      ctx.decodeAudioData(ab.slice(0), res, rej);
    }).then(buf => trimSilence(buf));
  }

  // ── Record ────────────────────────────────────────────────────────────
  let recorder = null;
  let chunks   = [];

  async function startRecording() {
    init();
    await resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];

    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    let mime = '';
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } } catch(e) {}
    }

    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch(e) {
      recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    // timeslice=100ms: data flows continuously, prevents head loss on iOS
    // Wait for 'start' event before resolving so UI can safely show stop button
    await new Promise(res => {
      recorder.onstart = res;
      recorder.start(100);
    });
    // recorder.state === 'recording' guaranteed here
  }

  async function stopRecording() {
    if (!recorder) return null;
    const blob = await new Promise(res => {
      recorder.onstop = () => res(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.stop();
      recorder.stream.getTracks().forEach(t => t.stop());
    });
    recorder = null;
    const ab = await blob.arrayBuffer();
    return new Promise((res, rej) => {
      ctx.decodeAudioData(ab.slice(0), buf => res(trimSilence(buf)), rej);
    });
  }

  function isRecording() { return recorder && recorder.state === 'recording'; }

  // ── Play ──────────────────────────────────────────────────────────────
  function play(buffer, { volume = 1.0, pitch = 1.0, loop = false, startAt = null, onEnded = null } = {}) {
    if (!ctx || !buffer) return () => {};
    if (ctx.state !== 'running') ctx.resume().catch(() => {});

    const src  = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop   = loop;
    src.playbackRate.value = Math.max(0.1, pitch * masterPitch);

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, volume * masterVol);
    src.connect(gain);
    gain.connect(masterGain);

    if (onEnded) src.onended = onEnded;
    const when = startAt !== null ? Math.max(ctx.currentTime, startAt) : ctx.currentTime;
    src.start(when);
    return () => { try { src.stop(); } catch(e) {} };
  }

  // ── WAV export ────────────────────────────────────────────────────────
  function bufferToWav(buffer) {
    const nCh = buffer.numberOfChannels;
    const sr  = buffer.sampleRate;
    const len = buffer.length;
    const bps = 2; // 16-bit
    const ab  = new ArrayBuffer(44 + len * nCh * bps);
    const v   = new DataView(ab);
    const w   = (s, o) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w('RIFF', 0); v.setUint32(4, 36 + len * nCh * bps, true);
    w('WAVE', 8); w('fmt ', 12);
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nCh * bps, true); v.setUint16(32, nCh * bps, true);
    v.setUint16(34, 16, true); w('data', 36); v.setUint32(40, len * nCh * bps, true);
    let off = 44;
    for (let i = 0; i < len; i++)
      for (let c = 0; c < nCh; c++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
      }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function setMasterVolume(v) { masterVol = v; if (masterGain) masterGain.gain.value = v; }
  function setMasterPitch(p) { masterPitch = p; }

  return { VERSION, init, resume, getCtx, getState, getCurrentTime,
           decodeFile, startRecording, stopRecording, isRecording,
           play, bufferToWav, setMasterVolume, setMasterPitch };
})();
