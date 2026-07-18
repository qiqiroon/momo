/**
 * 量子モード伝搬制約群 C-106 / C-108 (Phase 5-6.5・§Q9)。
 *
 * これらは per-piece の狭め (C-101 等) と違い、複数駒の候補集合の交差を見て
 * 「他の駒との組合せで 1 通りに決まる」候補を確定させる伝搬系制約。
 *
 * ## C-106 unique assignment (Sudoku hidden single 相当)
 * ある初期 PieceID X について、X を candidates に含む現在駒がちょうど 1 個なら、
 * その駒の candidates を {X} に narrow する。
 *
 * ## C-108 fu-筋保存
 * 「捕獲/成りしていない初期 fu-@col C」は現在も col C に居るはず。よって
 * 現在 col が C 以外の駒の candidates からは fu-initial-@col C を除外する。
 * ただし「その fu-initial X が本当に不動か (=捕獲されていない)」を厳密に判定するには
 * X を候補に含む駒のいずれかが元の初期位置から動いていないことを確認する必要がある。
 * ここでは保守的に「その fu-initial X の対応駒 (pieceId === X) が現在も盤上で
 * pieceId === X として存在し、かつ promoted=false で持ち駒でもない」場合のみ
 * 「X はまだ動いていない」と判定する。
 *
 * より正確には「fu-initial X が動いていない/成っていない/捕獲されていない」を
 * 直接判定できないので (量子重ね合わせの本質)、以下の近似で運用する:
 *   - piece with pieceId === X が盤上にあり、そのマスの col == initialSquare.col なら
 *     「X はまだ動いていない可能性が高い」= C-108 を発動しない
 *   - piece with pieceId === X の現在マスが違う col、または持ち駒に居るなら
 *     「X は動いた/取られた」= その case では C-108 は無意味
 *
 * 実は user のケースを解くには別のアプローチが要る:
 *   1. 動いた駒 (P8) は C-101 で fu-initial を候補から除外
 *   2. 全 fu-initial の PieceID X について、X を候補に含む駒を集める
 *   3. さらに「X = fu-initial-@col C は col C にしか居られない」の空間制約を追加
 *   4. その結果、col C に居る駒だけが X を候補に持てる → 現在 col C に 1 駒しかいなければ
 *      C-106 で narrow
 *
 * つまり C-108 の正体は「fu-initial-@col C は col C の駒からしか担当できない」という
 * static な空間制約。fu の絶対数保存 (二歩) + 初期筋固定 (対局中歩は筋を変えない・
 * 成りしない限り) から出る。実装は「piece.candidates 中に fu-initial-@col C があり、
 * かつ現在 col != C なら、その候補を除外」でよい。
 */

import type { PieceId, PieceInstance, Position } from '../../../core/engine/position/types';
import type { QuantumConstraint } from '../candidate-update';

/**
 * C-106 unique assignment (hidden single).
 *
 * 各初期 PieceID X について、X を candidates に含む現在駒を集計。
 * 集計サイズが 1 の駒はその X が「他に居場所が無い」ので candidates を {X} に narrow できる。
 *
 * この制約は per-piece 関数として登録されるが、判定は全体スキャンが必要。
 * 効率のため candidate_update の反復に合わせて毎回 O(全駒 × 全PieceID) の計算をする
 * (本将棋なら 40 × 40 = 1600 で許容)。
 *
 * 実装ノート: piece 関数として呼ばれるが、返り値は「その piece の許される候補」なので、
 * 「他の駒が既に X を単独担当している」と判定できたときは、この piece の候補から X を
 * 除外する (X は他の駒のもの)。「自分が唯一の担当」なら {X} に narrow (絞る)。
 * それ以外は candidates そのまま。
 */
export const c106UniqueAssignment: QuantumConstraint = (piece, _location, pos, _mgf, _context) => {
  if (piece.candidates === undefined) return new Set();
  // 全駒を集めて「各 PieceID X を candidates に含む駒」を数える。
  // 注意: piece.candidates に X があれば piece 自身は carriers[X] に必ず含まれる。
  const allPieces = collectAllQuantumPieces(pos);
  const carriers = new Map<PieceId, PieceInstance[]>();
  for (const p of allPieces) {
    if (!p.candidates) continue;
    for (const pid of p.candidates) {
      const list = carriers.get(pid);
      if (list) list.push(p);
      else carriers.set(pid, [p]);
    }
  }

  // 自分の candidates 内で「担当が自分だけ (list.length==1)」の X を探す。見つかれば
  // その X に narrow (hidden single)。見つからなければ candidates 変化なし。
  for (const pid of piece.candidates) {
    const list = carriers.get(pid) ?? [];
    if (list.length === 1 && list[0].pieceId === piece.pieceId) {
      return new Set([pid]);
    }
  }
  return new Set(piece.candidates);
};

