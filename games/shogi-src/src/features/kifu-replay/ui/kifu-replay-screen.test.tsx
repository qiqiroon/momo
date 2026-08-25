import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useKifuGuardStore } from '../../../core/store/kifu-guard';
import { chess, generateLegalMoves } from '../../../core/engine';
import '../index';
// 量子の検査で候補集合を作るのに要る（積んでいないと駒が最初から確定してしまい、
// 「巡回するか」「候補が出るか」の検査が素通りする）。
import '../../quantum';
import { serializeKifu } from '../index';
import { chooseFolder, forgetFolder } from '../folder';
import { discardKifu, kifuMemoryState, loadLastKifu, markKifuSaved, rememberKifu } from '../storage';
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

/**
 * ★実機確認からの 13 件（2026-08-16 ユーザー報告・v1.42）。
 */
describe('S08 v1.42 の直し', () => {
  it('★棋譜が無いときは初期配置を出す（前の対局の終局図を残さない）', () => {
    // 盤は対局画面と同じものを使うので、並べ直さないと終局図がそのまま残り、
    // 「その棋譜を開いている」と誤読される。
    finishedGame(6);
    expect(useGameStore.getState().position.history).toHaveLength(6);
    discardKifu(); // 記憶が空の状態で開く

    render(<KifuReplayScreen />);
    expect(useGameStore.getState().position.history).toHaveLength(0);
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });

  it('★戻るは常にモード選択へ（「結果へ」を廃止＝無関係な結果へ飛ばない）', () => {
    finishedGame(6);
    render(<KifuReplayScreen />);
    expect(screen.queryByText('結果へ')).not.toBeInTheDocument();
    expect(screen.queryByText('トップへ')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('モード選択'));
    expect(useRouteStore.getState().screen).toBe('lobby');
  });

  it('★終局は最後の手と同じ行に出る＝手数は増えない', () => {
    finishedGame(6); // 投了で終わる
    const { container } = render(<KifuReplayScreen />);

    const rows = container.querySelectorAll('.mv');
    expect(rows).toHaveLength(7); // 0 行目（開始）＋ 6 手。終局で行は増えない
    expect(screen.getByText('0 / 6')).toBeInTheDocument();

    const badge = container.querySelector('.end-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('投了');
    // 最後の手の行に付いていること
    expect(rows[6].contains(badge!)).toBe(true);
  });

  it('★終局の記録を持たない古い棋譜では何も出さない（縮退互換）', () => {
    finishedGame(6);
    const old = loadLastKifu()!;
    // v1.41 までのファイルには result が無いことがある。読めなくしてはならない。
    const stripped = { ...old, meta: { ...old.meta, result: undefined } };
    localStorage.setItem('shogi.kifu.last', JSON.stringify({ mark: 'saved', file: stripped }));

    const { container } = render(<KifuReplayScreen />);
    expect(container.querySelector('.end-badge')).toBeNull();
    expect(screen.getByText('0 / 6')).toBeInTheDocument();
  });

  it('★量子の巡回は再生の状態に関わらず動き続ける', () => {
    vi.useFakeTimers();
    try {
      useGameStore.getState().reset({ gameType: 'shogi', quantum: true, torusMode: 'none', handicap: null });
      playMoves(4);
      useGameStore.getState().resign('player2');

      const { container } = render(<KifuReplayScreen />);
      // **末尾まで再生し切ってから**字を控える。先に控えると、再生で盤が変わったぶんを
      // 「巡回した」と取り違えて、時計が止まっていても緑になってしまう。
      fireEvent.click(screen.getByText('▶|'));
      const before = [...container.querySelectorAll('.board .pc .ja')].map((e) => e.textContent);
      expect(before.length).toBeGreaterThan(0);
      expect(container.querySelectorAll('.qmark-b').length).toBeGreaterThan(0); // 未確定駒が居ること

      let changed = false;
      for (let i = 0; i < 8 && !changed; i += 1) {
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        const now = [...container.querySelectorAll('.board .pc .ja')].map((e) => e.textContent);
        changed = now.some((s, idx) => s !== before[idx]);
      }
      expect(changed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('★対局者の名前の前に先手／後手を出す（どちらが先手か分かるように）', () => {
    finishedGame(6);
    const { container } = render(<KifuReplayScreen />);
    const names = [...container.querySelectorAll('.pinfo .nm')].map((e) => e.textContent);
    expect(names).toHaveLength(2);
    // 印＋「先手」「後手」の語が名前の前に付いていること。
    expect(names.some((n) => n?.startsWith('▲先手'))).toBe(true);
    expect(names.some((n) => n?.startsWith('△後手'))).toBe(true);
  });

  it('★盤の駒に乗せると候補ボックスが出る（駒台だけではない）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: true, torusMode: 'none', handicap: null });
    playMoves(4);
    useGameStore.getState().resign('player2');

    const { container } = render(<KifuReplayScreen />);
    fireEvent.click(screen.getByText('▶'));
    // 候補が 2 つ以上ある駒＝「？」が付いているマスを選ぶ（確定した駒には出ない）。
    const sq = [...container.querySelectorAll('.sq')].find((e) => e.querySelector('.qmark-b'));
    expect(sq).toBeDefined();
    fireEvent.mouseEnter(sq!);
    expect(document.querySelector('.qtip')).not.toBeNull();
  });
});

/**
 * 盤の大きさの計算（付録D-8 §5.1・付録D-1 §4.2.1／2026-08-17 ユーザー指示）。
 *
 * ここで固定したいのは 3 点。
 *   - **盤の縦横をルール定義から画面へ流す**＝9 を書かない（将来 9x9 以外があるため）
 *   - **マスの大きさは縦と横の両方から決める**＝どちらか片方だけ見ると、
 *     余る窓とはみ出す窓の両方が生じる（v1.43 まで実際にそうだった）
 *   - **駒台が 2 列になる前提で横を計算する**＝持ち駒が増えても盤の大きさが変わらない
 *
 * マスの大きさ自体は CSS が窓の寸法から決めるので、jsdom では値を測れない。
 * **測れるのは「何を材料にして計算しているか」**なので、そこを見る。
 */
/**
 * 自動再生中の巡回（付録D-1 v1.14 §5.6.2・2026-08-17 ユーザー報告）。
 *
 * **自動再生は 1 秒ごとに手が進んで候補が減り、巡回の切り替えも 1 秒ごと**なので、
 * 「候補の何番目か」で字を選ぶと**候補が減った拍子に前と同じ字**を指す。
 * v1.44 まではこれで**その駒だけ止まって見えていた**（実測＝60 手の量子棋譜で 2 枚）。
 *
 * **マスではなく駒そのもの（pieceId）で追う**＝マスで追うと、駒が動いた先に
 * 別の駒が来たぶんを「変わった」と取り違えて、止まりを見逃す。
 */
describe('S08 自動再生中の巡回（付録D-1 §5.6.2）', () => {
  it('★手が進んで候補が減っても、未確定の駒は毎秒かならず字が変わる', () => {
    vi.useFakeTimers();
    try {
      useGameStore.getState().reset({ gameType: 'shogi', quantum: true, torusMode: 'none', handicap: null });
      for (let i = 0; i < 60; i += 1) {
        const s = useGameStore.getState();
        if (s.status !== 'playing') break;
        const legal = generateLegalMoves(s.mgf, s.position);
        if (legal.length === 0) break;
        if (!useGameStore.getState().replayRecordedMove(legal[(i * 13 + 5) % legal.length])) break;
      }
      useGameStore.getState().resign('player2');

      const { container } = render(<KifuReplayScreen />);
      fireEvent.click(screen.getByText(/自動|▶ /));

      /** ？付きの駒の字を、駒そのものごとに控える。 */
      const shownByPiece = (): Map<string, string> => {
        const m = new Map<string, string>();
        const board = useGameStore.getState().position.board;
        [...container.querySelectorAll('.board .sq')].forEach((sq, i) => {
          if (!sq.querySelector('.qmark-b')) return;
          const ja = sq.querySelector('.pc .ja');
          const piece = board[Math.floor(i / 9)]?.[i % 9];
          if (ja?.textContent && piece) m.set(piece.pieceId, ja.textContent);
        });
        return m;
      };

      const stuck: string[] = [];
      let prev = shownByPiece();
      expect(prev.size).toBeGreaterThan(0); // 未確定の駒が居ること（居ないと素通りする）
      for (let step = 0; step < 30; step += 1) {
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        const now = shownByPiece();
        for (const [id, ch] of now) {
          if (prev.get(id) === ch) stuck.push(`${id}=${ch}`);
        }
        prev = now;
      }
      expect(stuck).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
    /**
     * **この 1 件だけ制限時間を広げる**（既定 5 秒 → 15 秒）。
     *
     * 60 手の量子の対局を作って盤を 30 回進めるので、単独でも実測 3.1 秒かかる＝
     * **遅いこと自体は正常**。余裕が 1.9 秒しかなく、他の検査と場所を取り合うと
     * 間に合わずに落ちていた（手元でも 2 回に 1 回・CI は手元より非力）。
     *
     * **中身は減らさない**＝この不具合は「60 手の量子棋譜で 2 枚が止まる」形で
     * 見つかったもので、手数や回数を削ると取りこぼす（付録D-1 §5.6.2）。
     */
  }, 15_000);
});

describe('S08 盤の大きさの計算（付録D-8 §5.1）', () => {
  const cssPath = resolve(process.cwd(), 'src/core/ui-core/styles.css');
  const s08Rule = (): string => {
    const css = readFileSync(cssPath, 'utf8');
    const at = css.indexOf('.stage.s08 {');
    expect(at).toBeGreaterThan(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('★盤の縦横をルール定義から画面へ流す（9 を書かない）', () => {
    const { container } = render(<KifuReplayScreen />);
    const stage = container.querySelector('.stage.s08') as HTMLElement;
    const mgf = useGameStore.getState().mgf;
    expect(stage.style.getPropertyValue('--board-cols')).toBe(String(mgf.board.width));
    expect(stage.style.getPropertyValue('--board-rows')).toBe(String(mgf.board.height));
  });

  it('★マスの大きさは窓の縦と横の両方から決める（片方だけ見ない）', () => {
    const rule = s08Rule();
    expect(rule).toContain('100vw');
    expect(rule).toMatch(/100s?vh/);
    // 小さいほうを採る＝どちらの向きでもはみ出さない。
    expect(rule).toContain('min(');
  });

  it('★割り数に盤の段数・列数を使う（マスの数を決め打ちにしない）', () => {
    const rule = s08Rule();
    expect(rule).toContain('var(--board-cols, 9)');
    expect(rule).toContain('var(--board-rows, 9)');
  });

  it('★横は駒台が 2 列になる前提で計算する（持ち駒が増えても盤が変わらない）', () => {
    // 駒はマスの 0.66・2 列 × 左右 2 つ＝2.64 マスぶんを列数に足す。
    expect(s08Rule()).toContain('2.64');
  });

  it('★駒台の駒はこの画面のマスから 2/3 を取る（共通の既定値から取らない）', () => {
    expect(s08Rule()).toMatch(/--hand-pc:\s*calc\(var\(--cell\) \* 0\.66\)/);
  });

  it('★駒台の高さも段数から求める（盤の高さ＝マス × 段数）', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('--caps-h: calc(var(--cell) * var(--board-rows, 9) - 3px)');
    expect(css).toContain('max-height: calc(var(--cell) * var(--board-rows, 9) + 24px)');
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


describe('S08 開いた瞬間の 1 局もルール定義を取り戻す (段2b・§9.2.6)', () => {
  /** カスタムルール (チェス) で指し終えて、記憶に置く。 */
  function finishedCustomGame(moves = 6): void {
    useGameStore.getState().reset({
      gameType: 'custom',
      customMgf: chess,
      quantum: false,
      torusMode: 'none',
      handicap: null,
    });
    playMoves(moves);
    useGameStore.getState().resign('player2');
  }

  /** 記憶している 1 局の参照だけを、公式にも手元にも無いルールへ差し替える。 */
  function makeUnresolvable(): void {
    const file = loadLastKifu();
    if (!file) throw new Error('記憶が空');
    rememberKifu(
      {
        ...file,
        meta: {
          ...file.meta,
          customRule: { id: 'chuushogi', name: '中将棋', version: '0.1.0' },
        },
      },
      'saved',
      true,
    );
  }

  beforeEach(() => {
    finishedCustomGame(6);
    // 別セッション相当＝読み込み済みの定義は残っていない（開き直すと消える）。
    useGameStore.setState({ currentCustomMgf: null });
  });

  it('★取り戻せないルールの棋譜は、黙って本将棋にせずパネルを出す', () => {
    makeUnresolvable();
    render(<KifuReplayScreen />);

    expect(screen.getByText('ルール定義が必要です')).toBeInTheDocument();
    expect(screen.getByText('中将棋')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
  });

  it('★取り戻せないうちは盤に出さない（間違ったルールで並べない）', () => {
    makeUnresolvable();
    render(<KifuReplayScreen />);

    // 記録は 6 手あるのに、盤は 1 局も持っていない＝並べ直していない。
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    expect(screen.queryByText('0 / 6')).not.toBeInTheDocument();
  });

  it('公式一覧から取り戻せるルールは、これまでどおりそのまま出る（無回帰の対）', () => {
    render(<KifuReplayScreen />);

    expect(screen.queryByText('ルール定義が必要です')).not.toBeInTheDocument();
    expect(screen.getByText('0 / 6')).toBeInTheDocument();
  });
});
