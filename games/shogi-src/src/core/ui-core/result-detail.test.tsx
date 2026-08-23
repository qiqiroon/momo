import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { useRouteStore } from '../store/route-store';
import { useI18nStore } from '../store/i18n-store';
import { hondou } from '../engine/mgf/loader';
import { initPosition } from '../engine/position/init';
import type { PieceInstance, Position } from '../engine/position/types';

/**
 * 終局パネルの補足詳細＝折込みカード (★v1.87・付録D-3 v1.11 §3.4／§4.1)。
 *
 * ここで固定したいのは 6 点。
 *   - **該当する終局理由のときだけ出る**（それ以外はカードごと出さない）
 *   - **点数は合計だけでなく式で出す**＝合計だけでは、その数がどう出たのか
 *     読み手に確かめようがない（同じ「点」で数える範囲が 2 通りあるため）
 *   - **入玉宣言は 3 条件を式で出し、達成の有無を印で示す**
 *   - **入玉宣言は宣言した側だけ・持将棋は双方**（数える範囲の但し書きつき）
 *   - **量子モードでは大駒の名前を出さず枚数だけ**（量子分冊 v0.9 §Q21.7）
 *   - **★透明パネルの上では本文に灰色を使わない**（付録D-3 v1.11 §4.1）
 */

const P = (
  kind: string,
  owner: 'player1' | 'player2',
  candidates?: Set<string>,
  id?: string,
): PieceInstance => ({
  pieceId: id ?? `${owner}_${kind}_${candidates ? 'q' : 'n'}`,
  kind,
  owner,
  initialOwner: owner,
  initialKind: kind,
  initialSquare: { row: -1, col: -1 },
  promoted: false,
  ...(candidates ? { candidates } : {}),
});

function buildPos(pieces: Array<{ row: number; col: number; piece: PieceInstance }>): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

/** 終局した画面を作る。盤と終局理由だけを差し替える（パネルはこの 2 つから作られる）。 */
function showResult(status: string, position: Position) {
  useGameStore
    .getState()
    .reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  useGameStore.setState({ status: status as never, position });
}

/** 2 列の行を「項目名 → 値」で読み取る。 */
function readRows(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of container.querySelectorAll('.floating-result .detail .drow')) {
    out[row.querySelector('span')?.textContent ?? ''] = row.querySelector('b')?.textContent ?? '';
  }
  return out;
}

/** 1 行まるごとの行を上から順に読み取る。 */
function readLines(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.floating-result .detail .dline')].map(
    (el) => el.textContent ?? '',
  );
}

/** 敵陣内に玉＋飛＋角、自陣に相手玉。点数 = 5+5+1-1 = 10、敵陣内の駒数 = 3-1 = 2。 */
function nyugyokuPos(): Position {
  return buildPos([
    { row: 0, col: 4, piece: P('ou', 'player1') },
    { row: 1, col: 2, piece: P('hi', 'player1') },
    { row: 2, col: 6, piece: P('kaku', 'player1') },
    { row: 8, col: 4, piece: P('ou', 'player2') },
  ]);
}

beforeEach(() => {
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
});

