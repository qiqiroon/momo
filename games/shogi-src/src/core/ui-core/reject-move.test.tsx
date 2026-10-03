/**
 * ★v2.02 安全策 (決定記録 7・画面機能 S06・見本 momo_shogi_reject_reason_mock_v1)。
 *
 * **自分で指した手**が、指した結果「量子異常」(どの正体でもつじつまが合わない) になるなら
 * 受け付けない＝盤は指す前のまま・駒は選んだまま・理由を画面の下に 4 秒出す。
 * **届いた手 (相手・AI) は受け付ける** (今までどおり量子異常の投票へ)。
 *
 * 打ち歩詰めの広がり (v2.02) で一番よく起こる形はもう光らないので、自然な局面では作りにくい。
 * そこで「1 手進める部品が量子異常を返す」ように差し替えて流れを確かめる。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useGameStore } from '../store/game-store';
import { useRouteStore } from '../store/route-store';
import { useI18nStore } from '../store/i18n-store';
import { useAiStore } from '../store/ai-store';
import { hondou } from '../engine/mgf/loader';
import { generateLegalMoves, dropRejectReasons } from '../engine';
import type { BoardMove, PieceInstance, Position } from '../engine/position/types';
import { wireMoveOf } from '../protocol/wire-move';

const fake = vi.hoisted(() => ({ anomaly: false }));
vi.mock('../engine/position/advance', async (orig) => {
  const real = await orig<typeof import('../engine/position/advance')>();
  return {
    ...real,
    advancePosition: (...args: Parameters<typeof real.advancePosition>) => {
      const r = real.advancePosition(...args);
      return fake.anomaly ? { ...r, anomaly: 'empty_candidates' as const } : r;
    },
  };
});

beforeEach(() => {
  fake.anomaly = false;
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
  useAiStore.setState({ enabled: false, aiSide: 'player2', thinking: false });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: true, torusMode: 'none', handicap: null });
});
afterEach(() => {
  fake.anomaly = false;
});

function firstMove(): BoardMove {
  const s = useGameStore.getState();
  return generateLegalMoves(s.mgf, s.position).find((m) => m.type === 'move' && !m.promote) as BoardMove;
}

describe('受け付けなかった自分の手', () => {
  it('光っているマスへ指しても、量子異常になるなら盤に載せず、駒は選んだまま・投票は出ない', () => {
    const before = useGameStore.getState().position;
    const m = firstMove();
    fake.anomaly = true;
    act(() => {
      useGameStore.getState().selectSquare(m.from);
      useGameStore.getState().tryMove(m.to);
    });
    const s = useGameStore.getState();
    expect(s.position).toBe(before);
    expect(s.moveHistory).toHaveLength(0);
    expect(s.anomaly).toBeNull();
    expect(s.selectedSquare).toEqual(m.from);
    expect(s.rejectNotice).toEqual({ seq: 1, reasons: null });
  });

  it('届いた手 (相手・AI) は受け付ける＝今までどおり量子異常の投票へ', () => {
    const m = firstMove();
    fake.anomaly = true;
    act(() => {
      useGameStore.getState().applyRemoteMove(wireMoveOf(m));
    });
    const s = useGameStore.getState();
    expect(s.moveHistory).toHaveLength(1);
    expect(s.anomaly).not.toBeNull();
    expect(s.rejectNotice).toBeNull();
  });

  it('画面の下に一般的な言い方で出て、4 秒で消える', async () => {
    vi.useFakeTimers();
    try {
      const { App } = await import('../../App');
      render(<App variant="b" />);
      const m = firstMove();
      fake.anomaly = true;
      act(() => {
        useGameStore.getState().selectSquare(m.from);
        useGameStore.getState().tryMove(m.to);
      });
      expect(screen.getByText('この手は指せません：駒の正体のつじつまが合わなくなります')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(3900);
      });
      expect(screen.queryByText(/この手は指せません/)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText(/この手は指せません/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 30_000); // アプリ全体を描くので重い (全部をいっせいに走らせると 5 秒を超えうる)

  it('候補ごとに理由が分かるときは「歩なら二歩・桂なら行き所のない駒になります」', async () => {
    const { App } = await import('../../App');
    render(<App variant="b" />);
    act(() => {
      useGameStore.setState({
        rejectNotice: { seq: 7, reasons: [{ kind: 'fu', reason: 'nifu' }, { kind: 'kei', reason: 'dead_zone' }] },
      });
    });
    expect(screen.getByText('この手は指せません：歩なら二歩・桂なら行き所のない駒になります')).toBeTruthy();
  }, 30_000);
});

describe('打てない理由を駒種ごとに求める (打てるかの判定と同じ数え方)', () => {
  function pc(id: string, kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
    return { pieceId: id, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
  }
  it('先手の歩がある筋の 2 段目へ「歩・桂」を打つ＝歩は二歩・桂は行き所のない駒', () => {
    const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
    board[0][0] = pc('k', 'ou', 'player2', 0, 0);
    board[8][8] = pc('K', 'ou', 'player1', 8, 8);
    board[6][4] = pc('P', 'fu', 'player1', 6, 4);
    const pos: Position = { width: 9, height: 9, board, hands: { player1: [pc('H', 'fu', 'player1', -1, -1)], player2: [] }, sideToMove: 'player1', moveNumber: 1, history: [] };
    // 本将棋の持ち駒は候補を持たないので「歩」1 つだけで確かめる (二歩が理由)。
    expect(dropRejectReasons(hondou, pos, { row: 1, col: 4 }, 'H')).toEqual([{ kind: 'fu', reason: 'nifu' }]);
    // 最奥の段は行き所が無い (二歩より先に二歩を見るので、二歩の無い筋で確かめる)
    expect(dropRejectReasons(hondou, pos, { row: 0, col: 3 }, 'H')).toEqual([{ kind: 'fu', reason: 'dead_zone' }]);
    expect(dropRejectReasons(hondou, pos, { row: 4, col: 3 }, 'H')).toEqual([{ kind: 'fu', reason: null }]);
  });
});
