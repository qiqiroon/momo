import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { useI18nStore } from '../../core/store/i18n-store';
import { useRouteStore } from '../../core/store/route-store';
import { useKifuGuardStore } from '../../core/store/kifu-guard';
import { useOffersStore } from '../../core/store/offers-store';
import { useMatchmakingStore } from '../matchmaking/store';
import { handleShogiMessage } from '../matchmaking/messageDispatcher';
import { register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage } from '../../core/plugin/review';
import { generateLegalMoves } from '../../core/engine';
import '../matchmaking/gameConnector';
import './index';
import { discardKifu, loadLastKifu, markKifuSaved, kifuMemoryState } from './storage';
import { clearReviewTarget, reviewTarget, setReviewTarget } from './review';
import { useChatStore } from '../../core/store/chat-store';
import { parseKifu, serializeKifu } from './io';
import {
  answerReviewOffer,
  canOfferReview,
  endSharedReview,
  isSharedReview,
  joinedReviewRoom,
  leaveSharedReview,
  offerReview,
  receiveReviewMessage,
  reviewGuestArrived,
  reviewOpponentLeft,
  replaceSharedKifu,
  reviewRoomCreated,
  useReviewShareStore,
} from './review-share';
import { ReviewScreen } from './ui/ReviewScreen';
import type { KifuFile } from './types';

/**
 * 二人の感想戦 (S11)。意味論＝親 v1.42 §9.4.4・通信＝親 §6.3.6・
 * 画面の要件＝画面機能 v0.37 §3 S11・絵柄＝付録D-12 v1.0 §3／§7／§8。
 *
 * ここで固定したいのは、**壊れても画面を見ただけでは気づきにくいもの**。
 *   - **断られてもひとりで入る**（同意が要るのは相手を巻き込むことだけ）
 *   - **ホストは棋譜を必ず配る**／**ゲストは配り終えるまで触れない**
 *   - **盤も再生操作も共有する**（指す・進む・戻すの 3 通りが正しく伝わる）
 *   - **食い違ったらホストを正**（ゲストの手は消え、そのことを知らせる）
 *   - **相手が抜けても終わらない**＝対局中の切断と扱いを分ける（退室を促さない）
 *   - **画面を離れるときは相手に伝える**（黙って居なくならない）
 */

/** 送った伝言を控える偽の通信口。**中身だけを見たい**ので実物には触れない。 */
let sent: ReviewMessage[] = [];
let iAmHost = true;
let peerName = '花子';
let mySide: 'player1' | 'player2' = 'player1';

const fakeConnector = {
  isOnline: () => true,
  isRoomHost: () => iAmHost,
  getOpponentName: () => peerName,
  getMyName: () => '太郎',
  getMySide: () => mySide,
  // v1.50: 二人のときはチャット欄が出るので、その分も答えられるようにする。
  getMyChatSide: () => mySide,
  getActiveRules: () => null,
  subscribe: () => () => {},
  sendReview: (msg: ReviewMessage) => {
    sent.push(msg);
  },
} as unknown as OnlineGameConnector;

function playMoves(count: number): void {
  for (let i = 0; i < count; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') return;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) return;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) return;
  }
}

/**
 * 1 局を終局まで指すだけ（**振り返る 1 局には決めない**）。
 * 記憶だけが置き換わる＝本番の「対局が終わった」時点そのもの。
 */
function playedGame(moves: number): KifuFile {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  playMoves(moves);
  useGameStore.getState().resign('player2');
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  return file;
}

/** 終局まで進めて、振り返る 1 局を用意する。 */
function finishedGame(moves = 6): KifuFile {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  playMoves(moves);
  useGameStore.getState().resign('player2');
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  setReviewTarget(file, 'game');
  return file;
}

/**
 * 相手からの伝言を届ける。**画面が出ている間は act で包む**＝包まないと、
 * 届いたことによる盤の作り直しが走る前に確かめてしまう（画面の都合であって仕様ではない）。
 */
function deliver(msg: ReviewMessage): void {
  act(() => receiveReviewMessage(msg));
}

function squareAt(container: HTMLElement, row: number, col: number): Element {
  return container.querySelectorAll('.board .sq')[row * 9 + col];
}

/** 二人で始まっている状態（自分＝ホスト）を作る。 */
function startAsHost(): void {
  iAmHost = true;
  answerReviewOffer(true);
  sent = [];
}

