import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomScreen } from './RoomScreen';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore, type RuleSyncPhase } from '../store';

/**
 * Phase 5-12: S06 対局準備画面のルール同期表示。
 *
 * v0.67 A5 で置いた見せかけ (常に 3 段とも「完了」) を本物の状態に差し替えた箇所。
 * 実機で確かめるには 2 台そろえて部屋に入る必要があり、確認環境では再現できないので
 * 描画そのものをここで固定する。
 */
function setup(phase: RuleSyncPhase, opponentName = 'あいて') {
  useMatchmakingStore.setState({
    isHost: true,
    playerName: 'ぼく',
    opponentName,
    currentRoomId: 'r1',
    currentRoomName: '[本] テスト',
    activeRoomConfig: { ...DEFAULT_ROOM_CONFIG },
    ruleSyncPhase: phase,
    ruleSyncReason: phase === 'failed' ? 'engine_not_quantum_capable' : null,
    mySideChoice: 'sente',
    oppSideChoice: 'gote',
    myReady: false,
    oppReady: false,
  });
}

/** ルール同期カードの 3 行ぶんの状態表示を上から順に取り出す。 */
function syncStates(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.sync-step .ss-state')).map(
    (el) => el.textContent ?? '',
  );
}

describe('S06 ルール同期の進捗表示 (Phase 5-12)', () => {
  beforeEach(() => {
    useMatchmakingStore.setState({ ruleSyncPhase: 'idle', ruleSyncReason: null });
  });

  it('相手が入る前は 3 段とも待機 (見せかけの「完了」を出さない)', () => {
    setup('idle', '');
    const { container } = render(<RoomScreen />);
    expect(syncStates(container)).toEqual(['待機', '待機', '待機']);
  });

  it('送信後・受領確認待ちは 3 段目だけが同期中', () => {
    setup('sent');
    const { container } = render(<RoomScreen />);
    expect(syncStates(container)).toEqual(['完了', '完了', '同期中…']);
  });

  it('揃えば 3 段とも完了', () => {
    setup('ok');
    const { container } = render(<RoomScreen />);
    expect(syncStates(container)).toEqual(['完了', '完了', '完了']);
  });

  it('揃わなければ 3 段目が非対応になり警告帯が出る', () => {
    setup('failed');
    const { container } = render(<RoomScreen />);
    expect(syncStates(container)).toEqual(['完了', '完了', '非対応']);
    expect(container.querySelector('.sync-step.fail')).toBeTruthy();
    expect(screen.getByText(/対局を開始できません/)).toBeTruthy();
  });

  it('揃わない間は準備完了を押せない', () => {
    // 先後は合意済み (先手/後手) なので、止めているのはルール同期だけ。
    setup('failed');
    render(<RoomScreen />);
    const btn = screen.getByRole('button', { name: /準備完了|準備OK/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('受領確認が来ない相手でも準備完了は押せる (旧クライアント対策)', () => {
    // 「まだ返事が無い」で止めると、確認を返さない相手とは永久に始められなくなる。
    setup('sent');
    render(<RoomScreen />);
    const btn = screen.getByRole('button', { name: /準備完了|準備OK/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

/**
 * v1.33: 駒落ちの部屋では先後が手合いから決まる (親 v1.28 §3.12.1)。
 *
 * ユーザー判断 (2026-08-14)＝**先後の画面は消さず、決まった側が選ばれた状態のまま固定**。
 * 席は部屋を作った側から見た向きで届くので、ゲスト側は反転して読む。
 */
describe('S06 駒落ちのときの先後', () => {
  const setupHandicap = (isHost: boolean, giver: 'self' | 'opponent') => {
    useMatchmakingStore.setState({
      isHost,
      playerName: 'ぼく',
      opponentName: 'あいて',
      currentRoomId: 'r1',
      currentRoomName: '[本] テスト',
      activeRoomConfig: { ...DEFAULT_ROOM_CONFIG, handicap: { typeId: 'ni', giver } },
      ruleSyncPhase: 'ok',
      ruleSyncReason: null,
      mySideChoice: null,
      oppSideChoice: null,
      myReady: false,
      oppReady: false,
    });
  };
  /** 先後の 3 カードだけを見る (画面には他にも「先手」という語が出るため)。 */
  const cards = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.side-pick .side-card')) as HTMLButtonElement[];

  it('部屋を作った側が落とすなら、その人が先手で固定される', () => {
    setupHandicap(true, 'self');
    const { container } = render(<RoomScreen />);
    expect(useMatchmakingStore.getState().mySideChoice).toBe('sente');
    const [sente, gote, random] = cards(container);
    expect(sente.disabled).toBe(false);
    expect(gote.disabled).toBe(true);
    expect(random.disabled).toBe(true);
    expect(screen.getByText(/駒を落とした側が先手/)).toBeTruthy();
  });

  it('入った側から見ると向きが反転する (相手が落とす＝自分は後手)', () => {
    setupHandicap(false, 'self');
    const { container } = render(<RoomScreen />);
    expect(useMatchmakingStore.getState().mySideChoice).toBe('gote');
    const [sente, gote] = cards(container);
    expect(sente.disabled).toBe(true);
    expect(gote.disabled).toBe(false);
  });

  it('平手なら従来どおり自分で選べる', () => {
    setupHandicap(true, 'self');
    useMatchmakingStore.setState({
      activeRoomConfig: { ...DEFAULT_ROOM_CONFIG },
      mySideChoice: null,
    });
    const { container } = render(<RoomScreen />);
    expect(cards(container).every((c) => !c.disabled)).toBe(true);
  });
});
