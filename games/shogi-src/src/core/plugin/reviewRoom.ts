/**
 * 感想戦の部屋 (v1.50・親 §9.4／§6.3.6・画面機能 §3 S04／S11・付録D-12 §8)。
 *
 * **部屋を建てるのは通信機能 (features/matchmaking)、押すのは感想戦の画面
 * (features/kifu-replay)** で、どちらも features なので直接は行き来しない。
 * registry の口を通すため、**やり取りする形だけをここ (core) に置く**。
 *
 * 通信機能を積んでいないビルド (アプリ A) では口ごと無い＝**ボタンも出ない**。
 */

/** 部屋を建てられない理由。**「押せない」だけでは待てば直るのかが分からない**ので、理由で返す。 */
export type ReviewRoomBlock =
  /** 建てられる。 */
  | 'ok'
  /** サーバーにつながっていない（通信機能そのものが無い場合を含む）。 */
  | 'no-server'
  /** 既にどこかの部屋に居る＝そこを使えばよいので、新しく建てる意味が無い。 */
  | 'already-in-room';

/** 感想戦の部屋を建てるのに要る、棋譜から取れるだけの情報。 */
export interface ReviewRoomRequest {
  gameType: 'shogi' | 'hasami' | 'shogi-custom';
  torus: boolean;
  quantum: boolean;
  customRuleName?: string;
  /** 部屋名の既定＝**棋譜のルール名＋「の感想戦」**（付録D-12 §8）。 */
  roomName: string;
}