/** 二人で始まっている状態（自分＝ゲスト・棋譜は受け取り済み）を作る。 */
function startAsGuest(file: KifuFile): void {
  iAmHost = false;
  answerReviewOffer(true);
  receiveReviewMessage({ kind: 'state', kifu: serializeKifu(file), ply: 0, branch: [] });
  sent = [];
}

beforeEach(() => {
  sent = [];
  iAmHost = true;
  peerName = '花子';
  mySide = 'player1';
  register<OnlineGameConnector>('gameConnector', fakeConnector);
  // **毎回ここで既定へ戻す**＝口は登録しっぱなしになるので、前の検査の登録が
  // 残ると走らせる順で結果が変わる（借りた運で緑になる検査は嘘をつく）。
  register('reviewRoom:block', () => 'ok');
  register('reviewRoom:lastName', () => '太郎');
  register('reviewRoom:create', () => true);
  register('reviewRoom:leave', () => {});
  endSharedReview();
  discardKifu();
  useOffersStore.getState().clearAll();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
  useMatchmakingStore.setState({ opponentLeftDuringGame: false });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  endSharedReview();
  vi.restoreAllMocks();
});

describe('S11 打診と諾否', () => {
  it('相手が居るときだけ打診できる（対 AI・オフラインでは打診しない）', () => {
    expect(canOfferReview()).toBe(true);
    peerName = '';
    expect(canOfferReview()).toBe(false);
  });

  it('申し出ると返事待ちになる', () => {
    finishedGame();
    offerReview();
    expect(useOffersStore.getState().reviewOfferFrom).toBe('me');
    expect(sent).toEqual([{ kind: 'offer' }]);
  });

  it('★断られてもひとりで入る（同意が要るのは相手を巻き込むことだけ）', () => {
    finishedGame();
    offerReview();
    sent = [];
    receiveReviewMessage({ kind: 'reply', accepted: false });

    expect(useRouteStore.getState().screen).toBe('review');
    expect(isSharedReview()).toBe(false);
    expect(useReviewShareStore.getState().notice).toBe('declined');
    expect(sent).toEqual([]);
  });

  it('★受けてもらったら二人になり、ホストは棋譜を必ず配る', () => {
    const file = finishedGame();
    offerReview();
    sent = [];
    iAmHost = true;
    receiveReviewMessage({ kind: 'reply', accepted: true });

    expect(isSharedReview()).toBe(true);
    expect(useReviewShareStore.getState().role).toBe('host');
    expect(useRouteStore.getState().screen).toBe('review');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'state', ply: 0, branch: [] });
    // **棋譜そのものを送る**＝相手が同じ対局を指していても、持っていることを当てにしない。
    expect(sent[0]).toHaveProperty('kifu', serializeKifu(file));
  });

  it('★受ける側がゲストなら、配られるまで待つ（自分の記憶を当てにしない）', () => {
    finishedGame();
    iAmHost = false;
    receiveReviewMessage({ kind: 'offer' });
    expect(useOffersStore.getState().reviewOfferFrom).toBe('opp');

    answerReviewOffer(true);
    expect(useReviewShareStore.getState().role).toBe('guest');
    expect(useReviewShareStore.getState().ready).toBe(false);
    // 返事は返すが、棋譜は配らない（配るのはホストだけ）。
    expect(sent).toEqual([{ kind: 'reply', accepted: true }]);
  });

  it('断るときは相手に返すだけで、自分は感想戦に入らない', () => {
    finishedGame();
    receiveReviewMessage({ kind: 'offer' });
    answerReviewOffer(false);

    expect(sent).toEqual([{ kind: 'reply', accepted: false }]);
    expect(isSharedReview()).toBe(false);
    expect(useRouteStore.getState().screen).toBe('game');
  });
});