/**
 * C-107 confirmed exclusion (identity conservation / Sudoku naked single elimination の相当).
 *
 * ある初期 PieceID X に対応する「実際の駒」は対局中を通して 1 個しか存在しない
 * (identity conservation)。よって:
 *   - piece A の candidates が {X} に確定 (size==1) しているなら、A は X-initial
 *   - piece B (≠ A) は X-initial ではありえない → B の candidates から X を除外
 *
 * この制約は 1 個の駒 (piece B) を見て、他の駒で確定している PieceID を集めて除外する。
 * これで「P10 が hi に確定 → 他のどの駒からも P10 (=hi の initial) を除外」の
 * 伝搬が実現される。C-106 (hidden single) の逆向きの propagation。
 *
 * 実装ノート: 自分自身が {X} に確定していても、自分の candidates={X} からは除外しない
 * (自分は X なので当然)。他の駒の確定情報だけを見る。
 */
export const c107ConfirmedExclusion: QuantumConstraint = (piece, _location, pos, _mgf, _context) => {
  if (piece.candidates === undefined) return new Set();
  // 他の駒 (piece.pieceId 以外) で candidates.size==1 (確定) のものを集めて、
  // その確定 pid を集約。自分自身の確定 pid は除外セットに入れない。
  const confirmedByOthers = new Set<PieceId>();
  const allPieces = collectAllQuantumPieces(pos);
  for (const p of allPieces) {
    if (!p.candidates || p.pieceId === piece.pieceId) continue;
    if (p.candidates.size !== 1) continue;
    const only = Array.from(p.candidates)[0];
    confirmedByOthers.add(only);
  }
  if (confirmedByOthers.size === 0) return new Set(piece.candidates);

  // 自分の candidates から confirmedByOthers を除外
  const narrowed = new Set<PieceId>();
  for (const pid of piece.candidates) {
    if (confirmedByOthers.has(pid)) continue;
    narrowed.add(pid);
  }
  return narrowed;
};

/**
 * C-108 fu-筋保存 (静的空間制約)。
 *
 * 初期 fu (initialKind=='fu') の PieceID X は initialSquare.col = C に依存し、
 * X が「その fu として盤上に居る」場合の現在位置は col C でなければならない。
 * (成り済みの fu は "と" として自由に筋を移れるが、成らずの fu は初期筋を離れられない。)
 *
 * よって piece が現在盤上 col=D (D≠C) に居るなら、piece の candidates から
 * fu-initial-@col C (= X) を除外できる。ただし piece.promoted なら成り済みなので
 * この制約は無効。持ち駒はどの筋にも打てるので対象外。
 *
 * これで「P8 (元 1 筋歩) が (5,7) に居るなら、P8-initial (fu@col 8) は P8 の候補から
 * 除外される。以後は「fu@col 8 を候補に持つ現在駒」= (5,7) 以外の col=8 駒だけになり、
 * C-106 で 1 個に narrow される連鎖が起きる」動作を実現する。
 */
export const c108FuFileConservation: QuantumConstraint = (piece, location, _pos, _mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (location.kind !== 'board') return new Set(piece.candidates);
  if (piece.promoted) return new Set(piece.candidates);

  const currentCol = location.square.col;
  const narrowed = new Set<PieceId>();
  for (const pid of piece.candidates) {
    const info = context.infoMap.get(pid);
    if (!info || info.initialKind !== 'fu') { narrowed.add(pid); continue; }
    // fu-initial X の initialSquare.col が現在 col と一致しない → この駒の候補から除外
    if (info.initialSquare.col === currentCol) narrowed.add(pid);
  }
  return narrowed;
};

/**
 * 全盤上駒 + 全持ち駒を集める (candidate assignment 集計用)。
 * candidate_update 側のフレームワークが per-piece 呼び出しをするが、C-106 は全体視点が必要なので
 * 制約関数の中で毎回 pos を走査する。
 */
function collectAllQuantumPieces(pos: Position): PieceInstance[] {
  const out: PieceInstance[] = [];
  for (const row of pos.board) {
    for (const cell of row) if (cell && cell.candidates) out.push(cell);
  }
  for (const p of pos.hands.player1) if (p.candidates) out.push(p);
  for (const p of pos.hands.player2) if (p.candidates) out.push(p);
  return out;
}

/**
 * `register('quantum:constraints', [...basicConstraints, ...legalConstraints, ...propagationConstraints])`
 * として結合登録される順序付き配列。空間制約 (C-108) を先に、hidden single (C-106) を後に置くと
 * 反復が速く安定する (C-108 で駒当たりの候補が減った状態で C-106 が effective になる)。
 */
export const propagationConstraints: QuantumConstraint[] = [
  c108FuFileConservation,
  c107ConfirmedExclusion,
  c106UniqueAssignment,
];
