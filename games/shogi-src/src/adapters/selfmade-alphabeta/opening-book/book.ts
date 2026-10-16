/**
 * ★v1.84 §7.3.7: 序盤の定石の表を引く。
 *
 * 手順 (lines.ts) を初期局面から並べ直し、**局面ごとに「その局面で指された手と重み」を集めた表**
 * を作る (最初に引いたときに 1 回だけ作る)。局面は千日手と同じ見分け方 (`positionHash`＝
 * 盤・持ち駒・手番。何手目かは見ない) なので、手順前後で同じ形に戻ればまた表を使う。
 *
 * 引き方 (§7.3.7.4):
 * 1. 局面がそのまま表にあれば、重みで 1 手を選んで指す。
 * 2. 無ければ**近い形** (端歩が 1 マス違う／玉が 1 マス違う) の局面を表で探す。見つかった手は
 *    そのまま指さず、**短く読んで自分の最善手より大きく悪くないときだけ**指す。
 * 3. どちらでもなければ表を使わない (いつもどおり読む)。
 *
 * 効くのは本将棋の平手だけ (§7.3.7.1)。量子・トーラスは局面の見分けが同じでも中身が違うので
 * 呼ぶ側 (search.ts) が引かない。
 */

import type { Mgf } from '../../../core/engine/mgf/types';
import type { Move, Position } from '../../../core/engine/position/types';
import { positionHash } from '../../../core/engine/position/hash';
import { generateLegalMoves } from '../../../core/engine/moves/legal';
import { initPosition } from '../../../core/engine/position/init';
import { BOOK_LINES, type BookLine } from './lines';
import { parseLine } from './notation';

/** 表の 1 手。同じ局面・同じ手は重みを足し合わせて 1 つにする。 */
export interface BookEntry {
  /** 手の見分け (どの局面でも同じ手なら同じ文字になる)。 */
  key: string;
  weight: number;
  /** 出どころ (§7.3.7.6)。 */
  sources: BookLine['source'][];
  /** この手を通る手順の名前 (確かめの棋譜で使う)。 */
  lines: string[];
}

export type OpeningBook = Map<string, BookEntry[]>;

/** 近い形の手を指してよい損の幅 (歩 1 枚 = 100)。§7.3.7.4「大きく悪くない」の仮の値。 */
export const NEAR_MARGIN = 50;
/** 近い形の手を確かめるときに読む局面の数。§7.3.7.4「短く」の仮の値。 */
export const NEAR_NODES = 3000;

/** 手の見分け。盤の手は元と行き先と成り、打つ手は駒の種類と行き先。 */
export function moveKey(position: Position, move: Move): string | null {
  if (move.type === 'move') {
    return `m${move.from.row}${move.from.col}-${move.to.row}${move.to.col}${move.promote ? '+' : ''}`;
  }
  if (move.type === 'drop') {
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === move.pieceId);
    return piece ? `d${piece.kind}-${move.to.row}${move.to.col}` : null;
  }
  return null;
}

/** 手順の並びから表を作る。手順に誤りがあればその 1 本を飛ばす (検査が誤りを出さないことを確かめている)。 */
export function buildBook(mgf: Mgf, lines: readonly BookLine[] = BOOK_LINES): OpeningBook {
  const book: OpeningBook = new Map();
  const initial = initPosition(mgf);
  for (const line of lines) {
    let parsed;
    try {
      parsed = parseLine(mgf, initial, line.moves);
    } catch {
      continue;
    }
    parsed.moves.forEach((move, i) => {
      const pos = parsed.positions[i];
      const key = moveKey(pos, move);
      if (!key) return;
      const h = positionHash(pos);
      const list = book.get(h) ?? [];
      let entry = list.find((e) => e.key === key);
      if (!entry) {
        entry = { key, weight: 0, sources: [], lines: [] };
        list.push(entry);
      }
      entry.weight += line.weight;
      if (!entry.sources.includes(line.source)) entry.sources.push(line.source);
      entry.lines.push(line.name);
      book.set(h, list);
    });
  }
  return book;
}

