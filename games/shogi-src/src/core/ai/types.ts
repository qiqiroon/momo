/**
 * AI の差し替え口 (Phase 3・親 §7.1 EngineAdapter)。
 *
 * すべての思考ルーチンをこの 1 つの形の背後に置き、対局中に差し替えられるようにする。
 * core はこの型しか知らないので、思考ルーチン本体 (adapters/*) を入れ替えても
 * 対局画面側は変わらない。
 *
 * 親 §7.1 の骨子との対応:
 *   init(mgf, options) / setPosition(position | sfen) / go(limits) / stop() / quit()
 *
 * setPosition は **Position オブジェクトだけを受ける**。親 §7.1 v1.13 追記のとおり、
 * 量子・トーラス局面は候補集合込みでそのまま渡せる Position 経路が最も曖昧性が少ない。
 * 拡張 SFEN 経路は外部エンジン (usi-adapter) を実際に繋ぐときに足す。
 */

import type { Mgf } from '../engine/mgf/types';
import type { Move, Position } from '../engine/position/types';

/** 1 手にどれだけ考えてよいか (親 §7.4)。指定が無い項目は思考ルーチン側の既定に従う。 */
export interface ThinkLimits {
  /** 考える時間の上限 (ms) */
  movetimeMs?: number;
  /** 読む深さの上限 (手数) */
  depth?: number;
}

/** 思考の途中経過。長考のときに「まだ動いている」ことを画面へ出すために使う。 */
export interface ThinkProgress {
  depth: number;
  nodes: number;
  elapsedMs: number;
}

export interface EngineAdapter {
  readonly id: string;
  /** ルール定義を渡す。対局開始時に 1 回。 */
  init(mgf: Mgf): void;
  /** 考えさせたい局面を渡す。 */
  setPosition(position: Position): void;
  /**
   * 考えて 1 手返す。指す手が無い (詰み・手詰まり) ときは null。
   * stop() で打ち切られた場合も、その時点での最善手を返す (無ければ null)。
   */
  go(limits: ThinkLimits, onProgress?: (p: ThinkProgress) => void): Promise<Move | null>;
  /** 思考を打ち切る。 */
  stop(): void;
  /** 後片付け (Worker の破棄など)。 */
  quit(): void;
}

/**
 * AI 一覧に並べるための説明 (親 §7.1・付録 D-5 §6.3)。
 *
 * weight は「選べるものの中でいちばん上を既定にする」ための並び順の重み。
 * 大きいほど上に来る。数値の絶対値に意味はない (順序比較のみ)。
 */
export interface EngineDescriptor {
  id: string;
  /** 表示名の i18n キー (表示名そのものは猫語化しない=付録 D-5 §10) */
  labelKey: string;
  /** 説明文の i18n キー */
  descKey: string;
  weight: number;
  create(): EngineAdapter;
}