describe('補足詳細の折込みカード（付録D-3 v1.11 §3.4）', () => {
  it('★該当しない終局理由ではカードごと出さない（投了）', () => {
    useGameStore
      .getState()
      .reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    useGameStore.getState().resign('player2');
    const { container } = render(<App variant="b" />);
    expect(container.querySelector('.floating-result')).not.toBeNull();
    expect(container.querySelector('.floating-result .detail')).toBeNull();
  });

  it('★全滅（はさみ）は双方の残り駒と勝利条件を出す（2 列の行だけ）', () => {
    // はさみ将棋の勝利条件は「相手の盤上の駒が 2 枚以下」。
    useGameStore
      .getState()
      .reset({ gameType: 'hasami', quantum: false, torusMode: 'none', handicap: null });
    const pos = useGameStore.getState().position;
    useGameStore.setState({ status: 'annihilation_win_p1' as never, position: pos });
    const { container } = render(<App variant="b" />);
    expect(Object.keys(readRows(container))).toEqual([
      '先手の残り駒',
      '後手の残り駒',
      '勝利条件',
    ]);
    expect(readRows(container)['勝利条件']).toBe('2枚以下');
    expect(readLines(container)).toEqual([]);
  });

  it('★点数は合計だけでなく式で出す（入玉の有無も同じ行に）', () => {
    showResult('nyugyoku_win_p1', nyugyokuPos());
    const { container } = render(<App variant="b" />);
    expect(readLines(container)[0]).toBe(
      '先手：入玉、大駒5点×2枚＋小駒1点×1枚（玉1枚を除く）＝10点',
    );
  });

  it('★式の合計は、判定に使う点数と必ず一致する（別々に数えない）', () => {
    showResult('nyugyoku_win_p1', nyugyokuPos());
    const { container } = render(<App variant="b" />);
    const line = readLines(container)[0];
    const m = line.match(/大駒5点×(\d+)枚＋小駒1点×(\d+)枚（玉1枚を除く）＝(\d+)点/);
    expect(m).not.toBeNull();
    const [, major, minor, total] = m!.map(Number);
    expect(major * 5 + minor - 1).toBe(total);
    // 条件の行に出る点数とも同じ数であること。
    expect(readLines(container)[3]).toContain(`点数 ${total}点`);
  });

  it('★入玉宣言は 3 つの条件を式で出し、達成の印を付ける', () => {
    showResult('nyugyoku_win_p1', nyugyokuPos());
    const { container } = render(<App variant="b" />);
    const lines = readLines(container);
    expect(lines[1]).toBe('入玉できている ✓');
    expect(lines[2]).toBe('敵陣内の駒数 2枚 ≥ 10枚 ✗');
    // しきい値は宣言した側のもの（27 点法＝先手 28・後手 27）。
    expect(lines[3]).toBe('点数 10点 ≥ 28点（27点法） ✗');
  });

  it('★宣言が通る局面では 3 つとも ✓ になる（実際に宣言できる形で確かめる）', () => {
    // 敵陣内に 玉＋飛＋角＋歩9 の 12 枚 → 枚数 11（玉を除く）。
    // 点数 = 5+5+小駒10 = 20 → 玉の分 -1 = 19、持ち駒の歩 9 枚を足して 28。
    const pieces = [
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 0, col: 0, piece: P('hi', 'player1') },
      { row: 0, col: 1, piece: P('kaku', 'player1') },
      { row: 8, col: 4, piece: P('ou', 'player2') },
    ];
    for (let c = 0; c < 9; c++) {
      pieces.push({ row: 1, col: c, piece: { ...P('fu', 'player1'), pieceId: `p1_fu_b${c}` } });
    }
    const base = buildPos(pieces);
    const pos: Position = {
      ...base,
      hands: {
        player1: Array.from({ length: 9 }, (_, i) => ({
          ...P('fu', 'player1'),
          pieceId: `p1_fu_h${i}`,
        })),
        player2: [],
      },
    };
    showResult('nyugyoku_win_p1', pos);
    const { container } = render(<App variant="b" />);
    const lines = readLines(container);
    expect(lines[0]).toBe('先手：入玉、大駒5点×2枚＋小駒1点×19枚（玉1枚を除く）＝28点');
    expect(lines[1]).toBe('入玉できている ✓');
    expect(lines[2]).toBe('敵陣内の駒数 11枚 ≥ 10枚 ✓');
    expect(lines[3]).toBe('点数 28点 ≥ 28点（27点法） ✓');
  });

  it('★条件を満たしていない項目には ✗ が付く（印が飾りになっていない）', () => {
    showResult('nyugyoku_win_p1', nyugyokuPos());
    const { container } = render(<App variant="b" />);
    const marks = [...container.querySelectorAll('.floating-result .detail .dline .mark')].map(
      (el) => el.textContent?.trim(),
    );
    expect(marks).toEqual(['✓', '✗', '✗']);
  });

  it('★後手が宣言したときは後手のしきい値（27 点）を出す', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: P('ou', 'player2') },
      { row: 7, col: 2, piece: P('hi', 'player2') },
      { row: 0, col: 4, piece: P('ou', 'player1') },
    ]);
    showResult('nyugyoku_win_p2', pos);
    const { container } = render(<App variant="b" />);
    expect(readLines(container)[0]).toContain('後手：');
    expect(readLines(container)[3]).toContain('≥ 27点');
  });

  it('★数える範囲を添える（式の枚数は持ち駒を含み、条件の枚数は盤上だけ）', () => {
    showResult('nyugyoku_win_p1', nyugyokuPos());
    const { container } = render(<App variant="b" />);
    expect(readRows(container)['数える範囲']).toBe('敵陣内の駒＋持ち駒');
  });

  it('★量子モードでは大駒の名前を出さず枚数だけにする（量子分冊 v0.9 §Q21.7）', () => {
    // 敵陣内に 2 枚。**片方は角と確定していて、片方は飛か角か分からない**。
    // 確定しているほうの名前を出してしまうと、**分かっている駒だけが名前で出て、
    // 分からない駒が数から消える**＝内訳と点数が食い違う。
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 8, col: 0, piece: P('hi', 'player1', undefined, 'q_hi') },
      { row: 8, col: 1, piece: P('kaku', 'player1', undefined, 'q_kaku') },
      { row: 1, col: 2, piece: P('hi', 'player1', new Set(['q_hi', 'q_kaku'])) },
      { row: 1, col: 6, piece: P('kaku', 'player1', new Set(['q_kaku'])) },
      { row: 8, col: 4, piece: P('ou', 'player2') },
    ]);
    showResult('nyugyoku_win_p1', pos);
    const { container } = render(<App variant="b" />);
    const value = readRows(container)['敵陣内の大駒'];
    expect(value).toBe('2枚');
    expect(value).not.toContain('飛');
    expect(value).not.toContain('角');
  });

  it('★持将棋は双方の式を並べ、数える範囲が入玉宣言と違うことを添える', () => {
    // 初期局面は双方 27 点（盤の駒すべて＋持ち駒・玉を除く）＝大駒 2 枚＋小駒 18 枚。
    showResult('jishogi', initPosition(hondou));
    const { container } = render(<App variant="b" />);
    const lines = readLines(container);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('先手：大駒5点×2枚＋小駒1点×18枚（玉1枚を除く）＝27点');
    expect(lines[1]).toBe('後手：大駒5点×2枚＋小駒1点×18枚（玉1枚を除く）＝27点');
    // 初期局面では入玉していないので「入玉」とは書かない。
    expect(lines[0]).not.toContain('入玉');
    expect(readRows(container)['数える範囲']).toBe('盤上の駒すべて＋持ち駒');
  });

  it('★持将棋で入玉している側には「入玉」と添える', () => {
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 8, col: 4, piece: P('ou', 'player2') },
    ]);
    showResult('jishogi', pos);
    const { container } = render(<App variant="b" />);
    expect(readLines(container)[0]).toContain('入玉');
  });

  it('英語でも式が組み立てられる（語順は言語ごとの雛形が持つ）', () => {
    useI18nStore.setState({ locale: 'en' });
    showResult('jishogi', initPosition(hondou));
    const { container } = render(<App variant="b" />);
    const line = readLines(container)[0];
    expect(line).toBe('Sente: major 5 x 2 + minor 1 x 18 (less 1 king) = 27 pts');
    expect(line).not.toContain('{');
  });
});