let cached: OpeningBook | null = null;

/** 本将棋の表 (最初に引いたときに作って持っておく)。 */
export function standardBook(mgf: Mgf): OpeningBook {
  if (!cached) cached = buildBook(mgf);
  return cached;
}

/** 表の手をこの局面の合法手に直す (指せなければ null)。 */
export function entryToMove(mgf: Mgf, position: Position, key: string, legal?: Move[]): Move | null {
  for (const mv of legal ?? generateLegalMoves(mgf, position)) {
    if (moveKey(position, mv) === key) return mv;
  }
  return null;
}

/** 重みで 1 つ選ぶ。 */
export function pickWeighted<T extends { weight: number }>(items: readonly T[], random: () => number): T | null {
  const total = items.reduce((s, e) => s + e.weight, 0);
  if (items.length === 0 || total <= 0) return null;
  let r = random() * total;
  for (const e of items) {
    r -= e.weight;
    if (r < 0) return e;
  }
  return items[items.length - 1];
}

/**
 * 近い形 (§7.3.7.4) の局面の見分けを並べる。
 * 1. 端歩 (1 筋・9 筋の成っていない歩) を 1 マス前か後ろへずらした局面
 * 2. 玉を隣の空いたマスへずらした局面
 * どちらも**違いは 1 か所だけ**。ずらした先が空いているときだけ作る。
 */
export function nearHashes(position: Position): string[] {
  const out: string[] = [];
  const { width, height, board } = position;
  const shifted = (fr: number, fc: number, tr: number, tc: number): string => {
    const rows = board.map((row) => row.slice());
    rows[tr][tc] = rows[fr][fc];
    rows[fr][fc] = null;
    return positionHash({ ...position, board: rows });
  };
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = board[row][col];
      if (!cell) continue;
      if (cell.kind === 'fu' && !cell.promoted && (col === 0 || col === width - 1)) {
        for (const dr of [-1, 1]) {
          const r = row + dr;
          if (r >= 0 && r < height && !board[r][col]) out.push(shifted(row, col, r, col));
        }
      }
      if (cell.kind === 'ou') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const r = row + dr;
            const c = col + dc;
            if (r >= 0 && r < height && c >= 0 && c < width && !board[r][c]) out.push(shifted(row, col, r, c));
          }
        }
      }
    }
  }
  return out;
}

export interface BookProbe {
  /** そのまま一致した局面の手。 */
  exact: { entry: BookEntry; move: Move }[];
  /** 近い形の局面の手 (この局面で指せるものだけ)。 */
  near: { entry: BookEntry; move: Move }[];
}

/** 局面を表で引く。指せない手は落とす。 */
export function probeBook(mgf: Mgf, book: OpeningBook, position: Position): BookProbe {
  const legal = generateLegalMoves(mgf, position);
  const toMoves = (entries: BookEntry[] | undefined) =>
    (entries ?? []).flatMap((entry) => {
      const move = entryToMove(mgf, position, entry.key, legal);
      return move ? [{ entry, move }] : [];
    });
  const exact = toMoves(book.get(positionHash(position)));
  if (exact.length > 0) return { exact, near: [] };
  const seen = new Map<string, { entry: BookEntry; move: Move }>();
  for (const h of nearHashes(position)) {
    for (const c of toMoves(book.get(h))) {
      const prev = seen.get(c.entry.key);
      if (prev) prev.entry = { ...prev.entry, weight: prev.entry.weight + c.entry.weight };
      else seen.set(c.entry.key, { entry: { ...c.entry }, move: c.move });
    }
  }
  return { exact, near: [...seen.values()] };
}

/** 表を引いてよい対局か (§7.3.7.1)。本将棋の定義で、量子でも盤の端がつながってもいない。 */
export function bookApplies(mgf: Mgf, position: Position, quantum: boolean): boolean {
  if (quantum) return false;
  if (mgf.metadata?.game_id !== 'honshogi') return false;
  if (position.topology && (position.topology.wrapX || position.topology.wrapY)) return false;
  if (position.width !== 9 || position.height !== 9) return false;
  return true;
}