describe('S11 盤と再生操作の共有', () => {
  it('★配られるまでは触れない。届いたら盤が並ぶ', () => {
    const file = finishedGame(6);
    iAmHost = false;
    answerReviewOffer(true);
    const { container } = render(<ReviewScreen />);

    expect(screen.getByText('棋譜を受け取っています…')).toBeInTheDocument();
    fireEvent.click(squareAt(container, 2, 4));
    expect(useGameStore.getState().selectedSquare).toBeNull();

    deliver({ kind: 'state', kifu: serializeKifu(file), ply: 2, branch: [] });
    expect(screen.getByText('2 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().position.history).toHaveLength(2);
    expect(screen.queryByText('棋譜を受け取っています…')).not.toBeInTheDocument();
  });

  it('★自分の操作が相手へ伝わる（指す＝手・進む＝再生・戻す＝戻し）', () => {
    finishedGame(6);
    startAsHost();
    const { container } = render(<ReviewScreen />);
    sent = [];

    // 進む
    fireEvent.click(screen.getByText('▶'));
    expect(sent).toEqual([{ kind: 'seek', base: { ply: 0, branchLen: 0 }, ply: 1 }]);
    sent = [];

    // 指す（分岐が 1 手伸びる）
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'move', base: { ply: 1, branchLen: 0 }, ply: 1 });
    expect((sent[0] as { branch: unknown[] }).branch).toHaveLength(1);
    sent = [];

    // 戻す（分岐が縮む）
    fireEvent.click(screen.getByText('◀'));
    expect(sent).toEqual([{ kind: 'undo', base: { ply: 1, branchLen: 1 }, ply: 1, branch: [] }]);
  });

  it('★相手の居場所を映す（分岐もそのまま並ぶ）', () => {
    const file = finishedGame(6);
    startAsGuest(file);
    render(<ReviewScreen />);

    // 相手が 2 手目まで進めて、そこから 1 手指した。
    const branch = [{ kind: 'move' as const, pieceId: 'P2', from: { row: 6, col: 2 }, to: { row: 5, col: 2 }, promote: false }];
    deliver({ kind: 'move', base: { ply: 0, branchLen: 0 }, ply: 0, branch });

    expect(useGameStore.getState().position.history).toHaveLength(1);
    expect(screen.getByText('分岐')).toBeInTheDocument();
    // 映しただけのものを送り返さない（送り合いになる）。
    expect(sent).toEqual([]);
  });

  it('二人のときの盤の向きは自分の側（配られた棋譜の持ち主ではない）', () => {
    const file = finishedGame(6);
    mySide = 'player2';
    startAsGuest(file);
    const { container } = render(<ReviewScreen />);
    // 配られた棋譜は先手側から書き出されているが、後手の自分から見た盤になる。
    expect(file.meta.viewerSide).toBe('player1');
    expect(container.querySelector('.board-with-coords.flipped')).not.toBeNull();
  });
});

describe('S11 食い違い（ホストを正とする）', () => {
  it('★ホストは、居場所の違う伝言を採らずに配り直す', () => {
    finishedGame(6);
    startAsHost();
    const { container } = render(<ReviewScreen />);
    // ホストは 1 手指している。
    fireEvent.click(squareAt(container, 6, 4));
    fireEvent.click(squareAt(container, 5, 4));
    expect(useGameStore.getState().position.history).toHaveLength(1);
    sent = [];

    // 同じころ、ゲストは何も指していない場所から指していた。
    const theirs = [{ kind: 'move' as const, pieceId: 'p13', from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, promote: false }];
    deliver({ kind: 'move', base: { ply: 0, branchLen: 0 }, ply: 0, branch: theirs });

    // 採らない＝自分の手はそのまま。配り直す（棋譜は相手が持っているので省く）。
    expect(useGameStore.getState().position.history).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'state', ply: 0 });
    expect(sent[0]).not.toHaveProperty('kifu');
  });

  it('★ゲストはホストを正として採り、自分の手が消えたことを知らせる', () => {
    const file = finishedGame(6);
    startAsGuest(file);
    const { container } = render(<ReviewScreen />);
    fireEvent.click(squareAt(container, 6, 4));
    fireEvent.click(squareAt(container, 5, 4));
    expect(useGameStore.getState().position.history).toHaveLength(1);
    sent = [];

    const theirs = [{ kind: 'move' as const, pieceId: 'p13', from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, promote: false }];
    deliver({ kind: 'move', base: { ply: 0, branchLen: 0 }, ply: 0, branch: theirs });

    // ホストの手が残り、自分の手は消える。**黙って消さない。**
    expect(useGameStore.getState().position.history).toHaveLength(1);
    expect(useGameStore.getState().position.history[0]).toMatchObject({ pieceId: 'p13' });
    expect(screen.getByText('同時に指したため、相手の手が残りました')).toBeInTheDocument();
  });
});

