import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './game-store';

/**
 * チェスを「実際のストア経由」で指せることの動作確認 (第 9 段 9-4b)。
 *
 * エンジン単体の検査 (moves/pawn-special.test・mgf/chess.test) とは別に、**アプリが
 * 使うのと同じ道**——ルール種別 chess で対局を作り、マスを選んで指す (selectSquare →
 * tryMove)——を通して、初手 2 マスとアンパッサンが**選べて・適用され・棋譜に載る**ことを
 * 固定する。アンパッサンは並び (extra_steps) を持つ手なので、ストアが手を丸ごと運んで
 * いるか (§6.3.6 の「中身に触れず丸ごと運ぶ」) がここで効く。
 */
describe('9-4b チェスをストア経由で指す (初手 2 マス・アンパッサン)', () => {
  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'chess' });
  });

  it('チェスの対局が 8×8 で始まり、盤・持ち駒がチェスの初期配置', () => {
    const pos = useGameStore.getState().position;
    expect(pos.width).toBe(8);
    expect(pos.height).toBe(8);
    expect(pos.sideToMove).toBe('player1');
    expect(pos.board[6][4]).toMatchObject({ kind: 'pawn', owner: 'player1' }); // e2
    expect(pos.board[1][3]).toMatchObject({ kind: 'pawn', owner: 'player2' }); // d7
    expect(pos.hands.player1).toHaveLength(0);
  });

  it('ポーンを初手 2 マス動かせる (e2-e4)・棋譜に長い記法で載る', () => {
    const st = useGameStore.getState();
    st.selectSquare({ row: 6, col: 4 }); // e2
    const ok = st.tryMove({ row: 4, col: 4 }); // e4 (2 マス)
    expect(ok).toBe(true);
    const s = useGameStore.getState();
    expect(s.position.board[6][4]).toBeNull();
    expect(s.position.board[4][4]).toMatchObject({ kind: 'pawn', owner: 'player1' });
    expect(s.position.sideToMove).toBe('player2');
    expect(s.moveHistory[0]).toBe('e2-e4');
  });

  it('一連の手でアンパッサンが成立する (e5 のポーンが d6 へ進み、d5 の相手ポーンを取り除く)', () => {
    const st = useGameStore.getState();
    // 1. 白 e2-e4 (初手 2 マス)
    st.selectSquare({ row: 6, col: 4 });
    expect(st.tryMove({ row: 4, col: 4 })).toBe(true);
    // 2. 黒 a7-a6 (手待ち・1 マス)
    st.selectSquare({ row: 1, col: 0 });
    expect(st.tryMove({ row: 2, col: 0 })).toBe(true);
    // 3. 白 e4-e5 (1 マス) — 白ポーンが 5 段目 (row3) に立つ
    st.selectSquare({ row: 4, col: 4 });
    expect(st.tryMove({ row: 3, col: 4 })).toBe(true);
    // 4. 黒 d7-d5 (初手 2 マス) — 白 e5 の横を通り過ぎる。通り過ぎたマスは d6(row2col3)
    st.selectSquare({ row: 1, col: 3 });
    expect(st.tryMove({ row: 3, col: 3 })).toBe(true);
    // 5. 白 アンパッサン e5-d6 — 通り過ぎたマス d6 へ斜めに進み、d5 の黒ポーンを取り除く
    st.selectSquare({ row: 3, col: 4 });
    expect(st.tryMove({ row: 2, col: 3 })).toBe(true);

    const s = useGameStore.getState();
    expect(s.position.board[2][3]).toMatchObject({ kind: 'pawn', owner: 'player1' }); // 白ポーンが d6 に立つ
    expect(s.position.board[3][3]).toBeNull(); // 取られた黒ポーン (d5) が盤から消えた
    expect(s.position.board[3][4]).toBeNull(); // 白ポーンは e5 を離れた
    expect(s.position.hands.player1).toHaveLength(0); // チェスは取った駒を駒台に溜めない
    expect(s.moveHistory[4]).toBe('e5-d6'); // アンパッサンも長い記法
    expect(s.position.sideToMove).toBe('player2');
  });
});
