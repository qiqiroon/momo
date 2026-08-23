import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore, computeVictoryFlags } from '../store/game-store';
import { useRouteStore } from '../store/route-store';
import { useI18nStore } from '../store/i18n-store';
import { useAiStore } from '../store/ai-store';
import { aiMayMove } from '../controller/ai-driver';
import { register } from '../plugin/registry';
import type { PieceInstance, Position } from '../engine/position/types';

/**
 * ★v1.88 入玉宣言の権利とタイミング（親 v1.63 §4.4.2・付録D-1 v1.22 §7）。
 *
 * 2026-08-23 の実機のご報告＝**ネット対戦で、相手の手番になった瞬間、相手の条件で
 * 自分の画面にも入玉宣言ボタンが出ていた**。**押すと相手の勝ちを宣言してしまう。**
 *
 * ここで固定したいのは 5 点。
 *   - **宣言は勝つ側の権利**＝**「いま手番の側」で決めない**
 *   - **自分の手で成立したら、その場で尋ねる**（相手に手番を渡さない）
 *   - **尋ねている間は駒を動かせない・時計は止まる・時間制限は無い**
 *   - **「しない」のあとはボタンだけが残り、条件が崩れたら消える**
 *   - **AI には尋ねず、AI は必ず宣言する**
 */

const P = (kind: string, owner: 'player1' | 'player2', id?: string): PieceInstance => ({
  pieceId: id ?? `${owner}_${kind}`,
  kind,
  owner,
  initialOwner: owner,
  initialKind: kind,
  initialSquare: { row: -1, col: -1 },
  promoted: false,
});

