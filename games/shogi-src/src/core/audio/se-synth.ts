/**
 * MOMO Shogi の効果音。v0.75 で SE-move / SE-capture を素材ベース化し、
 * v0.77 で残り 9 種も全て素材ベースに置換 (SE-threat のみ未実装のため保留)。
 * SAMPLE_URLS の中身は audio-engine.ts 側で定義。
 */
import { playSample } from './audio-engine';

/** SE-move: 駒を打つ。v0.75 で Taira Komori shogi4.mp3 に置換 (CC-BY 4.0)。 */
export function seMove(): void {
  playSample('move');
}

/** SE-capture: 駒を取る。v0.75 で Taira Komori shogi3.mp3 に置換 (CC-BY 4.0)。 */
export function seCapture(): void {
  playSample('capture');
}

/** SE-select: 駒選択。v0.77 で Freesound LloydEvans09 「light_wood」を 75ms トリムで再生 (CC-BY)。 */
export function seSelect(): void {
  playSample('select', { trimSec: 0.075 });
}

/** SE-check: 王手。v0.77 で Freesound dland「hint」に置換 (CC0)。 */
export function seCheck(): void {
  playSample('check');
}

/** SE-button: UI 決定音。v0.77 で Taira Komori「press_enter1」に置換 (CC-BY)。 */
export function seButton(): void {
  playSample('button');
}

/**
 * SE-fanfare-win: v0.77 で 2 素材の合成に置換。
 * (1) Freesound LittleRobotSoundFactory「Achievement Orchestral (uplifting)」CC-BY
 * (2) MOMO Darts win.mp3 を 0.8 秒遅れて重ねる (ユーザー指定 V-A)
 */
export function seFanfareWin(): void {
  playSample('fanfareWin');
  playSample('fanfareWin2', { at: 0.8 });
}

/** SE-game-lose: v0.77 で TK temple_bell1 単独に置換 (CC-BY)。 */
export function seGameLose(): void {
  playSample('gameLose');
}

/** SE-chat-recv: v0.77 で Freesound deathbyfairydust「pop.wav」に置換 (CC-BY)。 */
export function seChatRecv(): void {
  playSample('chatRecv');
}

/** SE-pause: v0.77 で Freesound BaggoNotes「Button_Click1」に置換 (CC0)。 */
export function sePause(): void {
  playSample('pause');
}

/** SE-resume: v0.77 で SE-pause を 120ms 間隔で 2 度鳴らす方式に (ユーザー指定 D-3)。 */
export function seResume(): void {
  playSample('pause');
  playSample('pause', { at: 0.12 });
}

/**
 * SE-furigoma: v0.77 で素材ベースに置換 (ユーザー指定 M-2)。
 * Freesound SilverDubloons「Scrabble piece on wood」CC0 を 5 発 +
 * TK shogi4 (SE-move) を 2 発、0.4s の中にランダム配置。押すたびに異なる。
 */
export function seFurigoma(): void {
  const spanSec = 0.4;
  const times: { key: string; t: number }[] = [];
  for (let i = 0; i < 5; i++) times.push({ key: 'furiPiece', t: Math.random() * spanSec });
  for (let i = 0; i < 2; i++) times.push({ key: 'move', t: Math.random() * spanSec });
  // 先頭は 0 に固定
  times.sort((a, b) => a.t - b.t);
  if (times.length) times[0].t = 0;
  for (const h of times) playSample(h.key, { at: h.t });
}
