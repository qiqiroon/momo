/**
 * 持将棋（合意による引き分け）の点数と提案条件（親 v1.62 §4.4.1・量子分冊 v0.8 §Q21.5）。
 *
 * ここで押さえたいことは 3 つ。
 * 1. **入玉宣言とは合計をとる範囲が違う**（持将棋＝盤の駒すべて＋持ち駒／入玉宣言＝敵陣内＋持ち駒）
 * 2. **1 枚あたりの数え方は共通**（飛角龍馬 5 点・王の分を 1 回だけ引く・量子の読み替えも同じ）
 * 3. **点数だけでは提案できない**（入玉の成立が前提。初期局面は双方 27 点あるため）
 */
import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { Mgf } from '../mgf/types';
import type { PieceInstance, Position } from '../position/types';
import { computeEnterZonePoints, computeJishogiPoints, canProposeJishogi } from './nyugyoku';
import { winnerOf } from '../../store/game-store';
import { endingLabel } from '../../../features/kifu-replay/ui/ending';

function buildPos(
  pieces: Array<{ row: number; col: number; piece: PieceInstance }>,
  sideToMove: 'player1' | 'player2' = 'player1',
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

const P = (kind: string, owner: 'player1' | 'player2', promoted = false): PieceInstance => ({
  pieceId: `${owner}_${kind}_${Math.abs(kind.length * 7)}`,
  kind,
  owner,
  initialOwner: owner,
  initialKind: kind,
  initialSquare: { row: -1, col: -1 },
  promoted,
});

/**
 * 双方が入玉していて、双方 24 点以上ある局面。
 * 先手の玉は 1 段目・後手の玉は 9 段目（互いの敵陣）で、どちらも相手の利きの外。
 */
function bothEnteredPosition(): Position {
  const pieces: Array<{ row: number; col: number; piece: PieceInstance }> = [
    { row: 0, col: 0, piece: P('ou', 'player1') },
    { row: 8, col: 8, piece: P('ou', 'player2') },
  ];
  // 互いに触れない位置へ、点数のもとになる駒を並べる（利きが玉に届かない配置）。
  const senteBack = [1, 2, 3, 4, 5, 6, 7];
  senteBack.forEach((col, i) => {
    pieces.push({ row: 4, col, piece: P(i < 2 ? 'kin' : 'fu', 'player1') });
  });
  const goteBack = [1, 2, 3, 4, 5, 6, 7];
  goteBack.forEach((col, i) => {
    pieces.push({ row: 5, col, piece: P(i < 2 ? 'kin' : 'fu', 'player2') });
  });
  const pos = buildPos(pieces);
  return {
    ...pos,
    hands: {
      // 盤上 7 枚（王を除く）＋ 持ち駒で 24 点を超えさせる
      player1: [
        P('hi', 'player1'),
        P('hi', 'player1'),
        P('kaku', 'player1'),
        ...Array.from({ length: 6 }, () => P('fu', 'player1')),
      ],
      player2: [
        P('kaku', 'player2'),
        P('kaku', 'player2'),
        P('hi', 'player2'),
        ...Array.from({ length: 6 }, () => P('fu', 'player2')),
      ],
    },
  };
}

describe('computeJishogiPoints（持将棋の点数）', () => {
  it('★初期局面では双方 27 点＝点数だけを条件にすると 1 手目から成立してしまう', () => {
    const pos = initPosition(hondou);
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBe(27);
    expect(computeJishogiPoints(hondou, pos, 'player2')).toBe(27);
  });

  it('★入玉宣言とは数える範囲が違う（同じ局面で 27 点 対 0 点）', () => {
    const pos = initPosition(hondou);
    // 入玉宣言は敵陣内だけを数えるので、初期局面では 0。
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(0);
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBe(27);
  });

  it('1 枚あたりの数え方は入玉宣言と共通（大駒 5 点・王は数えない）', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: P('ou', 'player1') },
      { row: 7, col: 0, piece: P('hi', 'player1') },
      { row: 7, col: 1, piece: P('fu', 'player1') },
    ]);
    // 飛 5 ＋ 歩 1 ＋ 王 1 －（王の分 1）＝ 6
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBe(6);
  });

  it('持ち駒も数える', () => {
    let pos = buildPos([{ row: 8, col: 4, piece: P('ou', 'player1') }]);
    pos = {
      ...pos,
      hands: { player1: [P('hi', 'player1'), P('fu', 'player1')], player2: [] },
    };
    // 王 1 ＋ 飛 5 ＋ 歩 1 －（王の分 1）＝ 6
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBe(6);
  });

  it('王の分を引くのは 1 回だけ（王候補が複数あっても）', () => {
    const pos = buildPos([
      { row: 8, col: 3, piece: P('ou', 'player1') },
      { row: 8, col: 5, piece: P('ou', 'player1') },
      { row: 7, col: 0, piece: P('fu', 'player1') },
    ]);
    // 王 1 ＋ 王 1 ＋ 歩 1 －（王の分 1・1 回だけ）＝ 2
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBe(2);
  });
});

