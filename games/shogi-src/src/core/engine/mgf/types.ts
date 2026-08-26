export type Player = 'player1' | 'player2';

export interface MgfMetadata {
  game_name: string;
  game_id: string;
  author?: string;
  version?: string;
  description?: string;
  base_game?: string;
}

export interface MgfBoard {
  width: number;
  height: number;
  coordinate: 'shogi' | 'chess';
  promotion_zone?: {
    player1?: { min_rank: number; max_rank: number };
    player2?: { min_rank: number; max_rank: number };
  };
  sfen_support?: boolean;
}

export type MgfDirection =
  | 'all_8'
  | 'forward'
  | 'backward'
  | 'sideways'
  | 'diagonal'
  | 'forward_diagonal'
  | 'backward_diagonal'
  | 'knight'
  | 'knight_8';

export type MgfAbilityType = 'step' | 'slide' | 'jump';

export interface MgfAbility {
  type: MgfAbilityType;
  direction: MgfDirection;
  range: number;
  jump_over?: boolean;
  can_capture?: boolean;
  can_move_to_empty?: boolean;
}

export interface MgfMoveLogic {
  actions_per_turn?: number;
  can_stop_midway?: boolean;
  abilities: MgfAbility[];
  composite?: unknown[];
}

/**
 * 駒に書く文字 (親 v1.65 §3.6.1)。
 *
 * 1 語だけ書けば全言語で同じ字を出す。言語ごとに変えるなら言語コードで引ける形にする。
 * **猫語は駒に反映しない** (駒デザイン §5.2) ので、この表には猫語を置かない。
 */
export type MgfPieceName = string | { [locale: string]: string | undefined };

/** 成りの型 (親 v1.65 §3.6.2)。 */
export type MgfPromotionType = 'flip' | 'replace' | 'zone_move';

/** 「必ず成る」の理由 (親 v1.65 §3.6.3)。 */
export type MgfMustPromoteReason = 'no_legal_move' | 'by_rule';

/** 駒の見せ方のうち、ルール定義が持つもの (親 v1.65 §3.6.1)。 */
export interface MgfPieceDisplay {
  /**
   * 文字の色。省略時は両者とも既定の墨色 (＝将棋は従来どおり)。
   * **縁取りの色と駒の外形・地色はここには持たせない** (テーマ側の持ち物・§8.5)。
   */
  glyph_color?: Partial<Record<Player, string>>;
}

export interface MgfPieceDef {
  id: string;
  name: MgfPieceName;
  /** 【v1.65】文字の色 (§3.6.1)。 */
  display?: MgfPieceDisplay;
  is_royal?: boolean;
  can_promote: boolean;
  /** 【v1.65】成りの型 (§3.6.2)。省略時は `flip` (裏返る成り)。 */
  promotion_type?: MgfPromotionType;
  promoted_id?: string;
  /** 【v1.65】`promotion_type='replace'` のときの昇格先候補 (§3.6.2)。1 個だけなら選択は起きない。 */
  promotion_choices?: string[];
  must_promote_at?: number;
  /** 【v1.65】強制成りの理由 (§3.6.3)。省略時は `no_legal_move` (行き所がなくなるから)。 */
  must_promote_reason?: MgfMustPromoteReason;
  is_hand_piece?: boolean;
  score?: number;
  visibility?: { owner: boolean; opponent: boolean };
  immovable?: boolean;
  move_logic?: MgfMoveLogic;
}

export type MgfPlacementFormat = 'sfen' | 'matrix' | 'list';

export interface MgfPlacementListItem {
  piece: string;
  owner: Player;
  x: number;
  y: number;
}

export interface MgfInitialPlacement {
  format: MgfPlacementFormat;
  sfen?: string;
  matrix?: string[][];
  list?: MgfPlacementListItem[];
  placement_ref?: string;
}

/**
 * 手合い (駒落ち) の 1 項目 = 上手側から落とす駒 (親 §3.12.1)。
 * どちらが上手かは MGF には書かない (対局設定オブジェクト側で決める)。
 */
export interface MgfHandicapRemove {
  /** 落とす駒の pieces[].id。 */
  piece: string;
  /** 落とす枚数 (省略時 1)。 */
  count?: number;
  /** 同じ駒種が複数あるときにどれを落とすか。**左右は上手から見た向き**。 */
  pick?: 'left' | 'right' | 'any';
}

export interface MgfHandicapType {
  id: string;
  name?: string;
  remove: MgfHandicapRemove[];
}

