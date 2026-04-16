// audio.js - MOMO Noise Audio Engine
'use strict';

const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let masterVolume = 1.0;
  let masterPitch = 1.0;

  // Initialize AudioContext (must be called after user gesture)
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ctx.destination);
  }

  function getCtx() { return ctx; }

  // ── Trim silence from AudioBuffer ──────────────────────────────────────
  function trimSilence(buffer, thresholdDb = -40) {
    const threshold = Math.pow(10, thresholdDb / 20);
    const ch = buffer.getChannelData(0);
    let start = 0, end = ch.length - 1;

    while (start < ch.length && Math.abs(ch[start]) < threshold) start++;
    while (end > start   && Math.abs(ch[end])   < threshold) end--;

    if (start >= end) return buffer; // all silence, return as-is

    const trimmed = ctx.createBuffer(
      buffer.numberOfChannels,
      end - start + 1,
      buffer.sampleRate
    );
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      trimmed.getChannelData(c).set(buffer.getChannelData(c).subarray(start, end + 1));
    }
    return trimmed;
  }

  // ── Decode audio file (ArrayBuffer → AudioBuffer) ──────────────────────
  async function decodeFile(arrayBuffer) {
    init();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return trimSilence(decoded);
  }

  // ── Record from microphone ─────────────────────────────────────────────
  let mediaRecorder = null;
  let recordingChunks = [];
  let recordingResolve = null;

  async function startRecording() {
    init();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];

    // Pick first supported mimeType, fall back to browser default
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ];
    const mimeType = candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';

    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordingChunks.push(e.data); };
    mediaRecorder.start(100);
    // Resolves immediately — caller can now show stop button
  }

  async function stopRecording() {
    if (!mediaRecorder) return null;
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());

    const blob = await new Promise(resolve => {
      mediaRecorder.onstop = () => {
        resolve(new Blob(recordingChunks, { type: mediaRecorder.mimeType }));
      };
    });
    mediaRecorder = null;

    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return trimSilence(decoded);
  }

  function isRecording() {
    return mediaRecorder && mediaRecorder.state === 'recording';
  }

  // ── Play AudioBuffer ───────────────────────────────────────────────────
  // Returns a stop function
  function play(buffer, options = {}) {
    if (!ctx || !buffer) return () => {};
    const { volume = 1.0, pitch = 1.0, loop = false, startAt = null, onEnded = null } = options;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = pitch * masterPitch;

    const gain = ctx.createGain();
    gain.gain.value = volume * masterVolume;

    source.connect(gain);
    gain.connect(masterGain);

    if (onEnded) source.onended = onEnded;

    const when = startAt !== null ? startAt : ctx.currentTime;
    source.start(when);

    return () => {
      try { source.stop(); } catch(e) {}
    };
  }

  // ── Export AudioBuffer as WAV Blob ─────────────────────────────────────
  function bufferToWav(buffer) {
    const numCh   = buffer.numberOfChannels;
    const sr      = buffer.sampleRate;
    const length  = buffer.length;
    const bitDepth = 16;
    const byteRate = sr * numCh * (bitDepth / 8);
    const blockAlign = numCh * (bitDepth / 8);
    const dataSize = length * numCh * (bitDepth / 8);

    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    const write = (s, o) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    write('RIFF', 0);
    view.setUint32(4,  36 + dataSize, true);
    write('WAVE', 8);
    write('fmt ', 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    write('data', 36);
    view.setUint32(40, dataSize, true);

    // Interleave channels
    const offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numCh; c++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
        const s16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset + (i * numCh + c) * 2, s16, true);
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  // ── Master controls ────────────────────────────────────────────────────
  function setMasterVolume(v) {
    masterVolume = v;
    if (masterGain) masterGain.gain.value = v;
  }
  function setMasterPitch(p) { masterPitch = p; }
  function getCurrentTime() { return ctx ? ctx.currentTime : 0; }

  return { init, getCtx, decodeFile, startRecording, stopRecording, isRecording, play, bufferToWav, setMasterVolume, setMasterPitch, getCurrentTime };
})();
