import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { useI18nStore } from '../../core/store/i18n-store';
import { useRouteStore } from '../../core/store/route-store';
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
import { serializeKifu } from './io';
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

  it('感想戦の部屋でなければ、客が来ても何も起きない（対局の部屋と混ぜない）', () => {
    finishedGame(6);
    sent = [];
    expect(reviewGuestArrived()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('★感想戦のために建てた／入った部屋は、画面を離れるときに出る', () => {
    finishedGame(6);
    let left = 0;
    register('reviewRoom:leave', () => {
      left += 1;
    });
    reviewRoomCreated();

    leaveSharedReview();
    expect(left).toBe(1);

    // 対局の終わりから入った感想戦では**部屋から出ない**（相手を追い出さない）。
    startAsHost();
    leaveSharedReview();
    expect(left).toBe(1);
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

  it('★建てたあとは「相手を待っています」と出し続ける（失敗のように見せない）', () => {
    finishedGame(6);
    reviewRoomCreated();
    const view = render(<ReviewScreen />);

    expect(screen.getByText('部屋を作りました。相手を待っています')).toBeInTheDocument();
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

  it('相手の入り方を画面に書いておく（ロビーからしか入れないことが分からない）', () => {
    finishedGame(6);
    reviewRoomCreated();
    const view = render(<ReviewScreen />);
    expect(screen.getByText('相手は「ネット対戦」の一覧から入れます')).toBeInTheDocument();
    view.unmount();
  });

  it('★建てる前に部屋名と表示名を決められる（既定は入れておく）', () => {
    finishedGame(6);
    register('reviewRoom:block', () => 'ok');
    let got: { roomName: string; playerName: string } | null = null;
    register('reviewRoom:create', (info: { roomName: string; playerName: string }) => {
      got = info;
      return true;
    });
    const view = render(<ReviewScreen />);

    fireEvent.click(screen.getByText('部屋を作る'));
    const inputs = view.container.querySelectorAll('.room-field input');
    expect(inputs).toHaveLength(2);
    // **既定が入っている**＝決めさせるために止めない。
    expect((inputs[0] as HTMLInputElement).value).toContain('感想戦');
    expect((inputs[1] as HTMLInputElement).value).toBe('太郎');

    fireEvent.change(inputs[0], { target: { value: 'わたしの部屋' } });
    fireEvent.change(inputs[1], { target: { value: '花子' } });
    fireEvent.click(view.container.querySelector('.btn-row .btn.primary') as Element);

    expect(got!.roomName).toBe('わたしの部屋');
    expect(got!.playerName).toBe('花子');
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

  it('ひとりのときはチャットを出さない（相手が居ないので置く意味が無い）', () => {
    finishedGame(6);
    const view = render(<ReviewScreen />);
    expect(view.container.querySelector('.moves-col .console')).toBeNull();
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
    handleShogiMessage({ v: 1, type: 'review_offer' });
    expect(useOffersStore.getState().reviewOfferFrom).toBe('opp');
  });

  it('知らない伝言は黙って捨てる（フォワード互換）', () => {
    expect(() => handleShogiMessage({ v: 1, type: 'review_unknown' })).not.toThrow();
  });
});