function buildPos(
  pieces: Array<{ row: number; col: number; piece: PieceInstance }>,
  sideToMove: 'player1' | 'player2' = 'player1',
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

/**
 * 先手が宣言できる局面。敵陣内に 玉＋飛＋角＋歩9（12 枚 → 玉を除いて 11 枚）、
 * 持ち駒の歩 9 枚を足して 28 点。**実際に `canDeclareNyugyoku` が通る形**。
 */
function declarablePos(sideToMove: 'player1' | 'player2' = 'player1'): Position {
  const pieces = [
    { row: 0, col: 4, piece: P('ou', 'player1') },
    { row: 0, col: 0, piece: P('hi', 'player1') },
    { row: 0, col: 1, piece: P('kaku', 'player1') },
    { row: 8, col: 4, piece: P('ou', 'player2') },
  ];
  for (let c = 0; c < 9; c++) {
    pieces.push({ row: 1, col: c, piece: P('fu', 'player1', `p1_fu_b${c}`) });
  }
  const base = buildPos(pieces, sideToMove);
  return {
    ...base,
    hands: {
      player1: Array.from({ length: 9 }, (_, i) => P('fu', 'player1', `p1_fu_h${i}`)),
      player2: [],
    },
  };
}

/** 盤と手番だけを差し替えて対局中の画面を作る。 */
function setBoard(position: Position) {
  useGameStore
    .getState()
    .reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  // **「押せる手立て」は盤から測り直す**＝着手を通ったときと同じ値になる
  // （検査の下ごしらえが、本番に無い工程を肩代わりしないようにする）。
  const { mgf } = useGameStore.getState();
  useGameStore.setState({ position, ...computeVictoryFlags(mgf, position) });
}


/**
 * ネット対戦の接続点を差し替える（**ご報告はネット対戦の場面**なので、ここを作らないと
 * 「いま手番の側で決める」誤りを見張れない＝**自分の席と手番が食い違うのは対戦のときだけ**）。
 */
function registerOnline(mySide: 'player1' | 'player2') {
  const sent: string[] = [];
  register('gameConnector', {
    isOnline: () => true,
    getMySide: () => mySide,
    getMyChatSide: () => mySide,
    getMyName: () => '太郎',
    getOpponentName: () => '花子',
    getActiveRules: () => null,
    isRuleSetter: () => false,
    getPendingRules: () => null,
    getPendingTimeControl: () => null,
    commitPendingToActive: () => {},
    sendMove: () => sent.push('move'),
    sendChat: () => {},
    subscribe: () => () => {},
    isSpectating: () => false,
    getSeatNames: () => null,
    getSpectators: () => [],
    isSpectateWaiting: () => false,
    getOpponentLeftDuringGame: () => false,
    getWsPendingReconnect: () => false,
    getLastPeerMessageAt: () => null,
    isRoomHost: () => false,
    leaveOnline: () => {},
    markConnectionDead: () => {},
    markConnectionHealthy: () => {},
    returnToPreparation: () => {},
    sendAnomalyRaise: () => {},
    sendAnomalyVote: () => {},
    sendDrawCancel: () => {},
    sendDrawOffer: () => {},
    sendDrawResponse: () => {},
    sendPauseNotify: () => {},
    sendPing: () => {},
    sendResign: () => {},
    sendResumeOffer: () => {},
    sendResumeResponse: () => {},
    sendReview: () => {},
    sendTimeout: () => {},
    sendUndoCancel: () => {},
    sendUndoOffer: () => {},
    sendUndoResponse: () => {},
    sendNyugyokuDeclare: () => sent.push('declare'),
    sendNyugyokuPrompt: (open: boolean) => sent.push(`prompt:${open}`),
  } as never);
  return sent;
}

beforeEach(() => {
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
  useAiStore.setState({ enabled: false, aiSide: 'player2', thinking: false });
});

afterEach(() => {
  register('gameConnector', undefined as never);
});

describe('入玉宣言の権利（親 v1.63 §4.4.2.1）', () => {
  it('★同じ端末の二人＝いま手番の側が条件を満たしていれば出る（従来どおり）', () => {
    setBoard(declarablePos('player1'));
    render(<App variant="b" />);
    expect(screen.queryByRole('button', { name: '入玉宣言' })).not.toBeNull();
  });

  it('★同じ端末の二人＝手番が相手に移れば消える（押せるのは自分の手番だけ）', () => {
    setBoard(declarablePos('player2'));
    render(<App variant="b" />);
    // 条件を満たしているのは先手だが、手番は後手。
    expect(useGameStore.getState().canNyugyokuP1).toBe(true);
    expect(screen.queryByRole('button', { name: '入玉宣言' })).toBeNull();
  });

  it('★対 AI＝AI 側の条件では出さない（負ける側に押す権利は無い）', () => {
    // AI は後手。条件を満たしているのは先手（＝人）なので、人の手番なら出る。
    useAiStore.setState({ enabled: true, aiSide: 'player2', thinking: false });
    setBoard(declarablePos('player1'));
    render(<App variant="b" />);
    expect(screen.queryByRole('button', { name: '入玉宣言' })).not.toBeNull();
  });

  it('★対 AI＝人が条件を満たしていなければ、人の画面にボタンは出ない', () => {
    // AI を先手にすると、条件を満たしているのは AI 側になる。
    // （AI は §7.9.1 で即座に宣言するので、そのまま終局する。**人のボタンは
    //   一度も出ない**＝勝つ側の権利であって、負ける側には無い。）
    useAiStore.setState({ enabled: true, aiSide: 'player1', thinking: false });
    setBoard(declarablePos('player1'));
    render(<App variant="b" />);
    expect(screen.queryByRole('button', { name: '入玉宣言' })).toBeNull();
    expect(useGameStore.getState().status).toBe('nyugyoku_win_p1');
  });
});

describe('★ネット対戦（2026-08-23 実機のご報告）', () => {
  it('★相手の手番になっても、相手の条件で自分の画面にボタンを出さない', () => {
    // 条件を満たしているのは先手。**自分は後手**で、手番は先手（＝相手）。
    // v1.87 は「いま手番の側」で決めていたので、**ここで自分の画面にボタンが出て、
    // 押すと相手の勝ちを宣言していた**。
    registerOnline('player2');
    render(<App variant="b" />);
    // **盤は画面を出したあとに置く**＝対戦の画面は開くときに盤を作り直すので、
    // 先に置くと消される（下ごしらえが本番の工程とすれ違わないようにする）。
    act(() => setBoard(declarablePos('player1')));
    expect(useGameStore.getState().canNyugyokuP1).toBe(true);
    expect(screen.queryByRole('button', { name: '入玉宣言' })).toBeNull();
  });

  it('★条件を満たしている本人の画面には、自分の手番のときに出る', () => {
    registerOnline('player1');
    render(<App variant="b" />);
    act(() => setBoard(declarablePos('player1')));
    expect(screen.queryByRole('button', { name: '入玉宣言' })).not.toBeNull();
  });

  it('★相手が尋ねられている間は「入玉宣言選択中」を出す（何も出さないと壊れて見える）', () => {
    registerOnline('player2');
    const { container } = render(<App variant="b" />);
    act(() => {
      setBoard(declarablePos('player1'));
      useGameStore.getState().setNyugyokuPrompt('player1');
    });
    expect(container.querySelector('.nyugyoku-wait')).not.toBeNull();
    // 答えるものは無いのでボタンは置かない。
    expect(container.querySelector('.floating-result.nyugyoku')).toBeNull();
  });

  it('★宣言したら相手と観戦者へ知らせる（本人の画面だけ終局させない）', () => {
    const sent = registerOnline('player1');
    render(<App variant="b" />);
    act(() => {
      setBoard(declarablePos('player1'));
      useGameStore.getState().setNyugyokuPrompt('player1');
    });
    fireEvent.click(screen.getByText('宣言する'));
    expect(sent).toContain('declare');
  });

  it('★尋ねている間は、指した手を相手へ送らない（相手に手番を渡さない）', () => {
    const sent = registerOnline('player1');
    render(<App variant="b" />);
    act(() => {
      setBoard(declarablePos('player1'));
      useGameStore.setState({
        nyugyokuPromptSide: 'player1',
        lastAppliedMove: {
          move: { type: 'drop', pieceId: 'p1_fu_h0', to: { row: 3, col: 0 } },
          source: 'local',
          seq: 1,
        } as never,
      });
    });
    expect(sent).not.toContain('move');
    // 答えたら送られる。
    fireEvent.click(screen.getByText('しない'));
    expect(sent).toContain('move');
  });
});

describe('★v1.89 尋ねる印が立つ経路（2026-08-23 実機のご報告）', () => {
  /** 先手が「あと 1 枚敵陣へ打てば宣言できる」局面（打っても点数は変わらず、枚数だけ届く）。 */
  function almostPos(): Position {
    const pieces = [
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 0, col: 0, piece: P('hi', 'player1') },
      { row: 0, col: 1, piece: P('kaku', 'player1') },
      { row: 8, col: 4, piece: P('ou', 'player2') },
    ];
    for (let c = 0; c < 7; c++) {
      pieces.push({ row: 1, col: c, piece: P('fu', 'player1', `p1_fu_b${c}`) });
    }
    const base = buildPos(pieces, 'player1');
    return {
      ...base,
      hands: {
        player1: Array.from({ length: 11 }, (_, i) => P('fu', 'player1', `p1_fu_h${i}`)),
        player2: [],
      },
    };
  }

  it('自分で指して成立したら印が立つ', () => {
    setBoard(almostPos());
    expect(useGameStore.getState().canNyugyokuP1).toBe(false);
    const st = useGameStore.getState();
    st.selectHandPiece('p1_fu_h0');
    expect(st.tryMove({ row: 1, col: 8 })).toBe(true);
    expect(useGameStore.getState().nyugyokuPromptSide).toBe('player1');
  });

  it('★届いた手では印を立てない（立てると、もう誰も答えないので盤が止まる）', () => {
    // v1.88 はここでも立てていたため、**尋ねられた側が「しない」と答えたあとに
    // 手が届いた相手の端末で印が立ち、答える人が居ないまま盤が止まっていた**。
    setBoard(almostPos());
    const ok = useGameStore
      .getState()
      .applyRemoteMove({ kind: 'drop', pieceId: 'p1_fu_h0', to: { row: 1, col: 8 } } as never);
    expect(ok).toBe(true);
    // 条件そのものは満たしている（＝印を立てなかっただけで、判定は生きている）。
    expect(useGameStore.getState().canNyugyokuP1).toBe(true);
    expect(useGameStore.getState().nyugyokuPromptSide).toBeNull();
  });

  it('★観戦していても、届いた手で盤が止まらない（同じ経路を通る）', () => {
    setBoard(almostPos());
    useGameStore
      .getState()
      .applyRemoteMove({ kind: 'drop', pieceId: 'p1_fu_h0', to: { row: 1, col: 8 } } as never);
    expect(useGameStore.getState().nyugyokuPromptSide).toBeNull();
  });
});

