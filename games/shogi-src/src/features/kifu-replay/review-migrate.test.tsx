import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { useI18nStore } from '../../core/store/i18n-store';
import { useRouteStore } from '../../core/store/route-store';
import { generateLegalMoves } from '../../core/engine';
import { get as pluginGet } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage } from '../../core/plugin/review';
import '../matchmaking/index';
import './index';
import { discardKifu, loadLastKifu } from './storage';
import { serializeKifu } from './io';
import { reviewIsOwnGame, reviewMySide, setReviewMySide } from './review';
import { useMatchmakingStore } from '../matchmaking/store';
import { encodeRoomName, decodeRoomName } from '../matchmaking/roomNameCodec';
import {
  answerReviewOffer,
  joinedReviewRoom,
  offerReview,
  receiveReviewMessage,
  reviewGuestArrived,
  useReviewShareStore,
} from './review-share';

/**
 * ★v1.55: **対局の部屋から感想戦の部屋へ移る**（親 v1.49 §9.4.4／§6.3.6）。
 *
 * ここで固定したいのは、**画面を見ただけでは気づけないもの**。
 *   - **対局の部屋をそのまま使わない**＝使い続けると、片方が抜けた瞬間に
 *     **対局のつもりの人が入ってくる**（用途の印は建てた後に変えられない）
 *   - **移る先は必ず非公開＋合言葉**＝二人で始めた話の続きなので、人の入れ方を広げない
 *   - **人は「受ける」を押すだけ**＝合言葉も部屋の一覧も画面に出さない
 *   - **移っている間は「相手が抜けた」と扱わない**（互いに部屋の外に居る時間がある）
 */

let sent: ReviewMessage[] = [];
let created: { name?: string; password?: string; isPublic?: boolean } | null = null;
let joined: { roomId: string; password: string } | null = null;
let left = 0;

function fakeApi(rooms: ReturnType<typeof roomRow>[]) {
  return {
    init: (o: { onWsOpen?: () => void }) => o.onWsOpen?.(),
    createRoom: (o: { name?: string; password?: string; isPublic?: boolean }) => {
      created = o;
    },
    joinRoom: (roomId: string, password: string) => {
      joined = { roomId, password };
    },
    send: () => {},
    leaveRoom: () => {
      left += 1;
    },
    refreshRooms: () => {
      useMatchmakingStore.getState().setRooms(rooms);
    },
    kickGuest: () => {},
    getState: () => ({ isHost: true, connected: true, currentRoomId: 'g1', currentRoomName: '' }),
    changeGameType: () => {},
  };
}

function roomRow(id: string, name: string, opts?: { isPublic?: boolean; hasPassword?: boolean }) {
  return {
    id,
    name,
    hostName: '花子',
    isPublic: opts?.isPublic ?? true,
    hasPassword: opts?.hasPassword ?? false,
    guestConnected: false,
  };
}

/** 対局の相手が居る状態の通信の口を差し替える（ホストかどうか・自分の側を指定できる）。 */
function installConnector(isHost: boolean, side: 'player1' | 'player2' = 'player1'): void {
  const c = pluginGet<OnlineGameConnector>('gameConnector');
  if (!c) throw new Error('gameConnector が無い');
  vi.spyOn(c, 'isOnline').mockReturnValue(true);
  vi.spyOn(c, 'isRoomHost').mockReturnValue(isHost);
  // ★v1.58: **対局の部屋を出ると先後は消える**ので、出た後は答えられない。
  vi.spyOn(c, 'getMySide').mockImplementation(() =>
    useReviewShareStore.getState().migrating ? null : side,
  );
  vi.spyOn(c, 'getOpponentName').mockReturnValue('花子');
  vi.spyOn(c, 'sendReview').mockImplementation((m: ReviewMessage) => {
    sent.push(m);
  });
}

function finishedGame(): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  for (let i = 0; i < 4; i++) {
    const s = useGameStore.getState();
    const legal = generateLegalMoves(s.mgf, s.position);
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) break;
  }
  useGameStore.getState().resign('player2');
}

const GAME_ROOM = encodeRoomName({
  gameType: 'shogi',
  torus: false,
  quantum: false,
  userRoomName: '太郎の部屋',
});

