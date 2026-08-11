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

import type { Player } from '../../../core/engine/mgf/types';
import type { PieceId, PieceInstance, Position } from '../../../core/engine/position/types';
import type { QuantumConstraint } from '../candidate-update';
import { c303AssignmentConsistency } from './assignment';

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
export const c108FuFileConservation: QuantumConstraint = (piece, location, pos, _mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (location.kind !== 'board') return new Set(piece.candidates);
  if (piece.promoted) return new Set(piece.candidates);
  // v1.15 (ユーザー指摘の調査中に発覚): 一度でも打たれた駒はこの制約の前提から外れる。
  // 「歩は筋を移れない」と言えるのは盤の上を歩き続けた歩だけで、取られて持ち駒になった
  // 歩はどの筋にでも打てる。区別せずに縛っていたため、取った歩を元の筋以外に打つと
  // 候補が空になり、必ず量子異常になっていた (実測で確認)。
  if (pos.history.some((m) => m.type === 'drop' && m.pieceId === piece.pieceId)) {
    return new Set(piece.candidates);
  }

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
 * C-302 枚数確定制約 (Phase 5-9・§Q8.7 / §Q12.5)。
 *
 * 「ある候補を保持する駒数が、その駒の初期枚数と一致した場合、それらの駒はその候補として確定する」。
 *
 * ## PieceID ベースでの読み替え (Phase 5-6.5 以降)
 *
 * 候補が駒種名から PieceID に変わったので、仕様の「候補 kind k」は
 * **「初期陣営 S・初期駒種 K を持つ PieceID の集合」** に読み替える (以下グループ)。
 * グループの大きさ n = その陣営のその駒種の初期枚数 (金なら 2、王なら 1)。
 *
 * グループの PieceID を 1 つでも候補に持つ駒を holder と呼ぶ。**holder がちょうど n 枚なら、
 * その n 枚は全員そのグループの駒**である (n 個の身元を n 枚で分け合うしかない)。
 * よって holder の候補は、そのグループ内の PieceID だけに狭められる。
 *
 * ## C-106 との違い (なぜ別に要るのか)
 *
 * C-106 は「PieceID X を持つ駒が 1 枚だけなら、その駒は X」。個々の PieceID を見る。
 * C-302 は「金の身元 2 個を担えるのが 2 枚だけなら、その 2 枚は両方とも金」。
 * どちらの金かは決まらないが、**金以外の候補 (銀など) は落とせる**。
 * 数独でいう naked pair に相当し、C-106 (hidden single) では取れない絞り込み。
 *
 * ## §Q12.5 王の確定を含む
 *
 * 王は各初期陣営 1 枚 (§Q12.2) なので n=1。「王候補を保持する未確定駒が 1 枚になった時点で
 * その駒は王として確定する (先手・後手それぞれで独立判定)」は本制約の n=1 の場合にあたる。
 * 陣営別に数えるため、先手の王候補が 1 枚に減っても後手側の判定には影響しない。
 *
 * ## 矛盾した局面での挙動
 *
 * 2 つ以上のグループが同時に成立し、かつ自分がそのどちらの holder でもある場合、
 * 「金でも銀でもある」ことになり交わりは空集合になる。これは局面自体が矛盾している
 * (整合する割り当てが存在しない) ことを意味し、§Q8.8 C-901 異常状態の検出対象。
 * 本制約は握り潰さず空集合を返す (C-901 の通知・投票 UI は未実装)。
 */
export const c302CountConfirmation: QuantumConstraint = (piece, _location, pos, _mgf, context) => {
  if (piece.candidates === undefined) return new Set();

  // 自分の候補が全部同じグループなら、狭めても何も変わらないので早期に打ち切る。
  const myGroups = new Set<string>();
  for (const pid of piece.candidates) {
    const info = context.infoMap.get(pid);
    if (info) myGroups.add(groupKeyOf(info.initialOwner, info.initialKind));
  }
  if (myGroups.size <= 1) return new Set(piece.candidates);

  // 自分に関係するグループについてだけ「そのグループの PieceID 全体」を集める。
  const groupIds = new Map<string, Set<PieceId>>();
  for (const info of context.infoMap.values()) {
    const key = groupKeyOf(info.initialOwner, info.initialKind);
    if (!myGroups.has(key)) continue;
    const ids = groupIds.get(key);
    if (ids) ids.add(info.pieceId);
    else groupIds.set(key, new Set([info.pieceId]));
  }

  // グループごとの holder (そのグループの PieceID を 1 つ以上候補に持つ駒) を数える。
  const holderCount = new Map<string, number>();
  for (const p of collectAllQuantumPieces(pos)) {
    for (const [key, ids] of groupIds) {
      let holds = false;
      for (const pid of p.candidates!) {
        if (ids.has(pid)) { holds = true; break; }
      }
      if (holds) holderCount.set(key, (holderCount.get(key) ?? 0) + 1);
    }
  }

  // holder 数 == 初期枚数 のグループについて、自分の候補をそのグループ内に狭める。
  let narrowed: Set<PieceId> = new Set(piece.candidates);
  for (const [key, ids] of groupIds) {
    if ((holderCount.get(key) ?? 0) !== ids.size) continue;
    const next = new Set<PieceId>();
    for (const pid of narrowed) if (ids.has(pid)) next.add(pid);
    narrowed = next;
  }
  return narrowed;
};

/** C-302 のグループ鍵。初期陣営と初期駒種の組で 1 グループ (先手の金と後手の金は別)。 */
function groupKeyOf(initialOwner: Player, initialKind: string): string {
  return `${initialOwner}/${initialKind}`;
}

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
  // C-302 は「グループ丸ごと」の判定なので、個別の狭め (C-108) と個別の確定 (C-106/C-107) が
  // 効いて候補が減った後に回すほうが成立しやすい。よって最後。
  c302CountConfirmation,
  // C-303 (v1.16) は割り当て全体を解く一番重い判定。C-106/C-107/C-302 はその特別な場合に
  // あたるので、軽いそれらで候補が減った後に回す。
  c303AssignmentConsistency,
];
