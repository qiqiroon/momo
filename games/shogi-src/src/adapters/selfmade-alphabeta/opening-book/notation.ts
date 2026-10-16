/**
 * ★v1.84 §7.3.7: 定石の手順を書く日本語の棋譜表記を、盤の手に直す。
 *
 * 表の手順は人が読み書きする形 (`76歩 34歩 58金右 同歩 22角成 55角打`) で持ち、
 * ここで 1 手ずつ合法手と突き合わせて手にする。**書いた手が 1 つの合法手に決まらなければ
 * 誤りとして止める** (指せない手・どの駒か決まらない手・成るか成らないか書いていない手)。
 *
 * 書き方:
 * - 行き先 (`76`) か `同` ＋ 駒の名前 (`歩 香 桂 銀 金 角 飛 玉 と 成香 成桂 成銀 馬 竜`)
 * - どの駒かの書き分け `右 左 直 上 引 寄` (手番の側から見た向き)
 * - `打` ＝ 持ち駒を打つ (書かなければ盤の駒を動かす)
 * - `成` / `不成` ＝ 成れる手では必ずどちらかを書く
 */

import type { Mgf } from '../../../core/engine/mgf/types';
import type { Move, Position, Square } from '../../../core/engine/position/types';
import { generateLegalMoves } from '../../../core/engine/moves/legal';
import { advancePosition } from '../../../core/engine/position/advance';
import { kifuPieceName } from '../../../core/engine/kifu/format';
import { shogiToInternal } from '../../../core/engine/position/coordinates';

const TOKEN =
  /^(同|[1-9][1-9])(成香|成桂|成銀|歩|香|桂|銀|金|角|飛|玉|王|と|馬|竜|龍)((?:右|左|直|上|引|寄)*)(打|不成|成)?$/;

function normalizeName(name: string): string {
  return name.replace('王', '玉').replace('龍', '竜');
}

export class NotationError extends Error {}

/** 1 手ぶんの表記を、その局面の合法手 1 つに直す。 */
export function parseMoveToken(mgf: Mgf, position: Position, token: string, last: Square | null): Move {
  const m = TOKEN.exec(token);
  if (!m) throw new NotationError(`書き方が読めない「${token}」`);
  const [, dest, rawName, mods, suffix] = m;
  let to: Square;
  if (dest === '同') {
    if (!last) throw new NotationError(`「同」の前に手が無い「${token}」`);
    to = last;
  } else {
    to = shogiToInternal(Number(dest[0]), Number(dest[1]), position.width);
  }
  const name = normalizeName(rawName);
  const side = position.sideToMove;
  const forward = side === 'player1' ? -1 : 1;
  const legal = generateLegalMoves(mgf, position);
  const matching = (drop: boolean) =>
    legal.filter((mv): mv is Exclude<Move, { type: 'free' }> => {
      if (mv.type === 'free') return false;
      if (mv.to.row !== to.row || mv.to.col !== to.col) return false;
      if (drop) {
        if (mv.type !== 'drop') return false;
        const piece = position.hands[side].find((p) => p.pieceId === mv.pieceId);
        return !!piece && normalizeName(kifuPieceName(mgf, position, piece)) === name;
      }
      if (mv.type !== 'move') return false;
      const piece = position.board[mv.from.row][mv.from.col];
      return !!piece && normalizeName(kifuPieceName(mgf, position, piece)) === name;
    });

  // 棋譜の作法: 盤の駒が行けないマスへ打つときは「打」を書かない。
  // 盤の駒が行けるのに「打」が無ければ、盤の駒を動かす手と読む。
  let cands = matching(suffix === '打');
  const isDrop = suffix === '打' || (cands.length === 0 && !suffix && !mods && dest !== '同' && matching(true).length > 0);
  if (isDrop && suffix !== '打') cands = matching(true);

  if (!isDrop) {
    const boardMoves = cands as Extract<Move, { type: 'move' }>[];
    const canPromote = boardMoves.some((mv) => mv.promote);
    const canStay = boardMoves.some((mv) => !mv.promote);
    if (suffix === '成') cands = boardMoves.filter((mv) => mv.promote);
    else if (suffix === '不成') cands = boardMoves.filter((mv) => !mv.promote);
    else {
      if (canPromote && canStay) throw new NotationError(`成るか成らないか書いていない「${token}」`);
      cands = boardMoves;
    }
    for (const mod of mods) {
      const ms = cands as Extract<Move, { type: 'move' }>[];
      // 盤の上での向き: 手番の側の「前」へ進んだ量 (正＝前へ)。
      const ahead = (mv: Extract<Move, { type: 'move' }>) => (mv.to.row - mv.from.row) * forward;
      if (mod === '上') cands = ms.filter((mv) => ahead(mv) > 0);
      else if (mod === '引') cands = ms.filter((mv) => ahead(mv) < 0);
      else if (mod === '寄') cands = ms.filter((mv) => ahead(mv) === 0);
      else if (mod === '直') cands = ms.filter((mv) => ahead(mv) > 0 && mv.from.col === mv.to.col);
      else {
        // 右＝手番の側から見て右。先手は盤の右 (col が大きい＝1 筋側)、後手はその逆。
        const rightness = (mv: Extract<Move, { type: 'move' }>) => (side === 'player1' ? mv.from.col : -mv.from.col);
        const best = (mod === '右' ? Math.max : Math.min)(...ms.map(rightness));
        cands = ms.filter((mv) => rightness(mv) === best);
      }
    }
  }

  if (cands.length === 0) throw new NotationError(`指せない手「${token}」`);
  // 同じ駒・同じ行き先・同じ成りの手は 1 つにまとめる (合法手の生成が重ねて返すことはないが念のため)。
  const distinct = new Map<string, Move>();
  for (const mv of cands) {
    const key = mv.type === 'move' ? `${mv.from.row},${mv.from.col},${mv.promote}` : `drop`;
    if (!distinct.has(key)) distinct.set(key, mv);
  }
  if (distinct.size > 1) throw new NotationError(`どの駒か決まらない「${token}」(${distinct.size} 通り)`);
  return [...distinct.values()][0];
}

export interface ParsedLine {
  moves: Move[];
  /** 各手を指す直前の局面 (positions[i] で moves[i] を指す)。末尾は指し終えた局面。 */
  positions: Position[];
}

/** 手順 1 本を初期局面から並べて、手と局面の並びにする。誤りがあれば何手目かを添えて止める。 */
export function parseLine(mgf: Mgf, initial: Position, text: string): ParsedLine {
  const tokens = text.trim().split(/\s+/);
  const moves: Move[] = [];
  const positions: Position[] = [initial];
  let pos = initial;
  let last: Square | null = null;
  tokens.forEach((token, i) => {
    let move: Move;
    try {
      move = parseMoveToken(mgf, pos, token, last);
    } catch (e) {
      if (e instanceof NotationError) throw new NotationError(`${i + 1} 手目: ${e.message}`);
      throw e;
    }
    const r = advancePosition(mgf, pos, move, { quantum: false });
    if (r.anomaly || r.royalCaptured) throw new NotationError(`${i + 1} 手目: 盤を進められない「${token}」`);
    moves.push(move);
    pos = r.position;
    positions.push(pos);
    last = move.type === 'free' ? null : move.to;
  });
  return { moves, positions };
}
