/**
 * 同じ局面かの見分け方（親 v1.65 §4.2.1・第 9 段 9-4d）。
 *
 * 局面の印（§3.11・§4.2）は**盤の配置・持ち駒・手番・候補集合**から作る。将棋では
 * これで過不足がない——将棋には「盤を見ても分からない権利」が無いので、この 4 つが
 * 同じなら指せる手も完全に同じである。
 *
 * **チェスでは足りない**。キャスリングの権利（王とルークが一度も動いていないか）も、
 * アンパッサンの権利（直前にポーンが 2 マス進んだか）も、**盤に現れない**。
 *
 * そこで規定どおり **2 段構え**にする。
 * 1. **数えるときは今までどおりの印**を使う（権利を織り込まない）
 * 2. **しきい値に届いたときだけ**、手を遡って**その回ごとの権利が本当に同じだったか**を確かめる
 *
 * 権利を織り込まない印は**別の局面どうしを同じ箱に入れる**＝数えすぎることはあっても
 * **数え足りないことは絶対にない**。だから届いていないうちは本当の繰り返しも届いて
 * いない（見落とさない）。**遡るのは引き分けが成立しかけた瞬間だけ**である。
 */

import type { Mgf } from '../mgf/types';
import type { Position } from '../position/types';
import { positionHash } from '../position/hash';
import { movedPieceIds } from '../moves/castling';
import { pawnSpecialMoves } from '../moves/pawn-special';

/**
 * **盤を見ても分からない権利**を 1 本の文字にする。
 *
 * **そういう権利を持たないルールでは常に空**＝将棋・はさみ将棋は手を 1 手も遡らない
 * （毎回の数えでこれを呼んでも重さが増えない）。
 */
export function hiddenRightsFingerprint(mgf: Mgf, position: Position): string {
  const parts: string[] = [];
  if (mgf.constraints?.castling) parts.push(`c:${castlingRights(mgf, position)}`);
  if (mgf.constraints?.pawn_double_step) parts.push(`e:${enPassantRight(mgf, position)}`);
  return parts.join('/');
}

/**
 * まだキャスリングに使える駒（王と、名指しされた相方）の番号。
 *
 * **権利は局面に持たせない**＝正本は手の並び 1 本なので、遡って数える
 * （キャスリングを生む側とまったく同じ数え方・§5.5.4）。
 */
function castlingRights(mgf: Mgf, position: Position): string {
  const partner = mgf.constraints?.castling?.partner;
  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
  const moved = movedPieceIds(position);
  const ids: string[] = [];
  for (const row of position.board) {
    for (const cell of row) {
      if (!cell) continue;
      if (!royalKinds.has(cell.kind) && cell.kind !== partner) continue;
      if (moved.has(cell.pieceId)) continue;
      ids.push(cell.pieceId);
    }
  }
  return ids.sort().join(',');
}

/**
 * いま**実際にアンパッサンで取れるか**（取れるなら通り過ぎたマス）。
 *
 * 「直前の手が 2 マス進みだったか」だけで見ると、**取れる駒が居ない場合まで別の局面に
 * してしまう**——本家の決まりは「アンパッサンで取れなくなったら同じ局面」なので、
 * それでは数え足りない側に外れる（正しい主張を退けてしまう）。**取れる手が本当に
 * あるか**で見る。
 */
function enPassantRight(mgf: Mgf, position: Position): string {
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== position.sideToMove) continue;
      for (const move of pawnSpecialMoves(mgf, position, { row, col })) {
        // アンパッサンだけが並び（取られるポーンを取り除く）を持つ。初手 2 マスは持たない。
        if (move.extra_steps && move.extra_steps.length > 0) {
          return `${move.to.row},${move.to.col}`;
        }
      }
    }
  }
  return '-';
}

/**
 * その局面が、これまでに**同じ権利のまま**何回現れたか（いまの 1 回を含む）。
 *
 * `past` は**これまでの局面すべて**（各手を指す前の局面）。**しきい値に届いたときだけ
 * 呼ぶ**ことを前提に、遡って 1 つずつ確かめる。
 */
export function countSamePositions(mgf: Mgf, past: Position[], current: Position): number {
  const hash = positionHash(current);
  const rights = hiddenRightsFingerprint(mgf, current);
  let n = 1;
  for (const old of past) {
    if (positionHash(old) !== hash) continue;
    if (hiddenRightsFingerprint(mgf, old) !== rights) continue;
    n++;
  }
  return n;
}