beforeEach(() => {
  sent = [];
  created = null;
  joined = null;
  left = 0;
  discardKifu();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'endgame' });
  useReviewShareStore.setState({
    role: null,
    ownsRoom: false,
    ready: true,
    incoming: null,
    notice: null,
    migrating: false,
    mark: null,
  });
  useMatchmakingStore.setState({
    connection: 'game_connected',
    playerName: '太郎',
    currentRoomId: 'g1',
    currentRoomName: GAME_ROOM,
    isHost: true,
    rooms: [],
  });
  // **毎回ここで既定へ戻す**＝控えは画面より長生きするので、前の検査の控えが残ると
  // 走らせる順で結果が変わる。
  setReviewMySide(null);
  finishedGame();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('★v1.55 対局の部屋から感想戦の部屋へ移る（親 §9.4.4）', () => {
  it('★ホストが申し出ると、打診に合言葉が載る（人には見せない）', () => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi([]);
    installConnector(true);

    offerReview();

    const offer = sent.find((m) => m.kind === 'offer');
    expect(offer).toBeTruthy();
    // **往復を増やさない**＝打診にそのまま載せる（§6.3.6）。
    expect(offer && 'pass' in offer ? offer.pass : undefined).toMatch(/^[0-9a-f]{16}$/);
    // **部屋名は同じ**（人から見て同じ場が続く）＋**感想戦の印が付く**。
    const room = offer && 'room' in offer ? (offer.room as string) : '';
    expect(decodeRoomName(room).review).toBe(true);
    expect(decodeRoomName(room).userRoomName).toBe('太郎の部屋');
  });

  it('★受けてもらえたら、対局の部屋を出て、非公開＋合言葉で感想戦の部屋を建てる', () => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi([]);
    installConnector(true);

    offerReview();
    const offer = sent.find((m) => m.kind === 'offer');
    const pass = offer && 'pass' in offer ? offer.pass : '';
    receiveReviewMessage({ kind: 'reply', accepted: true });

    // **対局の部屋はそのまま使わない**（v1.54 までは使い続けていた）。
    expect(left).toBeGreaterThan(0);
    expect(created).toBeTruthy();
    // **必ず非公開＋合言葉**（親 §9.4.4）＝人の入れ方を勝手に広げない。
    expect(created?.isPublic).toBe(false);
    expect(created?.password).toBe(pass);
    expect(decodeRoomName(created?.name ?? '').review).toBe(true);
    // 移り終えるまでは盤に触れない（画面が「移っています」を出す）。
    expect(useReviewShareStore.getState().migrating).toBe(true);
    // **人がするのは「受ける」を押すことだけ**＝画面は感想戦へ進んでいる。
    expect(useRouteStore.getState().screen).toBe('review');
  });

  it('★ゲスト側は、合言葉の合う部屋を自分で見つけて入る（人には一覧を見せない）', () => {
    const target = encodeRoomName({
      gameType: 'shogi',
      torus: false,
      quantum: false,
      review: true,
      userRoomName: '太郎の部屋',
    });
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi([
      // **名前だけで見分けない**＝紛らわしい公開部屋が並んでいても、
      // 非公開＋合言葉つきの方に入る。
      roomRow('x1', target),
      roomRow('x2', target, { isPublic: false, hasPassword: true }),
    ]);
    installConnector(false);
    useMatchmakingStore.setState({ isHost: false, currentRoomId: 'g1' });

    // ホストからの打診に合言葉が載ってくる。
    receiveReviewMessage({ kind: 'offer', pass: 'aabbccdd11223344', room: target });
    answerReviewOffer(true);

    expect(left).toBeGreaterThan(0);
    expect(joined?.roomId).toBe('x2');
    expect(joined?.password).toBe('aabbccdd11223344');
    // 建てるのはホストだけ＝ゲストは建てない。
    expect(created).toBeNull();
  });

  it('★移っている間は「相手が抜けた」と扱わない（互いに部屋の外に居る時間がある）', () => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi([]);
    installConnector(true);

    offerReview();
    receiveReviewMessage({ kind: 'reply', accepted: true });
    expect(useReviewShareStore.getState().migrating).toBe(true);

    // 部屋を出たことで切断の知らせが来る（本番でも必ず来る）。
    const left1 = pluginGet<() => boolean>('review:opponentLeft')?.();
    expect(left1).toBe(true);
    // **「相手が退室しました」を出さない**＝出すと毎回それが出てしまう。
    expect(useReviewShareStore.getState().notice).not.toBe('oppLeft');
  });
});

/**
 * ★v1.58: **移った先の部屋に入るところまで通す**（親 §6.3.6・§9.2.5）。
 *
 * v1.57 の検査は「控えがあれば自分の側になる」ことしか固定しておらず、
 * **移る一連の流れを通していなかった**（2 台ないと通らないと決めつけて外に置いた）。
 * **実際には、移った先で入る処理を呼ぶところまでは 1 台でも辿れる**。
 * その 1 歩で、**控えを取る処理と消す処理が同じところに在る**ことが分かる。
 */
describe('★v1.58 移った先の部屋に入っても、対局から続いた控えは消えない', () => {
  const REVIEW_ROOM = encodeRoomName({
    gameType: 'shogi',
    torus: false,
    quantum: false,
    review: true,
    userRoomName: '太郎の部屋',
  });

  it('★ゲスト＝移った先の部屋に入っても「自分の側」と「自分の対局」が残る', () => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi([
      roomRow('x2', REVIEW_ROOM, { isPublic: false, hasPassword: true }),
    ]);
    // 自分は**後手**だった＝ここが逆さになると実機で「ゲストの盤だけ上下が逆」に見える。
    installConnector(false, 'player2');
    useMatchmakingStore.setState({ isHost: false, currentRoomId: 'g1' });
    const file = loadLastKifu();
    if (!file) throw new Error('棋譜が記憶されていない');

    receiveReviewMessage({ kind: 'offer', pass: 'aabbccdd11223344', room: REVIEW_ROOM });
    answerReviewOffer(true);
    // 対局の部屋を出る前に控えられている（v1.57 でここまでは通っていた）。
    expect(reviewMySide()).toBe('player2');

    // ★ここから先が v1.57 で通っていなかった＝移った先の部屋に入る。
    joinedReviewRoom();
    expect(reviewMySide()).toBe('player2');

    // 配られた棋譜は**ホストの向き**（先手が下）で来る。**自分の対局として受け取る**
    // ことで初めて、自分の側へ向きを寄せられる（親 §9.2.5）。
    receiveReviewMessage({ kind: 'state', kifu: serializeKifu(file), ply: 0, branch: [] });
    expect(reviewIsOwnGame()).toBe(true);
  });

  it('★ホスト＝客を迎えても「自分の側」が残る', () => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi([]);
    installConnector(true, 'player1');

    offerReview();
    receiveReviewMessage({ kind: 'reply', accepted: true });
    expect(reviewMySide()).toBe('player1');

    // 移った先の部屋へ客が来た＝ホスト側の「移り終えた合図」。
    expect(reviewGuestArrived()).toBe(true);
    expect(reviewMySide()).toBe('player1');
  });
});