/**
 * そのルールで指せる手合いの一覧。
 * **本セクションが無い = そのルールは平手のみ** (対応可否を表す真偽値は置かない・親 §3.12.1)。
 */
export interface MgfHandicap {
  types: MgfHandicapType[];
}

export interface MgfConstraints {
  nifu?: boolean;
  uchifu_tsume?: boolean;
  suicide?: boolean;
  dead_zone?: 'auto' | boolean;
  /**
   * 【v1.65 §3.9／§5.5.3】ポーンの初手 2 マス。**一度も動いていないポーンは前へ 2 マス
   * 進める**（間のマスも着地マスも空いていること）。この指定があるとき、直前の手が相手の
   * ポーンの 2 マス進みだった場合の**アンパッサン**も生む（§5.5.3・生む側は moves/pawn-special）。
   * 省略＝生まない（将棋・はさみ将棋は素通り）。
   */
  pawn_double_step?: boolean;
  /**
   * 【v1.65 §5.5.4】**キャスリング**。**王が横へ 2 マス動き、相方の駒が王を飛び越して隣へ**
   * 移る 1 手を生む（生む側は moves/castling・運び方は §3.7.1 の並び）。
   * 省略＝生まない（将棋・はさみ将棋は素通り）。
   *
   * ★**相方の駒は名指しする**（ユーザー判断 2026-08-26）。ポーンの初手 2 マスのように
   * 動きの形で見分けると、**量子モードで「ルークの可能性」と「クイーンの可能性」を
   * 区別できず**、§Q23.3 の「キャスリングは王とルークの確定である」に届かないため。
   * ★**王の側は名指ししない**＝駒定義が既に持っている `is_royal` をそのまま使う。
   */
  castling?: {
    /** 相方の駒種 id（チェスならルーク）。 */
    partner: string;
  };
}

/**
 * 先手・後手で違うしきい値を持てる形 (親 v1.62 §3.10)。
 * 27 点法は**先手 28 点・後手 27 点**なので 1 つの数では書けない。
 * **数を 1 つだけ書いた従来の形も引き続き読め、その場合は両者同じ値**とする。
 */
export type MgfSideThreshold = number | { player1: number; player2: number };

/**
 * 終局の「起こし方」 (親 v1.65 §3.10.0)。**「何を満たせば」だけでなく「誰が・いつ」も定める**。
 *
 * - `auto` … 条件が満たされた瞬間、アプリが終わらせる (詰み・全滅・時間切れ・駒不足)
 * - `claim` … 有利になる側が主張して初めて成立する (入玉宣言・チェスの 3 回/50 手)
 * - `agree` … 双方が合意して初めて成立する (持将棋・引き分けの合意)
 */
export type MgfEndTrigger = 'auto' | 'claim' | 'agree';

export interface MgfEnteringKing {
  enabled?: boolean;
  zone?: 'enemy_promotion' | string;
  point_threshold?: MgfSideThreshold;
  count_method?: '24point' | '27point' | string;
  /**
   * 【v1.65 §3.10.0】起こし方。入玉宣言は**主張** (`claim`)＝勝つ側の権利。
   * 省略時は `claim` (従来の入玉宣言の振る舞い)。意味論は §4.4.2 のまま。
   */
  trigger?: MgfEndTrigger;
  /**
   * 【v1.65 §5.5.8】宣言に要る敵陣内の自駒枚数。省略時 10 (本将棋)。
   * **以前はプログラムに直書きされていた** (親 §3.10 は「ルール定義から」なのに欄が無かった)。
   */
  required_piece_count?: number;
}

/**
 * 持将棋 (合意による引き分け・親 v1.62 §3.10／§4.4.1)。
 *
 * **点数を数える範囲が入玉宣言と違う**＝持将棋は**盤の上のどこにあっても自分の駒すべて
 * ＋持ち駒**、入玉宣言は**敵陣内の自分の駒＋持ち駒**。**1 枚あたりの数え方 (飛角龍馬は
 * 5 点・それ以外 1 点・王の分として 1 を引く／量子では候補の姿がすべて大駒である駒だけ
 * 5 点) は共通**で、量子の読み替えはそちらに属するので範囲が変わっても効く。
 *
 * 省略時は `enabled:false` = 提案そのものを出さない。
 */
