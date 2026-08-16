/**
 * 棋譜ファイルの形 (親 §9.2 / §9.2.1)。
 *
 * **1 局 1 ファイル**。アプリの中に棋譜の書庫は持たない。
 * ブラウザが持つのは「直前の 1 局」の受け皿だけで、次の対局が始まると置き換わる。
 *
 * **素性 (meta) を先頭に置く**のが決まり (親 §9.2.1)。一覧を組み立てるとき、
 * 将来ファイルの先頭だけを読めば済むようにするため。JSON は書いた順に並ぶので、
 * `format` → `version` → `meta` の順で組み立てること。
 */

import type { Move } from '../../core/engine';
import type { TimeControl } from '../../core/engine/time-control';
import type { GameStatus } from '../../core/store/game-store';

/** 誰と指したか。ファイル名の 3 文字 (`COM`/`NET`/`F2F`) と 1 対 1。 */
export type KifuOpponent = 'com' | 'net' | 'f2f';

/** 対局者 1 人分。人か AI かで持つ項目が変わる。 */
export interface KifuPlayer {
  name: string;
  kind: 'human' | 'ai';
  /** kind==='ai' のときだけ。どの思考ルーチンをどの段で動かしたか。 */
  engineId?: string | null;
  level?: string;
}

/**
 * 素性ブロック。**一覧はここだけから組み立てる**（ファイル名からは読み戻さない＝
 * ファイル名はユーザーが改名できるので正本ではない・親 §9.2.2）。
 */
export interface KifuMeta {
  /** 書き出した時刻 (ISO 8601・端末の時刻帯つき)。 */
  savedAt: string;
  opponent: KifuOpponent;
  /** ルールの種類 ('shogi' / 'hasami' / …)。再生はここからルール定義を引く。 */
  gameType: string;
  quantum: boolean;
  torus: 'none' | 'cylinder' | 'full';
  /** 手合い (駒落ち)。平手なら null。giver = 落とした側 (＝上手＝先手)。 */
  handicap: { typeId: string; giver: 'player1' | 'player2' } | null;
  players: { player1: KifuPlayer; player2: KifuPlayer };
  /**
   * 「自分」がどちらの側だったか。勝敗を自分視点で書くために要る。
   * 同じ端末の二人対局 (`f2f`) は自分が 2 人居るので null で、勝敗は先手視点になる。
   */
  viewerSide: 'player1' | 'player2' | null;
  result: { status: GameStatus; winner: 'player1' | 'player2' | null };
  moveCount: number;
  timeControl: TimeControl;
}

export interface KifuFile {
  format: 'momo-shogi-kifu';
  version: 1;
  meta: KifuMeta;
  /** 指し手の列。再生はこれを最初から順に指し直す。 */
  moves: Move[];
  /**
   * 対局中の棋譜欄に出ていた表記。再生には要らないが、
   * 読み直したとき同じ文字で見せるために持つ (量子の「◯◯に確定」行を含む)。
   */
  moveTexts: string[];
}

export const KIFU_FORMAT = 'momo-shogi-kifu';
export const KIFU_VERSION = 1;
