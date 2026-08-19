import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { generateLegalMoves } from '../../../core/engine';
import '../../kifu-replay/index';
import { loadLastKifu } from '../../kifu-replay/storage';
import { reviewTarget } from '../../kifu-replay/review';
import { useReviewShareStore } from '../../kifu-replay/review-share';
import { useMatchmakingStore } from '../store';
import { encodeRoomName } from '../roomNameCodec';
import { ReviewLobbyScreen } from './ReviewLobbyScreen';
import { LobbyScreen } from './LobbyScreen';

/**
 * S12 感想戦ロビー（★v1.54／★v1.55・親 v1.49 §9.4.1／§9.4.4・画面機能 v0.43 §3 S12）。
 *
 * ★**v1.55 で骨格を S04 とまったく同じ 4 つの箱にした**（接続／部屋に入る／部屋を作る／
 * ひとりで始める）。**部屋を作るパネルは廃止**し、中身を箱へ直接置いている。
 * **パスワードと非公開も S04 と同じ扱いで効く**。
 *
 * ここで固定するのは 3 つ。
 *   - **ひとりで始めるは部屋を作らない**（誰も居ない部屋を一覧に並べないため）
 *   - **部屋を作ったら相手を待たずに始まる**（待機画面 S05 を通らない）
 *   - **一覧に出るのは感想戦の部屋だけ／ネット対戦の一覧からは入れない**（部屋の切り分け）
 *
 * ★**下ごしらえで前の状態を消さない**＝記憶している 1 局を残したまま始める。
 * 第46・第47 と 2 回続けて、**検査の下ごしらえが本番に無い工程を肩代わり**していて
 * 緑のまま穴が残った。ここでは終局まで指した棋譜を持ったまま画面を開く。
 */

let created = 0;
let joined: string | null = null;
let lastCreate: { password?: string; isPublic?: boolean } | null = null;

const fakeApi = {
  init: (o: { onWsOpen?: () => void }) => {
    o.onWsOpen?.();
  },
  createRoom: (o: { password?: string; isPublic?: boolean }) => {
    created += 1;
    lastCreate = o;
  },
  joinRoom: (roomId: string) => {
    joined = roomId;
  },
  send: () => {},
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: false, connected: true, currentRoomId: null, currentRoomName: '' }),
  changeGameType: () => {},
};

/** 終局まで進めて、記憶に 1 局を置く（**空にして始めない**）。 */
function finishedGame(moves = 6): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  for (let i = 0; i < moves; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') break;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) break;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) break;
  }
  useGameStore.getState().resign('player2');
}

function roomRow(id: string, name: string, hostName = '花子', opts?: { isPublic?: boolean; hasPassword?: boolean }) {
  return {
    id,
    name,
    hostName,
    isPublic: opts?.isPublic ?? true,
    hasPassword: opts?.hasPassword ?? false,
    guestConnected: false,
  };
}

/** 箱 ④ の「ひとりで始める」ボタン（同じ言葉が箱の見出しにも出る）。 */
function soloButton(): HTMLElement {
  const b = screen.getAllByRole('button').find((x) => x.textContent === 'ひとりで始める');
  if (!b) throw new Error('「ひとりで始める」が見つからない');
  return b;
}

beforeEach(() => {
  created = 0;
  joined = null;
  lastCreate = null;
  (window as unknown as { MomoMatchmaking: typeof fakeApi }).MomoMatchmaking = fakeApi;
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'review-lobby' });
  useReviewShareStore.setState({ role: null, ownsRoom: false, ready: true, incoming: null });
  useMatchmakingStore.setState({ connection: 'connected', playerName: '太郎', currentRoomId: null, rooms: [] });
  finishedGame(6);
});

