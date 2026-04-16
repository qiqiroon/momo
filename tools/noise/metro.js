// metro.js - MOMO Noise Metronome & Rhythm Sync
'use strict';

const Metro = (() => {
  let bpm = 120;
  let running = false;
  let beatInterval = null;
  let nextBeatTime = 0;    // AudioContext time of next beat
  let beatCount = 0;
  let onBeatCallback = null;

  // Lookahead scheduler (Web Audio clock for accuracy)
  const LOOKAHEAD_MS   = 25.0;   // how often scheduler runs (ms)
  const SCHEDULE_AHEAD = 0.1;    // how far ahead to schedule (seconds)
  let schedulerTimer = null;

  function getBeatDuration() { return 60.0 / bpm; }

  function schedule() {
    const now = AudioEngine.getCurrentTime();
    while (nextBeatTime < now + SCHEDULE_AHEAD) {
      // Fire visual callback at beat time (approximate, for UI flash)
      const delay = Math.max(0, (nextBeatTime - now) * 1000);
      const beatNum = beatCount;
      setTimeout(() => {
        if (running && onBeatCallback) onBeatCallback(beatNum, nextBeatTime);
      }, delay);
      nextBeatTime += getBeatDuration();
      beatCount++;
    }
  }

  function start(callback) {
    if (running) return;
    running = true;
    onBeatCallback = callback;
    beatCount = 0;
    nextBeatTime = AudioEngine.getCurrentTime() + 0.05;
    schedulerTimer = setInterval(schedule, LOOKAHEAD_MS);
  }

  function stop() {
    running = false;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    if (beatInterval)   { clearInterval(beatInterval);   beatInterval   = null; }
    onBeatCallback = null;
  }

  function setBpm(b) {
    bpm = Math.max(20, Math.min(300, b));
  }

  function getBpm() { return bpm; }
  function isRunning() { return running; }

  // ── Rhythm Snap ────────────────────────────────────────────────────────
  // Given the moment user pressed (AudioContext.currentTime),
  // return the AudioContext time of nearest beat within snapWindow (seconds)
  // If no beat is close enough, return null (play immediately)
  function snapToBeat(pressTime, snapWindow = 0.15) {
    if (!running) return null;

    const beatDur = getBeatDuration();
    // Calculate beats elapsed since start reference
    const elapsed = pressTime - (nextBeatTime - beatDur); // time since last scheduled beat ref
    const beatPhase = ((pressTime % beatDur) + beatDur) % beatDur;

    // Distance to previous beat
    const distPrev = beatPhase;
    // Distance to next beat
    const distNext = beatDur - beatPhase;

    if (distPrev <= snapWindow) {
      // snap to previous beat (play immediately since it just passed)
      return pressTime;
    } else if (distNext <= snapWindow) {
      // snap to upcoming beat
      return pressTime + distNext;
    }
    return null; // not close enough → play immediately
  }

  return { start, stop, setBpm, getBpm, isRunning, snapToBeat };
})();