describe('入玉宣言を尋ねる（親 v1.63 §4.4.2.2）', () => {
  it('★尋ねている間は駒を動かせない', () => {
    setBoard(declarablePos('player1'));
    useGameStore.getState().setNyugyokuPrompt('player1');
    const st = useGameStore.getState();
    st.selectSquare({ row: 0, col: 0 });
    expect(useGameStore.getState().selectedSquare).toBeNull();
    expect(st.tryMove({ row: 0, col: 2 })).toBe(false);
  });

  it('★「宣言する」でその側の勝ちになる', () => {
    setBoard(declarablePos('player1'));
    useGameStore.getState().setNyugyokuPrompt('player1');
    render(<App variant="b" />);
    fireEvent.click(screen.getByText('宣言する'));
    expect(useGameStore.getState().status).toBe('nyugyoku_win_p1');
  });

  it('★「しない」で対局は続き、ボタンだけが残る', () => {
    setBoard(declarablePos('player1'));
    useGameStore.getState().setNyugyokuPrompt('player1');
    render(<App variant="b" />);
    fireEvent.click(screen.getByText('しない'));
    expect(useGameStore.getState().status).toBe('playing');
    expect(useGameStore.getState().nyugyokuPromptSide).toBeNull();
    expect(screen.queryByRole('button', { name: '入玉宣言' })).not.toBeNull();
  });

  it('★残り秒数は出さない（時間制限が無いので、在りもしない締め切りを見せない）', () => {
    setBoard(declarablePos('player1'));
    useGameStore.getState().setNyugyokuPrompt('player1');
    const { container } = render(<App variant="b" />);
    const panel = container.querySelector('.floating-result.nyugyoku');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.countdown')).toBeNull();
    expect(panel!.textContent).not.toMatch(/\d+\s*秒/);
  });

  it('★盤を作り直したら「尋ねている」も必ず消える', () => {
    setBoard(declarablePos('player1'));
    useGameStore.getState().setNyugyokuPrompt('player1');
    useGameStore
      .getState()
      .reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    expect(useGameStore.getState().nyugyokuPromptSide).toBeNull();
  });
});

