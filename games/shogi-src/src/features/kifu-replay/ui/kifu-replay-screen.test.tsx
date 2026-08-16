import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useKifuGuardStore } from '../../../core/store/kifu-guard';
import { generateLegalMoves } from '../../../core/engine';
import '../index';
import { serializeKifu } from '../index';
import { chooseFolder, forgetFolder } from '../folder';
import { discardKifu, kifuMemoryState, loadLastKifu, markKifuSaved } from '../storage';
import { KifuReplayScreen } from './KifuReplayScreen';

/**
 * 棋譜再生画面 (S08)。機能の正典＝画面機能 v0.31 §3 S08。
 *
 * ここで固定したいのは 4 点。
 *   - **記憶が空でも書類ピッカーを勝手に開かない**（受け皿が隠れ、やめた先も失われる）
 *   - **再生は破棄の契機ではない**＝見ただけで受け皿が消えない
 *   - **読み込みはピッカーを開く前に確認を通す**（読み込みは破棄の契機）
 *   - **盤は記録から作るだけ**＝途中まで戻しても記録は満額のまま
 */

/** 決まった順で指す（乱数を使わない＝落ちたとき再現できる）。 */
function playMoves(count: number): void {
  for (let i = 0; i < count; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') return;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) return;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) return;
  }
}

/** 終局まで進めて、未保存の棋譜を記憶に置く。 */
function finishedGame(moves = 6): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  playMoves(moves);
  useGameStore.getState().resign('player2');
}

/** 書類ピッカーが開いたかどうかを見る。 */
function watchPicker(): { opened: () => number } {
  const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  return { opened: () => spy.mock.calls.length };
}

beforeEach(() => {
  discardKifu();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'kifu-replay' });
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S08 記憶が空のとき', () => {
  it('★書類ピッカーを自動で開かない（押されるまで開かない）', () => {
    const picker = watchPicker();
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));

    expect(screen.getByText('まだ棋譜がありません')).toBeInTheDocument();
    expect(picker.opened()).toBe(0);
  });

  it('再生の操作は押せない（進める棋譜が無い）', () => {
    render(<KifuReplayScreen />);
    expect(screen.getByText('▶')).toBeDisabled();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });
});

describe('S08 記憶している 1 局', () => {
  beforeEach(() => {
    finishedGame(6);
    expect(kifuMemoryState()).toBe('unsaved');
  });

  it('一覧の先頭に出て、未保存であることが分かる', () => {
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));
    expect(screen.getByText('未保存')).toBeInTheDocument();
  });

  it('保存済みなら「未保存」は出ない（保存ボタンは残る＝もう一度書き出せる）', () => {
    markKifuSaved();
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));
    expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    expect(screen.getByText('保存')).toBeInTheDocument();
  });

  it('★見ただけでは記憶が消えない（再生は破棄の契機ではない）', () => {
    const { unmount } = render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('▶'));
    expect(kifuMemoryState()).toBe('unsaved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
    unmount();
    expect(kifuMemoryState()).toBe('unsaved');
  });
});

describe('S08 再生の操作', () => {
  beforeEach(() => {
    finishedGame(6);
  });

  it('開いた直後は 0 手目（初期配置）', () => {
    render(<KifuReplayScreen />);
    expect(screen.getByText('0 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().position.history).toHaveLength(0);
  });

  it('1 手進むと盤が 1 手ぶん進む', () => {
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('▶'));
    expect(screen.getByText('1 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().position.history).toHaveLength(1);
  });

  it('末尾まで飛べて、そこから先へは進めない', () => {
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('▶|'));
    expect(screen.getByText('6 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().position.history).toHaveLength(6);
    expect(screen.getByText('▶')).toBeDisabled();
  });

  it('手数リストの行を押すとその局面へ飛ぶ', () => {
    const { container } = render(<KifuReplayScreen />);
    // 0 行目が「— 開始 —」なので、3 手目は 4 番目の行（盤の座標にも数字があるので
    // 文字では引かない）
    fireEvent.click(container.querySelectorAll('.mv')[3]);
    expect(screen.getByText('3 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().position.history).toHaveLength(3);
  });

  it('★画面を離れるときは入る前の盤へ戻す（終局していたことも含めて）', () => {
    // 投了は手ではないので棋譜に残らない＝並べ直すだけでは終局に戻らない。
    // 戻せていないと、結果の画面が出ず、対 AI では相手が指し始めてしまう。
    const before = useGameStore.getState().status;
    expect(before).not.toBe('playing');

    const { unmount } = render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('▶'));
    expect(useGameStore.getState().position.history).toHaveLength(1);
    expect(useGameStore.getState().status).toBe('playing');

    unmount();
    expect(useGameStore.getState().position.history).toHaveLength(6);
    expect(useGameStore.getState().status).toBe(before);
  });

  it('★盤を戻したことで記憶が上書きされない（記録 → 盤の一方向）', () => {
    // 「保存済み」の印で見分ける。盤を戻したことを新しい終局と取り違えると、
    // 盤から作り直した棋譜が未保存として書き込まれ、**印が消える**。
    markKifuSaved();
    expect(kifuMemoryState()).toBe('saved');

    const { unmount } = render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('▶'));
    unmount();

    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
  });
});

describe('S08 棋譜の読み込み（破棄の契機）', () => {
  it('★未保存なら、書類ピッカーを開く前に確認を出す', () => {
    finishedGame(6);
    const picker = watchPicker();
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));
    fireEvent.click(screen.getByText('棋譜を読み込む'));

    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    expect(picker.opened()).toBe(0);
    // まだ何も選んでいないので、記憶もそのまま
    expect(kifuMemoryState()).toBe('unsaved');
  });

  it('保存済みなら尋ねず、そのままピッカーが開く', () => {
    finishedGame(6);
    markKifuSaved();
    const picker = watchPicker();
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));
    fireEvent.click(screen.getByText('棋譜を読み込む'));

    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(picker.opened()).toBe(1);
  });

  it('記憶が空なら尋ねず、そのままピッカーが開く', () => {
    const picker = watchPicker();
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));
    fireEvent.click(screen.getByText('棋譜を読み込む'));

    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(picker.opened()).toBe(1);
  });
});

