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
 * 終局パネルの補足詳細＝折込みカード (★v1.86・付録D-3 v1.10 §3.4)。
 *
 * ここで固定したいのは 4 点。
 *   - **該当する終局理由のときだけ出る**（それ以外はカードごと出さない）
 *   - **3 つの終局理由が同じ形で出る**＝v1.85 までは全滅だけが枠も項目名も無い
 *     1 行で、入玉宣言と持将棋は規定があるのに出ていなかった
 *   - **入玉宣言は宣言した側だけ・持将棋は双方**（数える範囲の但し書きつき）
 *   - **量子モードでは大駒の名前を出さず枚数だけ**（量子分冊 v0.9 §Q21.7）
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

/** カードの行を「項目名 → 値」で読み取る。 */
function readCard(container: HTMLElement): Record<string, string> {
  const card = container.querySelector('.floating-result .detail');
  if (!card) return {};
  const out: Record<string, string> = {};
  for (const row of card.querySelectorAll('.drow')) {
    const label = row.querySelector('span')?.textContent ?? '';
    const value = row.querySelector('b')?.textContent ?? '';
    out[label] = value;
  }
  return out;
}

beforeEach(() => {
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
});

describe('補足詳細の折込みカード（付録D-3 v1.10 §3.4）', () => {
  it('★該当しない終局理由ではカードごと出さない（投了）', () => {
    useGameStore
      .getState()
      .reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    useGameStore.getState().resign('player2');
    const { container } = render(<App variant="b" />);
    expect(container.querySelector('.floating-result')).not.toBeNull();
    expect(container.querySelector('.floating-result .detail')).toBeNull();
  });

  it('★全滅（はさみ）は双方の残り駒と勝利条件を出す', () => {
    // はさみ将棋の勝利条件は「相手の盤上の駒が 2 枚以下」。
    useGameStore
      .getState()
      .reset({ gameType: 'hasami', quantum: false, torusMode: 'none', handicap: null });
    const pos = useGameStore.getState().position;
    useGameStore.setState({ status: 'annihilation_win_p1' as never, position: pos });
    const { container } = render(<App variant="b" />);
    const card = readCard(container);
    expect(Object.keys(card)).toEqual(['先手の残り駒', '後手の残り駒', '勝利条件']);
    expect(card['勝利条件']).toBe('2枚以下');
  });

  it('★入玉宣言は宣言した側だけを出す（点数・敵陣内の駒数・敵陣内の大駒）', () => {
    // 先手玉＋飛＋角が敵陣内。点数 = 1 + 5 + 5 - 王 1 = 10 点、駒数 = 3 - 王 1 = 2 枚。
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 1, col: 2, piece: P('hi', 'player1') },
      { row: 2, col: 6, piece: P('kaku', 'player1') },
      { row: 8, col: 4, piece: P('ou', 'player2') },
    ]);
    showResult('nyugyoku_win_p1', pos);
    const { container } = render(<App variant="b" />);
    const card = readCard(container);
    expect(Object.keys(card)).toEqual(['点数', '敵陣内の駒数（玉を除く）', '敵陣内の大駒']);
    // 点数法の呼び名はルール定義（本将棋 = 27点法）から取る。
    expect(card['点数']).toBe('10点（27点法）');
    expect(card['敵陣内の駒数（玉を除く）']).toBe('2枚');
    expect(card['敵陣内の大駒']).toBe('飛1・角1');
  });

  it('★後手が宣言したときは後手の数字を出す（勝った側を取り違えない）', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: P('ou', 'player2') },
      { row: 7, col: 2, piece: P('hi', 'player2') },
      { row: 0, col: 4, piece: P('ou', 'player1') },
      // 先手の大駒は敵陣（先手から見た 1〜3 段）に居るが、後手の内訳には出ない。
      { row: 1, col: 0, piece: P('kaku', 'player1') },
    ]);
    showResult('nyugyoku_win_p2', pos);
    const { container } = render(<App variant="b" />);
    expect(readCard(container)['敵陣内の大駒']).toBe('飛1');
  });

  it('★量子モードでは大駒の名前を出さず枚数だけにする（量子分冊 v0.9 §Q21.7）', () => {
    // 敵陣内に 2 枚。**片方は角と確定していて、片方は飛か角か分からない**。
    // 確定しているほうの名前を出してしまうと、**分かっている駒だけが名前で出て、
    // 分からない駒が数から消える**＝内訳と点数が食い違う。だから量子モードでは
    // **確定している駒も含めて名前を出さない**。
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
    const value = readCard(container)['敵陣内の大駒'];
    expect(value).toBe('2枚');
    expect(value).not.toContain('飛');
    expect(value).not.toContain('角');
  });

  it('★持将棋は双方の点数を並べ、数える範囲が入玉宣言と違うことを添える', () => {
    // 初期局面は双方 27 点（盤の駒すべて＋持ち駒・玉を除く）。
    showResult('jishogi', initPosition(hondou));
    const { container } = render(<App variant="b" />);
    const card = readCard(container);
    expect(Object.keys(card)).toEqual(['先手の点数', '後手の点数', '数える範囲', '1 枚の数え方']);
    expect(card['先手の点数']).toBe('27点');
    expect(card['後手の点数']).toBe('27点');
    expect(card['数える範囲']).toBe('盤上の駒すべて＋持ち駒');
  });

  it('★3 つの終局理由とも同じ形で出す（理由ごとに違う見せ方を作らない）', () => {
    const cases: Array<[string, Position]> = [
      ['jishogi', initPosition(hondou)],
      [
        'nyugyoku_win_p1',
        buildPos([
          { row: 0, col: 4, piece: P('ou', 'player1') },
          { row: 8, col: 4, piece: P('ou', 'player2') },
        ]),
      ],
    ];
    for (const [status, pos] of cases) {
      showResult(status, pos);
      const { container, unmount } = render(<App variant="b" />);
      const card = container.querySelector('.floating-result .detail');
      expect(card, status).not.toBeNull();
      // 1 行につき「項目名」と「値」の 2 列（値だけが太字）。
      for (const row of card!.querySelectorAll('.drow')) {
        expect(row.querySelector('span'), status).not.toBeNull();
        expect(row.querySelector('b'), status).not.toBeNull();
      }
      unmount();
    }
  });

  it('英語でも項目名と値が入れ替わらない（値の側だけが数字を持つ）', () => {
    useI18nStore.setState({ locale: 'en' });
    showResult('jishogi', initPosition(hondou));
    const { container } = render(<App variant="b" />);
    const card = readCard(container);
    expect(card['Sente points']).toBe('27 pts');
    expect(card['Counted']).toBe('All pieces on board + in hand');
  });
});