describe('S11 相手が抜けたとき', () => {
  it('★感想戦は終わらない（対局中の切断と扱いを分ける）', () => {
    finishedGame(6);
    startAsHost();
    render(<ReviewScreen />);

    let left = false;
    act(() => {
      left = reviewOpponentLeft();
    });
    expect(left).toBe(true);
    expect(useReviewShareStore.getState().opponentPresent).toBe(false);
    expect(screen.getByText('相手が退室しました。ひとりで続けます。')).toBeInTheDocument();
    // 退室を促すモーダルの合図（対局中の切断）は立てない。
    expect(useMatchmakingStore.getState().opponentLeftDuringGame).toBe(false);
  });

  it('感想戦をしていなければ、従来どおりの切断の扱いに任せる', () => {
    expect(reviewOpponentLeft()).toBe(false);
  });

  it('配られるのを待っている最中に相手が抜けても、ひとりで続けられる', () => {
    finishedGame(6);
    iAmHost = false;
    answerReviewOffer(true);
    expect(useReviewShareStore.getState().ready).toBe(false);
    reviewOpponentLeft();
    expect(useReviewShareStore.getState().ready).toBe(true);
  });

  it('★画面を離れるときは相手に伝える（黙って居なくならない）', () => {
    finishedGame(6);
    startAsHost();
    const view = render(<ReviewScreen />);
    sent = [];
    view.unmount();

    expect(sent).toEqual([{ kind: 'reply', accepted: false }]);
    expect(isSharedReview()).toBe(false);
  });

  it('★相手が出ていっても、こちらの記録は動かない', () => {
    finishedGame(6);
    markKifuSaved();
    startAsHost();
    const view = render(<ReviewScreen />);

    // 相手が感想戦から出た（＝断りの伝言として届く）。
    deliver({ kind: 'reply', accepted: false });
    expect(useReviewShareStore.getState().opponentPresent).toBe(false);
    expect(screen.getByText('相手が退室しました。ひとりで続けます。')).toBeInTheDocument();
    view.unmount();
    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
  });
});