/**
 * ★フォルダを指定してあるとき（親 v1.39 §9.2.3 ②④）。
 *
 * **変わるのは上の帯と一覧の出所だけ**で、画面は 1 つのまま（画面機能 §3 S08）。
 * **フォルダの中の棋譜を選ぶのは「読み込み」ではない**ので、確認は出ないし記憶にも触らない
 * （すでにファイルとして在るものを、控えに取り直す意味がないため）。
 */
describe('S08 フォルダを指定してあるとき', () => {
  /** 端末のフォルダの代役（中に棋譜を 1 局置いておく）。 */
  function fakeFolderWith(text: string) {
    const files = new Map<string, string>([['a.json', text]]);
    const handle = (n: string) => ({
      kind: 'file' as const,
      name: n,
      getFile: async () => ({ text: async () => files.get(n) ?? '' }) as unknown as File,
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    return {
      kind: 'directory' as const,
      name: '棋譜フォルダ',
      getFileHandle: async (n: string) => handle(n),
      values: async function* () {
        for (const n of [...files.keys()]) yield handle(n);
      },
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => 'granted' as PermissionState,
    };
  }

  beforeEach(async () => {
    await forgetFolder();
    // 一覧に出す棋譜を 1 局作ってから、それを入れたフォルダを覚えさせる。
    finishedGame(4);
    const inFolder = serializeKifu(loadLastKifu()!);
    discardKifu();
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => fakeFolderWith(inFolder),
      configurable: true,
    });
    await chooseFolder();
    // 記憶にはこれとは別の、未保存の 1 局を置く。
    finishedGame(6);
    expect(kifuMemoryState()).toBe('unsaved');
  });

  afterEach(async () => {
    await forgetFolder();
    Reflect.deleteProperty(window, 'showDirectoryPicker');
  });

  it('上の帯がフォルダ名と件数になり、「棋譜を読み込む」は出ない', async () => {
    render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));

    expect(await screen.findByText('別のフォルダを選ぶ')).toBeInTheDocument();
    expect(screen.queryByText('棋譜を読み込む')).not.toBeInTheDocument();
    // 保存先の表示（io-bar 右端）にも同じ名前が出る
    expect(screen.getAllByText('棋譜フォルダ').length).toBeGreaterThan(0);
  });

  it('★フォルダの中の棋譜を選んでも確認は出ず、記憶にも触らない', async () => {
    const { container } = render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('棋譜一覧'));
    await screen.findByText('別のフォルダを選ぶ');

    // 先頭は未保存の記憶（固定）。その下がフォルダの中の 1 局。
    const rows = container.querySelectorAll('.kcard');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]);

    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(kifuMemoryState()).toBe('unsaved');
    expect(loadLastKifu()?.moves).toHaveLength(6); // 記憶は入れ替わっていない
    // 盤は選んだ棋譜（4 手）に入れ替わり、0 手目から見せる
    expect(screen.getByText('0 / 4')).toBeInTheDocument();
  });
});

describe('S08 への行き来', () => {
  it('★棋譜再生へ移るときは確認を出さない（新しい対局ではない）', () => {
    finishedGame(6);
    useRouteStore.setState({ screen: 'game' });
    useRouteStore.getState().setScreen('kifu-replay');

    expect(useRouteStore.getState().screen).toBe('kifu-replay');
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(kifuMemoryState()).toBe('unsaved');
  });
});
