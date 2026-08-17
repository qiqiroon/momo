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
import { setReviewTarget } from './review';
import { serializeKifu } from './io';
import {
  answerReviewOffer,
  canOfferReview,
  endSharedReview,
  isSharedReview,
  offerReview,
  receiveReviewMessage,
  reviewOpponentLeft,
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
  getActiveRules: () => null,
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