export interface MgfJishogi {
  enabled?: boolean;
  point_threshold?: number;
  /**
   * 【v1.65 §3.10.0】起こし方。持将棋は**合意** (`agree`)＝双方が諾で成立。
   * 省略時は `agree` (従来の持将棋の振る舞い)。意味論は §4.4.1 のまま。
   */
  trigger?: MgfEndTrigger;
}

/**
 * ステイルメイト (親 v1.65 §3.10・§5.5.5)。**王手ではないが、指す手が無い**。
 *
 * **省略時は判定しない**＝本将棋・はさみ将棋は欄を持たないので、手が無くなっても
 * 従来どおり何も起こらない (縮退互換)。**欄を持つルールだけが判定の代金を払う**
 * ＝合法手が 1 つでもあるかを毎手調べるのは、この欄があるときだけ。
 *
 * - `draw` … 引き分け (チェス)
 * - `loss` … **手番が回ってきた側の負け** (将棋の手詰まり)
 */
export interface MgfStalemate {
  result?: 'draw' | 'loss';
  /** 起こし方 (§3.10.0)。ステイルメイトは**自動**。省略時 `auto`。 */
  trigger?: MgfEndTrigger;
}

/**
 * 駒不足 (親 v1.65 §3.10・チェス §5.5.5)＝**どちらも詰ませることが不可能な駒の
 * 組み合わせ**になったら、その瞬間に引き分け。
 *
 * ★**組み合わせはルール定義が名指しで書く** (ユーザー判断 2026-08-26)。
 * 本家チェスも「詰ませられるか」を盤から探索しているのではなく、**当てはまる顔ぶれが
 * 4 通りしかない**ことを知っていて突き合わせているだけである。エンジンは駒の動きを
 * 定義から読む作りなので、**動きの形から「詰ませられなさ」を言い当てることはできない**
 * (量子では正体が未確定な駒についてなおさら言えない＝キャスリングの相方を動きの形で
 * 見分ける案を落としたのと同じ理由)。
 *
 * **書き忘れたら成立しないだけ**＝対局が続く安全側に倒れる。
 */
export interface MgfInsufficientMaterial {
  enabled?: boolean;
  /** 起こし方 (§3.10.0)。駒不足は**自動**。省略時 `auto`。 */
  trigger?: MgfEndTrigger;
  /** 引き分けになる顔ぶれ。1 つでも当てはまれば成立する。 */
  combinations?: MgfMaterialCombination[];
}

/**
 * 引き分けになる駒の顔ぶれ 1 通り。
 *
 * - **王 (`is_royal`) は数えない**＝必ず居るので書かない。
 * - **持ち駒も同じように数える**＝打てる駒があるならそれは残っている駒である。
 * - **左右は入れ替えても成立する**＝先手・後手のどちらがどちらでもよいので 1 通り書けば足りる。
 */
export interface MgfMaterialCombination {
  /** 双方に残っている駒 (王を除く)。`[[], []]` なら「王だけ 対 王だけ」。 */
  sides: [string[], string[]];
  /**
   * true なら、**挙げた駒がすべて同じ色のマスに乗っているとき**だけ成立する
   * (チェスの「ビショップ 1 枚ずつ・同じ色のマス」)。色の違うビショップどうしは
   * 協力すれば詰みが作れるので、本家でも引き分けにならない。
   */
  same_square_color?: boolean;
}

export interface MgfVictory {
  type?: 'capture_royalty' | 'bare_king' | 'points' | 'flag_capture' | 'annihilation' | 'check_wins';
  royalty_ids?: string[];
  entering_king?: MgfEnteringKing;
  /** 持将棋 (親 v1.62 §4.4.1)。省略時は提案を出さない。 */
  jishogi?: MgfJishogi;
  /** ステイルメイト (親 v1.65 §3.10)。**省略時は判定しない**。 */
  stalemate?: MgfStalemate;
  /** 駒不足 (親 v1.65 §3.10)。**省略時は判定しない**。 */
  insufficient_material?: MgfInsufficientMaterial;
  /** 無進展手数 (親 v1.65 §3.10)。**省略時は判定しない**。 */
  move_limit?: MgfMoveLimit;
  /**
   * `annihilation` の成立枚数 (親 §3.10)。相手の**盤上の駒がこの枚数以下**になったら勝ち。
   * 省略時 0 = 文字どおりの全滅。はさみ将棋の標準は 2 (§5.3)。
   */
  remaining_threshold?: number;
  resign_allowed?: boolean;
}

