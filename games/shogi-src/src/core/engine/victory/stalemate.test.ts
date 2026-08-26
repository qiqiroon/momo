/**
 * ステイルメイト（親 v1.65 §3.10・チェス §5.5.5・第 9 段 9-4d）。
 *
 * 押さえたいことは 4 つ。
 * 1. **王手ではないが指す手が無い**ときだけ成立する（王手されていれば詰み・逃げ道があれば対局続行）
 * 2. **ルール定義が欄を持つときだけ判定する**＝本将棋・はさみ将棋は従来どおり何も起きない
 * 3. **引き分けにも、手番側の負けにもできる**（`result` を読む）
 * 4. 終局の言葉が対局画面と棋譜で同じキーから出る
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { chess, hondou, hasami } from '../mgf/loader';
import type { Mgf } from '../mgf/types';
import type { PieceInstance, Position } from '../position/types';
import { isCheckmate, isStalemate } from '../moves/legal';
import { useGameStore, winnerOf } from '../../store/game-store';
import { endingLabel } from '../../../features/kifu-replay/ui/ending';

/** チェス盤の内部座標。row 7 = 段 1・col 0 = a 列。 */
const A1 = { row: 7, col: 0 };
const G5 = { row: 3, col: 6 };
const G6 = { row: 2, col: 6 };
const H8 = { row: 0, col: 7 };

function mk(kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return {
    pieceId: `${owner}-${kind}-${row}-${col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function posWith(
  pieces: PieceInstance[],
  sideToMove: 'player1' | 'player2' = 'player1',
): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

/**
 * 手番（後手）が動けないが王手はされていない盤。
 * 後手の王は h8 の 1 枚だけ・先手のクイーンが g6 で h7・g7・g8 をすべて塞いでいる。
 */
function stalematePosition(): Position {
  return posWith(
    [
      mk('king', 'player2', H8.row, H8.col),
      mk('queen', 'player1', G6.row, G6.col),
      mk('king', 'player1', A1.row, A1.col),
    ],
    'player2',
  );
}

/** ルール定義から欄を 1 つ落とした写し（元の定義は触らない）。 */
function withoutStalemate(mgf: Mgf): Mgf {
  const copy = JSON.parse(JSON.stringify(mgf)) as Mgf;
  delete copy.victory?.stalemate;
  return copy;
}

describe('9-4d ステイルメイト（成立の見分け）', () => {
  it('王手ではないが指す手が無い → ステイルメイト（詰みではない）', () => {
    const pos = stalematePosition();
    expect(isCheckmate(chess, pos)).toBe(false);
    expect(isStalemate(chess, pos)).toBe(true);
  });

  it('逃げ道が 1 つでもあれば成立しない', () => {
    // クイーンが g5 に居ると h7 が空くので、王は逃げられる。
    const pos = posWith(
      [
        mk('king', 'player2', H8.row, H8.col),
        mk('queen', 'player1', G5.row, G5.col),
        mk('king', 'player1', A1.row, A1.col),
      ],
      'player2',
    );
    expect(isStalemate(chess, pos)).toBe(false);
  });

  it('王手されていれば詰みの側に転ぶ（同じ「手が無い」でも別の終局）', () => {
    // 後手 Kh8 に、先手のルーク 2 枚で 8 段目と 7 段目を塞ぐ（はしご詰め）。
    const pos = posWith(
      [
        mk('king', 'player2', H8.row, H8.col),
        mk('rook', 'player1', 1, 0), // a7 = 7 段目
        mk('rook', 'player1', 0, 1), // b8 = 8 段目（王手）
        mk('king', 'player1', A1.row, A1.col),
      ],
      'player2',
    );
    expect(isCheckmate(chess, pos)).toBe(true);
    expect(isStalemate(chess, pos)).toBe(false);
  });

  it('欄を持たないルールでは判定しない（同じ局面でも成立しない）', () => {
    const noField = withoutStalemate(chess);
    expect(noField.victory?.stalemate).toBeUndefined();
    expect(isStalemate(noField, stalematePosition())).toBe(false);
  });

  it('本将棋・はさみ将棋は欄を持たない（従来どおり手詰まりで終局しない）', () => {
    expect(hondou.victory?.stalemate).toBeUndefined();
    expect(hasami.victory?.stalemate).toBeUndefined();
  });

  it('チェスの定義はステイルメイトを引き分け・自動と書いている', () => {
    expect(chess.victory?.stalemate).toMatchObject({ result: 'draw', trigger: 'auto' });
  });
});

describe('9-4d ステイルメイト（ストア経由で終局する）', () => {
  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess });
  });

  /** 先手 Qg5 → g6 で後手を動けなくする局面を用意する。 */
  function setUpBeforeStalemate() {
    useGameStore.setState({
      position: posWith(
        [
          mk('king', 'player2', H8.row, H8.col),
          mk('queen', 'player1', G5.row, G5.col),
          mk('king', 'player1', A1.row, A1.col),
        ],
        'player1',
      ),
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
    });
  }

  it('クイーンが g6 へ動いた瞬間に引き分けで終わる（勝った側は居ない）', () => {
    setUpBeforeStalemate();
    const st = useGameStore.getState();
    st.selectSquare(G5);
    expect(st.tryMove(G6)).toBe(true);

    const s = useGameStore.getState();
    expect(s.status).toBe('stalemate');
    expect(winnerOf(s.status, s.position.sideToMove)).toBeNull();
  });

  it('`result:"loss"` と書いたルールでは、手番が回ってきた側の負けになる', () => {
    const loseRule = JSON.parse(JSON.stringify(chess)) as Mgf;
    loseRule.victory!.stalemate = { result: 'loss', trigger: 'auto' };
    useGameStore.getState().reset({ gameType: 'custom', customMgf: loseRule });
    setUpBeforeStalemate();

    const st = useGameStore.getState();
    st.selectSquare(G5);
    expect(st.tryMove(G6)).toBe(true);

    const s = useGameStore.getState();
    expect(s.status).toBe('stalemate_loss_p2');
    expect(winnerOf(s.status, s.position.sideToMove)).toBe('player1');
  });

  it('欄を持たないルールでは、動けなくなっても対局中のまま（従来の振る舞い）', () => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: withoutStalemate(chess) });
    setUpBeforeStalemate();

    const st = useGameStore.getState();
    st.selectSquare(G5);
    expect(st.tryMove(G6)).toBe(true);
    expect(useGameStore.getState().status).toBe('playing');
  });
});

describe('9-4d ステイルメイト（終局の言葉）', () => {
  it('棋譜の終局表示が対局画面と同じ言葉で出る', () => {
    expect(endingLabel({ status: 'stalemate', winner: null }, 'ja')).toBe(
      'ステイルメイト・引分',
    );
    expect(endingLabel({ status: 'stalemate_loss_p1', winner: 'player2' }, 'ja')).toBe(
      '手詰まり・後手の勝ち',
    );
  });
});
