import { describe, it, expect } from 'vitest';
import { useGameStore } from './game-store';
import { loadMgf } from '../engine/mgf/loader';
import chessRaw from '../engine/mgf/chess.json';

/**
 * 段A: 読み込んだカスタムルール (MGF) で対局が作れることの検査 (親 v1.65 §5.5)。
 *
 * 焼き込みの「チェス」ではなく、**データとして渡した MGF** (gameType='custom' + customMgf)
 * から 8×8 のチェスが始まり、9-4b の手 (初手 2 マス) が指せることを固定する。
 * ＝読み込み画面が最後にやること (reset へ MGF を渡す) と同じ道。
 */
describe('段A カスタムルールをデータとして渡して対局を作る', () => {
  it('gameType=custom + customMgf で 8×8 のチェスが始まる', () => {
    const mgf = loadMgf(chessRaw);
    useGameStore.getState().reset({ gameType: 'custom', customMgf: mgf });
    const pos = useGameStore.getState().position;
    expect(pos.width).toBe(8);
    expect(pos.height).toBe(8);
    expect(pos.board[6][4]).toMatchObject({ kind: 'pawn', owner: 'player1' });
    expect(useGameStore.getState().currentGameType).toBe('custom');
  });

  it('渡した MGF で初手 2 マスが指せる (9-4b がカスタム経由でも効く)', () => {
    const mgf = loadMgf(chessRaw);
    const st = useGameStore.getState();
    st.reset({ gameType: 'custom', customMgf: mgf });
    st.selectSquare({ row: 6, col: 4 });
    expect(st.tryMove({ row: 4, col: 4 })).toBe(true);
    expect(useGameStore.getState().position.board[4][4]).toMatchObject({ kind: 'pawn', owner: 'player1' });
    expect(useGameStore.getState().moveHistory[0]).toBe('e2-e4');
  });

  it('「リセット」で customMgf を省いても、保持中の定義で指し直せる', () => {
    const mgf = loadMgf(chessRaw);
    const st = useGameStore.getState();
    st.reset({ gameType: 'custom', customMgf: mgf });
    // customMgf を渡さない reset (対局中の「リセット」相当) でも custom のまま
    st.reset({ gameType: 'custom' });
    const pos = useGameStore.getState().position;
    expect(pos.width).toBe(8);
    expect(pos.board[7][4]).toMatchObject({ kind: 'king', owner: 'player1' });
  });

  it('本将棋は無回帰 (gameType 未指定・custom を持ち越さない)', () => {
    const st = useGameStore.getState();
    st.reset({ gameType: 'shogi' });
    expect(useGameStore.getState().position.width).toBe(9);
    expect(useGameStore.getState().currentGameType).toBe('shogi');
  });
});