describe('canProposeJishogi（提案を出せるか）', () => {
  it('★初期局面では出せない＝双方 27 点あっても入玉していない', () => {
    const pos = initPosition(hondou);
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(24);
    expect(computeJishogiPoints(hondou, pos, 'player2')).toBeGreaterThanOrEqual(24);
    expect(canProposeJishogi(hondou, pos)).toBe(false);
  });

  it('双方が入玉していて双方 24 点以上なら出せる', () => {
    const pos = bothEnteredPosition();
    expect(computeJishogiPoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(24);
    expect(computeJishogiPoints(hondou, pos, 'player2')).toBeGreaterThanOrEqual(24);
    expect(canProposeJishogi(hondou, pos)).toBe(true);
  });

  it('★片方しか入玉していなければ出せない（双方について問う）', () => {
    const base = bothEnteredPosition();
    // 後手の玉だけ自陣へ戻す（＝後手は入玉していない）
    const board = base.board.map((r) => [...r]);
    board[8][8] = null;
    board[0][8] = P('ou', 'player2');
    const pos: Position = { ...base, board };
    expect(canProposeJishogi(hondou, pos)).toBe(false);
  });

  it('★双方入玉でも、片方が 24 点に足りなければ出せない', () => {
    const base = bothEnteredPosition();
    // 後手の持ち駒を空にして点数を落とす
    const pos: Position = { ...base, hands: { ...base.hands, player2: [] } };
    expect(computeJishogiPoints(hondou, pos, 'player2')).toBeLessThan(24);
    expect(canProposeJishogi(hondou, pos)).toBe(false);
  });

  it('ルール定義が持将棋を持たなければ出せない（省略時は提案そのものを出さない）', () => {
    const pos = bothEnteredPosition();
    const noJishogi: Mgf = {
      ...hondou,
      victory: { ...hondou.victory, jishogi: undefined },
    };
    expect(canProposeJishogi(noJishogi, pos)).toBe(false);
  });

  it('しきい値はルール定義から読む（30 点にすると出せなくなる）', () => {
    const pos = bothEnteredPosition();
    const strict: Mgf = {
      ...hondou,
      victory: { ...hondou.victory, jishogi: { enabled: true, point_threshold: 30 } },
    };
    expect(canProposeJishogi(strict, pos)).toBe(false);
  });
});

describe('持将棋で終わった対局の扱い', () => {
  it('★勝った側は居ない（引き分けなので）', () => {
    expect(winnerOf('jishogi', 'player1')).toBeNull();
    expect(winnerOf('jishogi', 'player2')).toBeNull();
  });

  it('★棋譜には「持将棋」と残り、「合意による引分」とは別の言葉になる', () => {
    const jishogi = endingLabel({ status: 'jishogi', winner: null }, 'ja');
    const agreed = endingLabel({ status: 'agreed_draw', winner: null }, 'ja');
    // **言葉が実際に入っていること**を見る（`null` のまま素通りしないため）。
    expect(jishogi).toContain('持将棋');
    expect(agreed).toContain('合意');
    expect(jishogi).not.toBe(agreed);
  });
});