afterEach(() => {
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('S12 感想戦ロビー（v1.54）', () => {
  it('★「ひとりで始める」は部屋を作らずに感想戦へ入る', () => {
    const view = render(<ReviewLobbyScreen />);

    fireEvent.click(soloButton());

    expect(useRouteStore.getState().screen).toBe('review');
    // **部屋を作らない**＝人を呼ばない振り返りで一覧に部屋を並べない。
    expect(created).toBe(0);
    expect(useReviewShareStore.getState().ownsRoom).toBe(false);
    // 記憶している 1 局がそのまま振り返る対象になる（読み込ませない）。
    expect(reviewTarget()?.meta.savedAt).toBe(loadLastKifu()?.meta.savedAt);
    view.unmount();
  });

  it('★「部屋を作る」は画面の上で決めて建て、相手を待たずに感想戦へ入る（v1.55）', () => {
    const view = render(<ReviewLobbyScreen />);

    // ★v1.55: **パネルを開かずに、部屋名の欄が最初から画面に出ている**
    // （v1.54 は「部屋を作る」を押すとパネルが出る形だった＝S04 と揃わない）。
    const roomInput = view.container.querySelector(
      'input[name="shogi-review-room-label"]',
    ) as HTMLInputElement;
    expect(roomInput).toBeTruthy();
    // **既定を入れて出す**＝そのまま押せる（決めさせるために止めない）。
    expect(roomInput.value).toContain('感想戦');

    fireEvent.click(screen.getByText('部屋を作成'));

    expect(created).toBe(1);
    // **S05 待機画面は通らない**＝先後も持ち時間も無く、揃えるものが無い。
    expect(useRouteStore.getState().screen).toBe('review');
    expect(useReviewShareStore.getState().ownsRoom).toBe(true);
    view.unmount();
  });

  it('★v1.55: 感想戦の部屋にもパスワードと非公開が効く（S04 と同じ扱い）', () => {
    const view = render(<ReviewLobbyScreen />);

    const pw = view.container.querySelector(
      'input[name="shogi-review-room-key"]',
    ) as HTMLInputElement;
    expect(pw).toBeTruthy();
    fireEvent.change(pw, { target: { value: 'aikotoba' } });
    fireEvent.click(view.container.querySelector('.check-private input') as Element);

    fireEvent.click(screen.getByText('部屋を作成'));

    // **通信の口へそのまま渡る**＝感想戦の部屋だけ扱いを変えない。
    expect(lastCreate?.password).toBe('aikotoba');
    expect(lastCreate?.isPublic).toBe(false);
    view.unmount();
  });

  it('★v1.55: 非公開の部屋は「表示」を入れるまで一覧に出さない（S04 と同じ）', () => {
    useMatchmakingStore.setState({
      rooms: [
        roomRow(
          'r3',
          encodeRoomName({ gameType: 'shogi', torus: false, quantum: false, review: true, userRoomName: 'ないしょの振り返り' }),
          '花子',
          { isPublic: false, hasPassword: true },
        ),
      ],
    });
    const view = render(<ReviewLobbyScreen />);

    expect(screen.queryByText('ないしょの振り返り')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('表示'));
    expect(screen.getByText('ないしょの振り返り')).toBeInTheDocument();
    view.unmount();
  });

  it('★一覧に出るのは感想戦の部屋だけ（対局の部屋は出さない）', () => {
    useMatchmakingStore.setState({
      rooms: [
        roomRow('r1', encodeRoomName({ gameType: 'shogi', torus: false, quantum: false, userRoomName: '対局の部屋' })),
        roomRow('r2', encodeRoomName({ gameType: 'shogi', torus: false, quantum: false, review: true, userRoomName: '花子の振り返り' })),
      ],
    });
    const view = render(<ReviewLobbyScreen />);

    expect(screen.getByText('花子の振り返り')).toBeInTheDocument();
    expect(screen.queryByText('対局の部屋')).not.toBeInTheDocument();
    view.unmount();
  });

  it('一覧から入ると、待機画面を通らずにその部屋へ入る', () => {
    useMatchmakingStore.setState({
      rooms: [
        roomRow('r2', encodeRoomName({ gameType: 'shogi', torus: false, quantum: false, review: true, userRoomName: '花子の振り返り' })),
      ],
    });
    const view = render(<ReviewLobbyScreen />);

    fireEvent.click(screen.getByText('入室'));

    expect(joined).toBe('r2');
    expect(useRouteStore.getState().screen).not.toBe('room');
    view.unmount();
  });

  it('つながっていなくても「ひとりで始める」は押せる（何もできない画面にしない）', () => {
    useMatchmakingStore.setState({ connection: 'connecting' });
    const view = render(<ReviewLobbyScreen />);

    const make = screen.getAllByRole('button').find((b) => b.textContent === '部屋を作成');
    expect(make).toBeDisabled();
    // **灰色は「押せない」だけを意味する**ので、理由は言葉で出す。
    expect(screen.getByText('サーバーにつながっていません')).toBeInTheDocument();

    fireEvent.click(soloButton());
    expect(useRouteStore.getState().screen).toBe('review');
    view.unmount();
  });
});

describe('S04 ネット対戦の一覧（v1.54 の部屋の切り分け）', () => {
  it('★感想戦の部屋は見えるが、ここからは入れない（理由を言葉で出す）', () => {
    useRouteStore.setState({ screen: 'net-lobby' });
    useMatchmakingStore.setState({
      rooms: [
        roomRow('r2', encodeRoomName({ gameType: 'shogi', torus: false, quantum: false, review: true, userRoomName: '花子の振り返り' })),
      ],
    });
    const view = render(<LobbyScreen />);

    // **見えること自体は残す**＝隠すと「在るのに見えない」で分かりにくい。
    expect(screen.getByText('花子の振り返り')).toBeInTheDocument();
    const enter = screen.getAllByRole('button').find((b) => b.textContent === '入室');
    expect(enter).toBeDisabled();
    expect(
      screen.getByText('感想戦の部屋です。モード選択の「感想戦」から入れます'),
    ).toBeInTheDocument();
    view.unmount();
  });
});
