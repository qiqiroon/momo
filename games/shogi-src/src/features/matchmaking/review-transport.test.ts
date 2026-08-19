import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get as pluginGet, register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage } from '../../core/plugin/review';
import './index';
import { useMatchmakingStore } from './store';
import { handleShogiMessage } from './messageDispatcher';

/**
 * ★v1.56: **感想戦の伝言は、通信の口で中身を落とさない**（親 §6.3.6）。
 *
 * v1.55 までは伝言の種類ごとに**項目を 1 つずつ書き写して**いた（送る側・受け取る側・
 * 型の 3 か所）。**書き写す欄に無いものは黙って捨てられる**ので、v1.55 で足した
 * **ハイライト**と、**部屋を移るための合言葉**がどちらも相手に届いていなかった
 * （2026-08-19 実機のご報告＝「ハイライトが自分には出るが相手に届かない」／
 * 「ゲストが『棋譜を受け取っています』のまま止まる」）。
 *
 * **この検査は、伝言を増やしたときに通信側で落ちないことを見張る**ものである。
 * **数え上げる形に戻したら赤くなる**ように、**種類ごとの項目ではなく「往復して同じ
 * ものが出るか」だけを見る**（新しい種類を足しても、この検査は直さなくてよい）。
 */

let wire: unknown[] = [];

const fakeApi = {
  init: () => {},
  createRoom: () => {},
  joinRoom: () => {},
  send: (d: unknown) => {
    wire.push(d);
  },
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: true, connected: true, currentRoomId: 'r1', currentRoomName: '' }),
  changeGameType: () => {},
};

/** 送って、線に乗ったものをそのまま受け取り側へ流し込み、届いた伝言を返す。 */
function roundTrip(msg: ReviewMessage): ReviewMessage | null {
  wire = [];
  const c = pluginGet<OnlineGameConnector>('gameConnector');
  if (!c) throw new Error('gameConnector が無い');
  c.sendReview(msg);
  expect(wire).toHaveLength(1);

  let got: ReviewMessage | null = null;
  const saved = pluginGet<(m: ReviewMessage) => void>('review:message');
  register('review:message', (m: ReviewMessage) => {
    got = m;
  });
  handleShogiMessage(wire[0]);
  if (saved) register('review:message', saved);
  return got;
}

beforeEach(() => {
  wire = [];
  (window as unknown as { MomoMatchmaking: typeof fakeApi }).MomoMatchmaking = fakeApi;
  useMatchmakingStore.setState({ currentRoomId: 'r1', connection: 'game_connected' });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('★v1.56 感想戦の伝言は通信の口で落ちない（親 §6.3.6）', () => {
  it('★ハイライトがそのまま届く（v1.55 では書き写す欄が無く捨てられていた）', () => {
    expect(roundTrip({ kind: 'mark', square: { row: 3, col: 4 } })).toEqual({
      kind: 'mark',
      square: { row: 3, col: 4 },
    });
  });

  it('★打診と諾否に載せた項目も、そのまま届く', () => {
    expect(roundTrip({ kind: 'offer' })).toEqual({ kind: 'offer' });
    expect(roundTrip({ kind: 'reply', accepted: true })).toEqual({ kind: 'reply', accepted: true });
  });

  it('★盤の組み替え（行き先が駒台の手）も、そのまま届く', () => {
    const msg: ReviewMessage = {
      kind: 'move',
      base: { ply: 0, branchLen: 0 },
      ply: 0,
      branch: [
        {
          kind: 'free',
          pieceId: 'P1',
          from: { row: 6, col: 4 },
          dest: { kind: 'hand', owner: 'player2' },
        },
      ],
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('従来の伝言も、これまでどおり届く', () => {
    const msg: ReviewMessage = { kind: 'seek', base: { ply: 2, branchLen: 1 }, ply: 5 };
    expect(roundTrip(msg)).toEqual(msg);
  });
});