describe('★S11 振り返る 1 局は必ず決まる（v1.51・実機で見つかった穴）', () => {
  /**
   * 実機（2 台）で判明した段1 からの穴。**終局パネルの「感想戦」は相手が居ると
   * 打診しかせず、振り返る 1 局を決めない**。受ける側も決めない。結果、ホストの配布は
   * 「配る 1 局が無い」ので黙って何もせず戻り、両者とも 1 局の無いまま画面へ入って
   * いた＝盤が並び直されず、進む・戻すが押せず、指した手も相手に届かない。
   *
   * **v1.50 までの検査が緑だったのは、検査の下ごしらえが 1 局を決めていたから**
   * ＝本番にその工程が無いことを見ていなかった。だからここでは**わざと決めずに**始める。
   */
  it('★打診の前に 1 局を決めていなくても、二人で始まれば記憶している 1 局で決まる', () => {
    finishedGame(6);
    // ★本番と同じ状態にする＝終局パネルは打診しかしないので、対象は決まっていない。
    clearReviewTarget('game');
    expect(reviewTarget()).toBeNull();

    iAmHost = true;
    answerReviewOffer(true);

    expect(reviewTarget()).not.toBeNull();
    // **1 局が決まっていないと、ここで何も送らずに終わっていた**（それが実機の症状）。
    const state = sent.find((m) => m.kind === 'state');
    expect(state && 'kifu' in state ? state.kifu : undefined).toBeTruthy();
  });

  it('★盤が終局のまま取り残されない（並び直され、進む・戻すが押せる）', () => {
    finishedGame(6);
    clearReviewTarget('game');
    iAmHost = true;
    answerReviewOffer(true);
    sent = [];

    const view = render(<ReviewScreen />);
    // 1 局が決まっていないと「棋譜がありません」が出て、操作帯が押せなかった。
    expect(screen.queryByText('棋譜がありません')).not.toBeInTheDocument();
    const buttons = [...view.container.querySelectorAll('.playbar button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(false);
    view.unmount();
  });

  /**
   * ★v1.53・実機のご報告（2026-08-18）「ネット対戦から感想戦に入ると、対戦の結果では
   * なく前にダウンロードした棋譜で始まった」。
   *
   * **振り返る 1 局の控えは画面より長生きする**（閉じても残る）ので、前に一度でも
   * 感想戦を使っていると**その 1 局が入ったまま**になる。v1.52 の埋め方は「空のときだけ」
   * だったので、**残っている限り、いま終わった対局は一度も見られなかった**。
   *
   * ★v1.51 の検査が緑だったのは、**下ごしらえでわざわざ控えを空にしていた**から。
   * 本番には空にする工程が無い。だからここでは**前の 1 局を残したまま**始める。
   */
  it('★前に見た棋譜が控えに残っていても、終局から入れば いま終わった対局で始まる', () => {
    const before = finishedGame(4); // 前に感想戦で見た 1 局（控えに残る）
    const now = playedGame(10); // そのあと終わったネット対戦
    expect(now.meta.moveCount).not.toBe(before.meta.moveCount);
    // **本番と同じ状態**＝控えは前の 1 局のまま。
    expect(reviewTarget()?.meta.moveCount).toBe(before.meta.moveCount);

    iAmHost = true;
    answerReviewOffer(true);

    expect(reviewTarget()?.meta.moveCount).toBe(now.meta.moveCount);
    const state = sent.find((m) => m.kind === 'state');
    const handed = state && 'kifu' in state && state.kifu ? parseKifu(state.kifu) : null;
    // 相手にも**いま終わった対局**が配られる（前の棋譜を二人で見ることにならない）。
    expect(handed?.meta.moveCount).toBe(now.meta.moveCount);
  });

  it('★断られてひとりで入るときも、いま終わった対局で始まる', () => {
    const before = finishedGame(4);
    const now = playedGame(10);
    offerReview();
    deliver({ kind: 'reply', accepted: false });
    expect(reviewTarget()?.meta.moveCount).toBe(now.meta.moveCount);
    expect(reviewTarget()?.meta.moveCount).not.toBe(before.meta.moveCount);
  });

  it('感想戦の部屋で客を迎えるときは、開くときに決めた 1 局のまま（記憶で上書きしない）', () => {
    const chosen = playedGame(4); // 部屋で振り返ると決めた 1 局
    const other = playedGame(10); // そのあと記憶は別の対局に置き換わっている
    expect(other.meta.moveCount).not.toBe(chosen.meta.moveCount);
    setReviewTarget(chosen, 'lobby');
    reviewRoomCreated();
    iAmHost = true;

    expect(reviewGuestArrived()).toBe(true);
    expect(reviewTarget()?.meta.moveCount).toBe(chosen.meta.moveCount);
  });

  it('★埋めるのは配る側だけ＝ゲストは手元の記憶を代わりに映さず、配られるのを待つ', () => {
    finishedGame(6);
    clearReviewTarget('game');
    iAmHost = false;
    answerReviewOffer(true);
    // **配られる 1 局とは限らないものを盤に出さない**（親 §6.3.6）。
    expect(reviewTarget()).toBeNull();
    expect(useReviewShareStore.getState().ready).toBe(false);
  });
});

describe('S11 感想戦の部屋（段2・v1.50）', () => {
  it('★ゲストとして入ると、待機画面ではなく感想戦へ進み、棋譜が届くまで待つ', () => {
    finishedGame(6);
    iAmHost = false;
    joinedReviewRoom();

    expect(useRouteStore.getState().screen).toBe('review');
    const s = useReviewShareStore.getState();
    expect(s.role).toBe('guest');
    // **配り終えるまで触れない**（画面機能 §3 S11）。
    expect(s.ready).toBe(false);
    // **手元の記憶を代わりに映さない**＝配られる 1 局とは限らない。
    expect(reviewTarget()).toBeNull();
  });

  it('★自分の建てた部屋に客が来たら、そこで棋譜を配り始める', () => {
    finishedGame(6);
    iAmHost = true;
    reviewRoomCreated();
    sent = [];

    expect(reviewGuestArrived()).toBe(true);
    expect(useReviewShareStore.getState().role).toBe('host');
    const state = sent.find((m) => m.kind === 'state');
    expect(state).toBeDefined();
    // **棋譜そのものを送る**（相手が持っていることを当てにしない・親 §6.3.6）。
    expect(state && 'kifu' in state ? state.kifu : undefined).toBeTruthy();
  });

  it('★v1.66: 棋譜をまだ持っていなくても、客が来たら共有を始めて「無い」ことを配る', () => {
    // 規定＝**棋譜が無くても入れる**（親 §9.4.1・初期配置で入り、中で読み込む）。
    // v1.65 までは「配るものが無い」として引き返していたため、**共有そのものが
    // 始まらず**、ゲストは「棋譜を受け取っています…」のまま待ち続けていた
    // （2026-08-20 実機のご報告）。**黙ると、待っている側は「まだ来ていない」と
    // 「無いと知らされた」を区別できない。**
    clearReviewTarget('lobby');
    iAmHost = true;
    reviewRoomCreated();
    sent = [];

    expect(reviewGuestArrived()).toBe(true);
    expect(useReviewShareStore.getState().role).toBe('host');
    const state = sent.find((m) => m.kind === 'state');
    expect(state).toBeDefined();
    // 棋譜の欄は省いて送る＝受け取った側は差し替えず、居場所だけ採る（初期配置のまま）。
    expect(state && 'kifu' in state ? state.kifu : undefined).toBeUndefined();
  });

  it('★v1.66: 棋譜を持たずに始めた部屋でも、あとから読み込めばゲストへ届く', () => {
    // v1.65 までは、配り直しの仕掛けが「共有が始まっていること」を前提に
    // していたので、**ここでも黙って止まって**いた（止めている場所が 2 つあった）。
    clearReviewTarget('lobby');
    iAmHost = true;
    reviewRoomCreated();
    reviewGuestArrived();
    sent = [];

    const file = playedGame(6);
    replaceSharedKifu(file);

    const state = sent.find((m) => m.kind === 'state');
    expect(state).toBeDefined();
    expect(state && 'kifu' in state ? state.kifu : undefined).toBeTruthy();
  });

  it('★v1.66: 受け取る側は、棋譜の無い配りでも待ちが解ける', () => {
    // ゲスト側＝「棋譜を受け取っています…」は**何か届くまで**出続ける表示なので、
    // 届いたものに棋譜が入っていなくても、そこで待ちは終わらなければならない。
    clearReviewTarget('lobby');
    iAmHost = false;
    joinedReviewRoom();
    expect(useReviewShareStore.getState().ready).toBe(false);

    deliver({ kind: 'state', ply: 0, branch: [] });

    expect(useReviewShareStore.getState().ready).toBe(true);
  });

  it('感想戦の部屋でなければ、客が来ても何も起きない（対局の部屋と混ぜない）', () => {
    finishedGame(6);
    sent = [];
    expect(reviewGuestArrived()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('★v1.54: 画面を離れるときは、入り口によらず部屋から出る', () => {
    finishedGame(6);
    let left = 0;
    register('reviewRoom:leave', () => {
      left += 1;
    });
    reviewRoomCreated();

    leaveSharedReview();
    expect(left).toBe(1);

    // ★v1.54: **対局の終わりから入った感想戦でも出る**（親 v1.48 §9.4.3）。
    // 戻る先がモード選択の一択になったので、部屋に残っても戻る道が無く、
    // 誰も居ない部屋になる。v1.53 まではここで出ずに残っていた。
    startAsHost();
    leaveSharedReview();
    expect(left).toBe(2);
  });
});

describe('★S11 部屋を作ったあとの見え方（v1.52・実機のご報告）', () => {
  /**
   * v1.51 まで＝建てるとボタンが灰色になり、添えられる理由が
   * **「対局の部屋にいます。先に退室してください」**だった。**自分がいま建てた
   * 感想戦の部屋なのに、対局の部屋に居ると言われる**ので、うまくいったのに
   * 失敗したように読める（灰色は「押せない」しか意味しない）。畳む手立ても
   * 画面に無く、出たのかどうかも分からなかった。
   */
  beforeEach(() => {
    register('reviewRoom:block', () => 'already-in-room');
    register('reviewRoom:lastName', () => '太郎');
  });

  it('★v1.55: 建てた部屋に居ることは「部屋を閉じる」が出ていることで示す', () => {
    finishedGame(6);
    reviewRoomCreated();
    const view = render(<ReviewScreen />);

    // ★v1.55（付録D-12 v1.4 §8）＝**S12 で建てた直後にこの画面へ来る**ので、
    // 「部屋を作りました。相手を待っています」という知らせは要らなくなった。
    // **畳む手立てが出ていること自体が「部屋に居る」の表示**になる。
    expect(screen.getByText('部屋を閉じる')).toBeInTheDocument();
    // **紛らわしい理由を出さない**＝自分で建てた部屋なのだから。
    expect(screen.queryByText('対局の部屋にいます。先に退室してください')).not.toBeInTheDocument();
    expect(screen.queryByText('部屋を作る')).not.toBeInTheDocument();
    view.unmount();
  });

  it('★画面を出たままで部屋を畳めて、畳んだことを知らせる', () => {
    finishedGame(6);
    let left = 0;
    register('reviewRoom:leave', () => {
      left += 1;
    });
    reviewRoomCreated();
    const view = render(<ReviewScreen />);

    fireEvent.click(screen.getByText('部屋を閉じる'));

    expect(left).toBe(1);
    expect(screen.getByText('部屋を閉じました')).toBeInTheDocument();
    // **感想戦そのものは続く**（画面から追い出さない）。
    expect(useRouteStore.getState().screen).not.toBe('lobby');
    expect(useReviewShareStore.getState().ownsRoom).toBe(false);
    view.unmount();
  });

  it('★v1.55: 入り方の案内は S11 に置かない（案内するのは S12 の側）', () => {
    finishedGame(6);
    reviewRoomCreated();
    const view = render(<ReviewScreen />);
    // ★v1.55（付録D-12 v1.4 §3）＝操作の行は**押せるものだけ**を並べる。
    // 相手の入り方はモード選択の説明が受け持っており、ここで繰り返さない。
    expect(screen.queryByText('相手はモード選択の「感想戦」から入れます')).not.toBeInTheDocument();
    view.unmount();
  });

  it('★v1.54: 建てる導線は S11 に無い（建てる場所はロビー S12 だけ）', () => {
    finishedGame(6);
    register('reviewRoom:block', () => 'ok');
    const view = render(<ReviewScreen />);

    // 親 v1.48 §9.4.1＝**建てる場所が 2 か所あると、名前を決める手順も規定も
    // 二重になる**。部屋名と表示名を決めるパネルは S12 へ移した。
    expect(screen.queryByText('部屋を作る')).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('.room-field input')).toHaveLength(0);
    view.unmount();
  });
});

describe('S11 チャット（v1.50）', () => {
  it('★感想戦に入るたびに空から始める（対局中の会話を持ち込まない）', () => {
    finishedGame(6);
    useChatStore.getState().addMessage('player1', '対局中のひとこと');
    startAsHost();

    const view = render(<ReviewScreen />);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(screen.queryByText('対局中のひとこと')).not.toBeInTheDocument();
    view.unmount();
  });

  it('空にするのは入るときだけ＝そのあとの会話は相手が抜けても消さない', () => {
    finishedGame(6);
    startAsHost();
    const view = render(<ReviewScreen />);

    act(() => useChatStore.getState().addMessage('player1', '感想戦でのひとこと'));
    deliver({ kind: 'reply', accepted: false }); // 相手が抜けた
    expect(useChatStore.getState().messages).toHaveLength(1);
    view.unmount();
  });

  it('★v1.55: ひとりのときもチャットの場所は置いたまま灰色にする', () => {
    finishedGame(6);
    const view = render(<ReviewScreen />);
    // ★v1.55（付録D-12 v1.4 §2）＝**相手が入ってきた拍子に並びが変わって盤の
    // 大きさが動く**のを防ぐため、置くものの数を変えない（対局画面がオフライン
    // 対戦でそうしているのと同じ）。v1.50〜v1.54 の「出さない」は撤回。
    expect(view.container.querySelector('.moves-col .console')).not.toBeNull();
    expect(view.container.querySelector('.moves-col .panel.offline-disabled')).not.toBeNull();
    view.unmount();
  });

  it('二人のときはチャットを出す', () => {
    finishedGame(6);
    startAsHost();
    const view = render(<ReviewScreen />);
    expect(view.container.querySelector('.moves-col .console')).not.toBeNull();
    view.unmount();
  });
});

describe('S11 通信の口（伝言が素通りする）', () => {
  it('感想戦の伝言は、そのまま感想戦の側へ渡る', () => {
    finishedGame(6);
    // ★v1.56: **伝言は 1 本の入れ物で丸ごと運ぶ**（親 v1.50 §6.3.6）。
    // v1.55 までは種類ごとに項目を書き写しており、**書き写す欄に無いものは黙って
    // 捨てられて**いた（ハイライトと合言葉が届かなかった）。運び方そのものの
    // 見張りは `features/matchmaking/review-transport.test.ts`。
    handleShogiMessage({ v: 1, type: 'review', payload: { kind: 'offer' } });
    expect(useOffersStore.getState().reviewOfferFrom).toBe('opp');
  });

  it('知らない伝言は黙って捨てる（フォワード互換）', () => {
    expect(() => handleShogiMessage({ v: 1, type: 'review_unknown' })).not.toThrow();
  });
});

describe('★v1.54 進んだ部屋に入ってきた人にも、いまの局面を配る（親 v1.48 §6.3.6）', () => {
  /**
   * v1.53 まで＝配るのは棋譜だけで、居場所は必ず `ply: 0` だった。そのため
   * **先に来ていた人が話している局面が、後から来た人にだけ見えず**、
   * 誰かが 1 手動かすまで追いつけなかった（2026-08-19 実機のご報告）。
   *
   * `state` はもともと「何手目にいるか＋分岐の手の並び」を丸ごと運ぶ形なので、
   * **入室の瞬間にも同じものを載せればよい**＝新しい伝言は作らない。
   */
  it('★ホストが 3 手目を見ているところへ客が来たら、3 手目を配る', () => {
    finishedGame(6);
    reviewRoomCreated();
    const view = render(<ReviewScreen />);

    // ホストが再生を進める（画面が「いまの居場所」を持っている状態にする）。
    fireEvent.click(screen.getByText('▶'));
    fireEvent.click(screen.getByText('▶'));
    fireEvent.click(screen.getByText('▶'));
    sent = [];

    act(() => {
      reviewGuestArrived();
    });

    const state = sent.find((m) => m.kind === 'state');
    expect(state).toBeTruthy();
    expect(state && state.kind === 'state' ? state.ply : -1).toBe(3);
    // **棋譜も必ず一緒に配る**（相手が持っていることを当てにしない）。
    expect(state && state.kind === 'state' ? !!state.kifu : false).toBe(true);
    view.unmount();
  });

  it('画面がまだ出ていなければ、初期局面から配る（居場所がそもそも無い）', () => {
    finishedGame(6);
    reviewRoomCreated();
    sent = [];

    reviewGuestArrived();

    const state = sent.find((m) => m.kind === 'state');
    expect(state && state.kind === 'state' ? state.ply : -1).toBe(0);
  });
});

describe('★v1.54 感想戦の中で棋譜を差し替える（親 v1.48 §9.4.2）', () => {
  it('★ひとりのときは「棋譜読込」が出る', () => {
    finishedGame(6);
    const view = render(<ReviewScreen />);
    expect(screen.getByText('棋譜読込')).toBeInTheDocument();
    view.unmount();
  });

  it('★二人のときは、ホストにだけ出す（ゲストには出さない）', () => {
    const file = finishedGame(6);

    startAsHost();
    const host = render(<ReviewScreen />);
    expect(screen.getByText('棋譜読込')).toBeInTheDocument();
    host.unmount();

    endSharedReview();
    startAsGuest(file);
    const guest = render(<ReviewScreen />);
    // ゲストが差し替えると、配られる 1 局と食い違ったまま気づけない。
    expect(screen.queryByText('棋譜読込')).not.toBeInTheDocument();
    guest.unmount();
  });

  it('★未保存の棋譜があるときは、書類ピッカーを開く前に確認を出す', () => {
    finishedGame(6);
    expect(kifuMemoryState()).toBe('unsaved');
    const view = render(<ReviewScreen />);

    fireEvent.click(screen.getByText('棋譜読込'));

    // 読み込みは破棄の契機（親 §9.2.3 ②）＝**開いてから尋ねない**。
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    view.unmount();
  });

  it('保存済みなら尋ねずに開く（同じことを二度尋ねない）', () => {
    finishedGame(6);
    markKifuSaved();
    const view = render(<ReviewScreen />);

    fireEvent.click(screen.getByText('棋譜読込'));

    expect(useKifuGuardStore.getState().stage).toBeNull();
    view.unmount();
  });
});
