// metro.js - MOMO Noise Metronome & Rhythm Sync v0.03
'use strict';

const Metro = (() => {
  let bpm         = 120;
  let running     = false;
  let beatOrigin  = 0;   // AudioContext time of beat 0
  let onBeatCb    = null;
  let schedTimer  = null;
  let lastScheduled = -1; // beat index last scheduled

  const LOOKAHEAD_MS = 25;
  const SCHEDULE_SEC = 0.15;

  function beatDur()  { return 60.0 / bpm; }
  function isRunning(){ return running; }
  function getBpm()   { return bpm; }

  function setBpm(b) {
    bpm = Math.max(20, Math.min(300, b));
    // If running, rebase origin so beats stay aligned
    if (running) {
      const now    = AudioEngine.getCurrentTime();
      const phase  = (now - beatOrigin) % beatDur();
      beatOrigin   = now - phase;
      lastScheduled = Math.floor((now - beatOrigin) / beatDur()) - 1;
    }
  }

  function schedule() {
    const now     = AudioEngine.getCurrentTime();
    const bd      = beatDur();
    const horizon = now + SCHEDULE_SEC;

    // Find first beat index not yet scheduled
    let idx = Math.max(lastScheduled + 1, Math.floor((now - beatOrigin) / bd));
    while (beatOrigin + idx * bd < horizon) {
      const beatTime = beatOrigin + idx * bd;
      const delay    = Math.max(0, (beatTime - now) * 1000);
      const i        = idx;
      setTimeout(() => { if (running && onBeatCb) onBeatCb(i, beatTime); }, delay);
      lastScheduled = idx;
      idx++;
    }
  }

  function start(callback) {
    if (running) return;
    running      = true;
    onBeatCb     = callback;
    beatOrigin   = AudioEngine.getCurrentTime() + 0.05;
    lastScheduled = -1;
    schedTimer   = setInterval(schedule, LOOKAHEAD_MS);
  }

  function stop() {
    running = false;
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
    onBeatCb = null;
  }

  // ── Rhythm Snap ────────────────────────────────────────────────────────
  // Returns { time, beatIndex } — time is exact beat boundary, beatIndex is integer
  // beatIndex is used by caller to deduplicate: same index = same beat = block
  function snapToBeat(pressTime) {
    if (!running) return { time: pressTime, beatIndex: -1 };
    const bd = beatDur();
    // Beat index of the NEXT beat
    const nextIdx  = Math.ceil((pressTime - beatOrigin) / bd);
    const nextTime = beatOrigin + nextIdx * bd;
    const prevIdx  = nextIdx - 1;
    const prevTime = beatOrigin + prevIdx * bd;

    // If we just passed a beat (within 80ms), snap to that beat now
    if (pressTime - prevTime <= 0.08) {
      return { time: pressTime, beatIndex: prevIdx };
    }
    // Otherwise wait for next beat
    return { time: nextTime, beatIndex: nextIdx };
  }

  // Current beat phase 0..1 (for UI)
  function beatPhase() {
    if (!running) return 0;
    const bd = beatDur();
    return (((AudioEngine.getCurrentTime() - beatOrigin) % bd) + bd) % bd / bd;
  }

  return { start, stop, setBpm, getBpm, isRunning, snapToBeat, beatPhase };
})();
