// 1 手の制限時間の秒読みの音（段階10の2・利用者指示 2026-10-16）：
// 「最後の 5 秒は短い音で秒読み。NHK の時報のイメージで最後の音ははずれのブー」＝ぽっ・ぽっ・ぽっ・ぽっ・ブー。
// 残り 4・3・2・1 秒で短い「ぽっ」、0 秒（時間切れの手を出す瞬間）で「ブー」。
// 音程は動かさない（音程が滑ると電子音に聞こえる）。効果音の音量・ミュートに従う（SFX の出口につなぐ）。

import { getSfxSink } from './engine';

/** 時報の「ぽっ」：440Hz の正弦波を短く */
export function playClockPip(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain } = sink;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 440;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.005);
  g.gain.setValueAtTime(0.35, t + 0.09);
  g.gain.linearRampToValueAtTime(0, t + 0.12);
  o.connect(g).connect(gain);
  o.start(t);
  o.stop(t + 0.13);
}

/** はずれの「ブー」：低い矩形波を 2 本わずかにずらして重ね、角を少し丸める */
export function playClockBuzz(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain } = sink;
  const t = ctx.currentTime;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.01);
  g.gain.setValueAtTime(0.22, t + 0.55);
  g.gain.linearRampToValueAtTime(0, t + 0.62);
  lp.connect(g).connect(gain);
  for (const f of [140, 147]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(lp);
    o.start(t);
    o.stop(t + 0.63);
  }
}