describe('見せ方（付録D-1 v1.22 §7）', () => {
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').split('\r\n').join('\n');

  /** その決まりの中身だけを切り出す。 */
  function ruleBody(selector: string): string {
    const at = css.indexOf(selector);
    if (at < 0) return '';
    const open = css.indexOf('{', at);
    return css.slice(open, css.indexOf('}', open));
  }

  it('★覆いの濃さとぼかしは、持将棋・一時中断とそろえる（同じ出来事を違う見せ方にしない）', () => {
    // 1 つの決まりに束ねてあるので、切り出した中身がそのまま両方に効く。
    const veil = ruleBody('.nyugyoku-veil');
    expect(veil).not.toBe('');
    expect(veil).toContain('rgba(0, 0, 0, 0.40)');
    expect(veil).toContain('blur(10px)');
    // **持将棋の覆いと同じ決まりを共有していること**（値を書き写して片方だけ古くしない）。
    expect(css).toContain('.nyugyoku-veil,\n.jishogi-veil {');
  });

  it('★残り秒数の決まりを借りていない（時間制限が無いので在りもしない締め切りを見せない）', () => {
    const screenSrc = readFileSync(join(__dirname, 'GameScreen.tsx'), 'utf8');
    const at = screenSrc.indexOf('function NyugyokuPromptModal');
    const body = screenSrc.slice(at, screenSrc.indexOf('function NyugyokuWaitNotice'));
    expect(body).not.toContain('countdown');
    expect(body).not.toContain('Deadline');
  });
});

describe('AI の扱い（親 v1.63 §7.9）', () => {
  it('★AI 側には尋ねるモーダルを出さない', () => {
    useAiStore.setState({ enabled: true, aiSide: 'player1', thinking: false });
    setBoard(declarablePos('player2'));
    useGameStore.getState().setNyugyokuPrompt('player1');
    const { container } = render(<App variant="b" />);
    expect(container.querySelector('.floating-result.nyugyoku')).toBeNull();
  });

  it('★AI は「入玉宣言しますか」に答えるまで指さない（相手に手番を渡さない）', () => {
    // **判断そのものを見る**＝検査環境では思考ルーチンが積まれておらず、AI は
    // どのみち 1 手も指さない。**結果から確かめると何を壊しても緑になる**（実測）。
    const base = {
      enabled: true,
      isOnline: false,
      status: 'playing',
      paused: false,
      anomaly: false,
    };
    expect(aiMayMove({ ...base, nyugyokuPrompt: null })).toBe(true);
    expect(aiMayMove({ ...base, nyugyokuPrompt: 'player1' })).toBe(false);
    expect(aiMayMove({ ...base, nyugyokuPrompt: 'player2' })).toBe(false);
  });

  it('★AI は宣言できるときは必ず宣言する（手番を待たない）', () => {
    useAiStore.setState({ enabled: true, aiSide: 'player1', thinking: false });
    // 手番は後手（＝人）だが、条件を満たしているのは AI（先手）。
    setBoard(declarablePos('player2'));
    render(<App variant="b" />);
    expect(useGameStore.getState().status).toBe('nyugyoku_win_p1');
  });
});