/**
 * 挟んで取る決まり (親 §3.8 `post_move_topology`)。
 *
 * **判定は着手の直後に 1 回だけ**行い、取った結果として新たに成立した挟みは解決しない。
 */
export interface MgfPostMoveTopology {
  /** 成立条件。現行は挟みのみ。 */
  condition: 'sandwich';
  /** 挟みを見る向き。省略時は縦横。 */
  axis?: ('horizontal' | 'vertical')[];
  /** 取られる駒。現行は相手の駒のみ。 */
  target?: 'opponent_piece';
  /** 挟む役を務めるもの。既定は自分の駒 2 枚だけ (盤の端は挟まない)。 */
  bound_by?: 'own_piece' | 'own_piece_or_board_edge';
  /** 盤の隅にいる駒を、直交する 2 マスを塞いだ時点で取れるようにするか (角取り)。 */
  corner_enclosure?: boolean;
  /**
   * true (既定) なら**動かした駒を起点にだけ**判定する = 自分から挟まれに入っても取られない。
   * false なら着手した側のすべての駒を起点に判定する (取られるのは相手の駒だけ)。
   */
  mover_only?: boolean;
}

export interface MgfCaptureRules {
  /** `move_capture` = 移動先の敵を取る (既定) / `none` = 移動では取らない。 */
  default?: 'move_capture' | 'none';
  post_move_topology?: MgfPostMoveTopology;
  clash_resolution?: unknown;
}

export interface MgfRepetitionExtended {
  type?: 'draw' | 'rematch_with_side_swap' | 'sennichite' | 'perpetual_check';
  on_check_repetition?: 'loss' | 'none';
  /**
   * 同じ局面が何回現れたら**自動で**成立するか (親 §3.11)。
   * 本将棋は 4 (＝同じ局面が 3 回繰り返された次)・チェスは 5。省略時 4。
   */
  detection_threshold?: number;
  /**
   * 【v1.65 §3.11】**主張できる出現回数**。チェスは 3。
   * **省略＝主張は無く、`detection_threshold` の自動成立だけ**（将棋は従来どおり省略）。
   */
  claim_threshold?: number;
  count?: number;
  action?: 'draw' | 'win_attacker' | 'no_repeat';
}

/**
 * 無進展手数 (親 v1.65 §3.10 `move_limit`・チェスの 50 手ルール)。
 *
 * **駒を取る手も、決められた駒が動く手も無いまま**この手数が過ぎたら引き分け。
 *
 * ★**数え直しを起こす駒はルール定義が名指しする**（チェスならポーン）。「後戻りできない
 * 動きの駒」を動きの形から見分ける案は採らない＝**量子では正体が未確定な駒についてそれを
 * 言えない**（キャスリングの相方・駒不足と同じ理由）。**取る手はどのルールでも数え直す**
 * ので名指しは要らない。
 *
 * ★**数は「両者が指して 1 手」**＝チェスの数え方に合わせる（50 手ルール＝双方が 50 手
 * ずつ指す間）。内部では片側 1 手ずつ数えているので、比べるときに 2 倍する。
 */
export interface MgfMoveLimit {
  /** 主張できるようになる手数 (チェスは 50)。省略＝主張できない。 */
  claim_at?: number;
  /** 主張が無くても自動で引き分けになる手数 (チェスは 75)。省略＝自動では成立しない。 */
  auto_at?: number;
  /** 動くと数えが 0 に戻る駒 (チェスは `["pawn"]`)。省略＝取る手だけが数えを戻す。 */
  reset_on?: string[];
  /** 起こし方 (§3.10.0)。主張と、上限での自動を併せ持つ。省略時 `claim`。 */
  trigger?: MgfEndTrigger;
}

export interface MgfRepetition {
  type?: 'sennichite' | 'perpetual_check';
  count?: number;
  action?: 'draw' | 'win_attacker' | 'no_repeat';
}

export interface Mgf {
  metadata: MgfMetadata;
  board: MgfBoard;
  compatible_modifiers?: {
    torus?: { cylinder?: boolean; full_torus?: boolean };
    quantum?: { enabled?: boolean; allowed_patterns?: string[] };
  };
  pieces: MgfPieceDef[];
  constraints?: MgfConstraints;
  capture_rules?: MgfCaptureRules;
  victory?: MgfVictory;
  repetition?: MgfRepetitionExtended;
  initial_placement: MgfInitialPlacement;
  handicap?: MgfHandicap;
}
