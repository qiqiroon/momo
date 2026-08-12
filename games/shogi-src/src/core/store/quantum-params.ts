/**
 * 量子モードの実行時パラメータ (Phase 5-15・§Q17.8)。
 *
 * 仕様が「対局設定パラメータ」として定めている 4 つ。それまでは実装のあちこちに
 * 固定値として散らばっていた (反復上限 512 / 開始時の絞り込みは常に実行 / 観測は
 * 着手後固定 / 異常時は投票固定) ものを、ここ 1 か所に集めて名前を付けた。
 *
 * 実行時の単一情報源は game-store の `quantumParams`。表示方式 (qtdisp) と同じ扱いで、
 * 対局設定の一部として持つ。
 *
 * **設定 UI**:仕様は S09 系での露出を「実装バリエーションとして認める」に留めており
 * (§Q7.9.1)、項目名や既定値の見せ方は画面機能仕様側の決めごとになる。そこがまだ
 * 決まっていないので、いまはデバッグパネル (`?debug=1`) からだけ変えられる。
 * 既定値のままなら従来と完全に同じ挙動になる。
 */

/**
 * 観測 (候補更新) を走らせるタイミング。
 *
 * `manual` (プレイヤーが観測タイミングを選ぶ) は仕様側が未確定のまま残している
 * 将来拡張 (§Q16.4) なので、値としては用意していない。
 */
export type ObservationTiming = 'after_move';

/** 異常状態 (候補が空 / 反復上限) が出たときの挙動。 */
export type AnomalyAction =
  /** 標準。両者に投票してもらい、片方でもノーゲームを選べば即不成立 (片方拒否権)。 */
  | 'vote_to_annul'
  /** 知らせるだけ。投票は出さず、異常状態のまま盤を残す (復旧手段は仕様側で未定)。 */
  | 'notify_user'
  /** 投票を挟まず即ノーゲーム終局。自動対局・実験用途。 */
  | 'no_game';

export interface QuantumParams {
  observationTiming: ObservationTiming;
  /** 候補更新の反復上限。超えたら異常状態 (§Q7.9.1)。 */
  maxIterations: number;
  /** 対局開始時に候補更新を 1 回走らせるか (§Q17.4)。 */
  initialPropagation: boolean;
  anomalyAction: AnomalyAction;
}

export const DEFAULT_QUANTUM_PARAMS: QuantumParams = {
  observationTiming: 'after_move',
  maxIterations: 512,
  initialPropagation: true,
  anomalyAction: 'vote_to_annul',
};
