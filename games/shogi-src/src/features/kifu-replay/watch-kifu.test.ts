import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { buildKifuFile } from './build';
import { kifuFileName } from './filename';
import type { KifuFile } from './types';

/**
 * ★v1.60 段3 の続き: **観戦した対局も、見ていた人の端末に棋譜として残る**
 * （親 v1.60 §6.8.6・ファイル名は §9.2.2）。
 *
 * ## 直した形
 *
 * v1.59 までは観戦者の端末でも「ネット対戦」として記録され、**自分が先手・相手は空欄**
 * になっていた（**観戦者に席が無い**ので、既定の先手に落ちていた）。**指してもいない人が
 * 対局者として残る**のは、§6.8.6 の他の項（観戦者を席のある片方として扱わない）と食い違う。
 *
 * ## ここで固定すること
 *
 * - **記録に入るのは二人の対局者の名前**（自分の名前を書かない）
 * - **「自分の側」は持たせない**＝勝敗の見方は先手から（`F2F` と同じ決まり）
 * - **ファイル名は観戦と分かる形**＋**名前欄は勝者**、**引分・中断では欄ごと省く**
 */

function registerConnector(over: {
  spectating: boolean;
  seatNames?: { player1: string; player2: string } | null;
  myName?: string;
  oppName?: string;
  mySide?: 'player1' | 'player2' | null;
}) {
  register('gameConnector', {
    isOnline: () => true,
    isSpectating: () => over.spectating,
    getSeatNames: () => over.seatNames ?? null,
    getMyName: () => over.myName ?? '',
    getOpponentName: () => over.oppName ?? '',
    getMySide: () => over.mySide ?? null,
    subscribe: () => () => {},
  } as unknown as OnlineGameConnector);
}

beforeEach(() => {
  useAiStore.setState({ enabled: false });
  useGameStore.getState().reset({ gameType: 'shogi' });
});

afterEach(() => {
  register('gameConnector', undefined as never);
});

/** 終局を作る（投了で先手が負け＝後手の勝ち）。 */
function endWithGoteWin(): void {
  useGameStore.getState().resign('player1');
}

describe('v1.60: 観戦した対局の記録（親 §6.8.6）', () => {
  it('★対局者の名前が二人とも入り、自分（観戦者）の名前は入らない', () => {
    registerConnector({
      spectating: true,
      seatNames: { player1: '太郎', player2: '花子' },
      myName: '見物人',
    });
    endWithGoteWin();
    const f = buildKifuFile(new Date('2026-08-22T01:30:00+09:00'));
    expect(f.meta.opponent).toBe('watch');
    expect(f.meta.players.player1.name).toBe('太郎');
    expect(f.meta.players.player2.name).toBe('花子');
  });

  it('★「自分の側」は持たせない（観戦者に席が無い＝勝敗は先手から見る）', () => {
    registerConnector({
      spectating: true,
      seatNames: { player1: '太郎', player2: '花子' },
      myName: '見物人',
    });
    endWithGoteWin();
    const f = buildKifuFile(new Date('2026-08-22T01:30:00+09:00'));
    expect(f.meta.viewerSide).toBeNull();
    // 後手が勝った＝先手から見れば負け（`F2F` と同じ決まり）。
    expect(kifuFileName(f).split('_')[4]).toBe('L');
  });

  it('★ファイル名は観戦と分かる形＋名前欄は勝者（親 §9.2.2）', () => {
    registerConnector({
      spectating: true,
      seatNames: { player1: '太郎', player2: '花子' },
      myName: '見物人',
    });
    endWithGoteWin();
    const f = buildKifuFile(new Date('2026-08-22T01:30:00+09:00'));
    expect(kifuFileName(f)).toBe('260822_0130_WATCH_HON_L_花子.json');
  });

  it('★引分・中断では勝者が居ないので名前の欄ごと省く（居ない人の名前を書かない）', () => {
    registerConnector({
      spectating: true,
      seatNames: { player1: '太郎', player2: '花子' },
      myName: '見物人',
    });
    endWithGoteWin();
    const base = buildKifuFile(new Date('2026-08-22T01:30:00+09:00'));
    const draw: KifuFile = {
      ...base,
      meta: { ...base.meta, result: { status: 'repetition', winner: null } },
    };
    expect(kifuFileName(draw)).toBe('260822_0130_WATCH_HON_D.json');
    const abort: KifuFile = {
      ...base,
      meta: { ...base.meta, result: { status: 'nogame', winner: null } },
    };
    expect(kifuFileName(abort)).toBe('260822_0130_WATCH_HON_X.json');
  });

  it('対局者の記録は今までどおり（縮退互換）＝自分の名前が自分の側に入る', () => {
    registerConnector({
      spectating: false,
      myName: 'わたし',
      oppName: '山田太郎',
      mySide: 'player1',
    });
    endWithGoteWin();
    const f = buildKifuFile(new Date('2026-08-22T01:30:00+09:00'));
    expect(f.meta.opponent).toBe('net');
    expect(f.meta.players.player1.name).toBe('わたし');
    expect(f.meta.players.player2.name).toBe('山田太郎');
    expect(f.meta.viewerSide).toBe('player1');
    expect(kifuFileName(f)).toBe('260822_0130_NET_HON_L_山田.json');
  });
});
