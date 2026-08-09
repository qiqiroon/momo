/**
 * ビュー切替とオーバーレイの土台（第3分冊 2.1）
 *
 * 単一ページ・2ビュー。ルータを導入せず URL も変えない（C-30）。
 * 起動シーケンス（2.4）・ビュー遷移（2.5）・画面をまたぐ状態（設定・言語・成績・通知）をここが持つ。
 *
 * **入力の配線もここが持つ**（段階7 前半）。操作そのものはドメイン層の取りまとめ窓口へ渡し
 * （第2分冊 C-155）、ここは「どの升へ・どの値を」を決めて渡すだけである。
 * キーボード（8.5）は画面全体で受けるため、部品を増やさず本モジュールで購読する。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chunkLoader } from '../../data/chunkLoader';
import { diagnostics } from '../../data/diagnostics';
import { indexLoader } from '../../data/indexLoader';
import { manifestService } from '../../data/manifest';
import { pick } from '../../data/pick';
import {
  BOARD_SIZES,
  type BoardSize,
  type DataError,
  type DataErrorKind,
  type Difficulty,
  type ExportBundle,
  type LocaleCode,
  type LoupeCorner,
  type Manifest,
  type Puzzle,
  type Settings,
  type Stats,
  type SessionResult,
} from '../../data/types';
import * as board from '../../game/board';
import * as sessionModule from '../../game/session';
import { isComplete, summary as boardSummary } from '../../game/validate';
import { elapsed as elapsedOf } from '../../game/timer';
import { t } from '../../i18n/locale';
import * as locale from '../../i18n/locale';
import { changeMode, currentMode, initLocale, type LocaleMode } from '../../momo-lang/init';
import { recentStore } from '../../storage/recentStore';
import { sessionStore } from '../../storage/sessionStore';
import { settingsStore } from '../../storage/settingsStore';
import { empty as emptyStats, statsStore } from '../../storage/statsStore';
import { transferService } from '../../storage/transfer';
import { randomParams } from '../../transform/params';
import { cellRect, create as createLayout, type BoardLayout, type Rect } from '../canvas/layout';
import { decide as decideLod, type LodLevel } from '../canvas/lod';
import {
  cellPx,
  initial as initialViewport,
  fitOf,
  resize as resizeViewport,
  toScreen,
  zoomTo,
  type ViewportState,
} from '../canvas/viewport';
import type { RenderModel } from '../canvas/renderer';
import { TIMER_TICK_MS, ZOOM_SAVE_DELAY_MS } from '../config';
import { create as createFeedback, type FeedbackController } from '../feedback';
import type { PaletteCover } from './ControlPanel';
import { chooseLoupeCorner, toCellIndex } from '../canvas/hitTest';
import { LOUPE_SPANS } from '../config';
import { Header } from './Header';
import { PlayView } from './PlayView';
import { StatusBar } from './StatusBar';
import { TitleView, type DataState } from './TitleView';
import { useSoundGate } from './useSoundGate';
import { useAppHeight } from '../appHeight';
import { useWakeLock } from '../wakeLock';
import { Dialog } from './overlay/Dialog';
import { Toast, type ToastItem, type ToastKind } from './overlay/Toast';

/** 未設定・未解放時の既定（2.6） */
const DEFAULT_SIZE: BoardSize = 9;
const DEFAULT_DIFFICULTY: Difficulty = 'Hard';

/** 数字キー1つを受けたときの行き先（8.5.1） */
export type DigitStep =
  | { kind: 'IGNORE' }
  /** 即時確定する */
  | { kind: 'COMMIT'; text: string }
  /** 手前を確定し、この桁を次の入力の先頭にする */
  | { kind: 'COMMIT_AND_RESTART'; text: string; digit: string }
  /** 続きを待つ（次の桁・選択の移動・Enter で確定する） */
  | { kind: 'WAIT'; text: string };

/**
 * 多桁入力の確定規則（8.5.1）。**盤面サイズによる分岐を持たない1つの規則である。**
 *
 * 結果として、9×9 以下では待ちが一度も起きず（10 以上の値が無いため即確定）、
 * 25×25 では `1` と `2` だけが待つ、という振る舞いが**帰結として**出る。
 * 純粋関数として切り出してあるのは、確定の境目を検査で名指しできるようにするためである。
 *
 * **先頭の `0` は「1桁で入れる」という宣言である**（C-184）。`0` を押すと仮に見えたままとなり、
 * 次の1文字でその数字として確定する（`0` → `1` で `1`）。25×25 の `1` のように
 * 2桁になりうる数字を、待たずに1桁で入れる手段が他に無かった。
 * `0` のまま他へ移ったときは値0＝消去として確定する（従来どおりの消去である）。
 */
export function resolveDigit(n: number, buffer: string, digit: string): DigitStep {
  // [0] 先頭の 0 のあと。**次の1文字で必ず決まる**ので待たない
  if (buffer === '0') {
    if (Number(digit) > n) return { kind: 'IGNORE' };
    return { kind: 'COMMIT', text: digit };
  }
  if (buffer === '' && digit === '0') return { kind: 'WAIT', text: '0' };

  const text = buffer + digit;
  const value = Number(text);

  // [1] 加えると N を超える。手前を確定し、この桁は次の入力の先頭になる
  if (value > n) {
    if (buffer === '') return { kind: 'IGNORE' }; // その値は存在しない
    return { kind: 'COMMIT_AND_RESTART', text: buffer, digit };
  }
  // [2] さらに桁を足すと N 以下の値が存在しない＝即時確定
  if (value * 10 > n) return { kind: 'COMMIT', text };
  // [4] 続きを待つ
  return { kind: 'WAIT', text };
}

/** 進行中のセッションと、その描画に必要な付随物 */
interface Active {
  session: sessionModule.SessionState;
  layout: BoardLayout;
  viewport: ViewportState;
  /**
   * 表示LOD とルーペの有無。**いずれもヒステリシス（6.4 / 7.1）を持つため状態である。**
   * 毎回セル実寸から決め直すと、閾値の境目でズームを微調整したときに振動する。
   */
  lod: LodLevel;
  /**
   * 復元したい倍率比（5.3）。`fitZoom` に対する比で持つ。
   * 盤面の実寸はマウント後の通知で初めて分かるので、そこまで持ち越す。
   * 新規出題では `null`＝常に fit倍率から始まる（C-48）。
   */
  pendingZoomRatio: number | null;
}

/**
 * ルーペの表示状態（7.2 / C-189・C-191）
 *
 * **開くかどうかは利用者が決める**（虫眼鏡アイコン）。段階7 までのように
 * セルが小さくなったからといって勝手に出ることはない。
 *
 * 映すマスは**マウスがあればマウスの下のマス、無ければ最後に選んだマス**であり、
 * **選択を外しても消えない**。倍率も利用者が決める。
 *
 * 置き場所はふだん設定した角。**数字ボタンに覆われるときだけ、覆われ方のいちばん少ない角へ逃げる。**
 */
function loupeState(
  active: Active,
  hovered: number | null,
  lastSelected: number | null,
  cover: Rect | null,
  settings: Settings,
): { centerIndex: number; span: number; corner: LoupeCorner } | null {
  if (!settings.loupeOpen) return null;
  // **開いたのに何も出ないことがあってはいけない。** マウスも選択も無ければ、
  // いま見ている真ん中のマスを映す（C-189）
  const center = hovered ?? lastSelected ?? centerOfView(active);
  if (center === null) return null;
  const { width, height } = active.viewport;

  /**
   * **マウスで指しているだけのときは、そのマスを避けない**（C-194）。
   *
   * 避けると、ルーペの中の `＋` / `−` を押そうとしてマウスを近づけた瞬間に
   * ルーペが逃げてしまい、**ボタンに永久にたどり着けない**（実機で判明）。
   * 選んだマスを隠さない、という手当てだけを残す。
   */
  const avoid = hovered !== null ? null : lastSelected;

  return {
    centerIndex: center,
    span: settings.loupeSpan,
    corner: chooseLoupeCorner(
      settings.loupeCorner,
      width,
      height,
      cover,
      avoid === null ? null : targetRect(active, avoid),
    ),
  };
}

/**
 * いま見ている範囲の真ん中にあるマス（C-189）
 *
 * ルーペを開いた直後、まだ何も選んでおらずマウスも動いていないときの映し先である。
 * **盤面の中心ではなく、画面の中心**を採る。利用者が見ているのはそこだからである。
 */
function centerOfView(active: Active): number | null {
  const { viewport, layout } = active;
  const x = (viewport.width / 2 - viewport.offsetX) / viewport.zoom;
  const y = (viewport.height / 2 - viewport.offsetY) / viewport.zoom;
  return toCellIndex(x, y, layout);
}

/**
 * 数字ボタンが盤面へかぶっている部分（盤面領域の中の座標・C-198）
 *
 * **要約せず、実物の矩形どうしの重なりを測る。** 段階7 の「どちら側をどれだけ」は
 * せり上がる置き方しか想定しておらず、**横長の画面では覆っていても『なし』になっていた**
 * （実機の記録で判明）。
 */
function coverRect(
  cover: PaletteCover | null,
  frame: { left: number; top: number; width: number; height: number } | null,
): Rect | null {
  if (cover === null || frame === null || frame.width <= 0) return null;
  const x = Math.max(cover.left, frame.left);
  const y = Math.max(cover.top, frame.top);
  const right = Math.min(cover.left + cover.width, frame.left + frame.width);
  const bottom = Math.min(cover.top + cover.height, frame.top + frame.height);
  if (right <= x || bottom <= y) return null;
  // 盤面領域の左上を原点に直す
  return { x: x - frame.left, y: y - frame.top, w: right - x, h: bottom - y };
}

/** 映しているマスの画面上の位置。**ここをルーペで隠してはいけない**（C-191） */
function targetRect(active: Active, index: number): Rect {
  const cell = cellRect(active.layout, index);
  const topLeft = toScreen(active.viewport, cell.x, cell.y);
  const bottomRight = toScreen(active.viewport, cell.x + cell.w, cell.y + cell.h);
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
}

/** ビューポートの変化に、それに従う派生値（LOD・ルーペ）を追随させる */
function withViewport(prev: Active, viewport: ViewportState): Active {
  const px = cellPx(viewport, prev.layout);
  return {
    ...prev,
    viewport,
    lod: decideLod(px, prev.lod),
  };
}

type PendingDialog =
  | { kind: 'discard' }
  | { kind: 'import'; bundle: ExportBundle }
  | { kind: 'failed' }
  | { kind: 'complete'; result: SessionResult; best: boolean };

/** データ層のエラー種別に対応する通知（11.5） */
const TOAST_OF_ERROR: Record<DataErrorKind, { key: string; kind: ToastKind }> = {
  NETWORK: { key: 'toast.network', kind: 'error' },
  SCHEMA_INCOMPATIBLE: { key: 'toast.dataInvalid', kind: 'error' },
  DATA_INVALID: { key: 'toast.dataInvalid', kind: 'error' },
  STORAGE_UNAVAILABLE: { key: 'toast.storageUnavailable', kind: 'warn' },
  STORAGE_FULL: { key: 'toast.storageFull', kind: 'warn' },
};

export function AppShell(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(() => settingsStore.defaults());
  const [localeCode, setLocaleCode] = useState<LocaleCode>(() => locale.current());
  const [mode, setMode] = useState<LocaleMode>('auto');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [dataState, setDataState] = useState<DataState>('loading');
  const [releasedSizes, setReleasedSizes] = useState<ReadonlySet<BoardSize>>(new Set());
  const [offlineSizes, setOfflineSizes] = useState<ReadonlySet<BoardSize>>(new Set());

  const [stats, setStats] = useState<Stats>(() => emptyStats());
  const [hasSuspended, setHasSuspended] = useState(false);

  const [active, setActive] = useState<Active | null>(null);
  const [preparing, setPreparing] = useState(false);
  /** 経過時間の再描画のためだけの目盛り（11.1） */
  const [, setTick] = useState(0);

  /**
   * 盤面が変わった回数（U-45 の解消）。
   *
   * セッションは**同じ入れ物の中身が書き換わる**ため、参照だけを見ていると入力に気づけない。
   * 段階6 までは「セッションを差し替えたとき」しか描き直しと完成判定が走らず、
   * **入力で完成しても結果が出なかった。** 操作のたびにこれを進めて、描画と完成判定の起点にする。
   */
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((prev) => prev + 1), []);

  const [selected, setSelected] = useState<number | null>(null);
  /**
   * 数字ボタンを手で縮めているか（C-204・利用者の指示）
   *
   * 二段構えでは、マスを選ぶと数字ボタンがせり上がって盤面を覆う。**その場だけ引っ込めたい**
   * ことがあるので、操作パネルのボタンで切り替えられるようにした。
   *
   * **これは一時的な指定であり、設定として残さない。** 別のマスを選び直した時点で解除し、
   * 自動の振る舞い（選んだら伸びる・外したら縮む）へ戻る。
   */
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  /**
   * 最後に選んだマス（C-185）。**選択を外しても残す。**
   * ルーペはマウスが無いときここを映す。選択と一緒に消すと、
   * 盤面の外を触っただけでルーペが消えてしまう。
   */
  const [lastSelected, setLastSelected] = useState<number | null>(null);
  /**
   * マウスの下にあるマス（C-185）。**指の端末では常に null。**
   * 実際にマウスが動いたときだけ入るので、「マウスがあるか」を別に調べる必要が無い。
   */
  const [hovered, setHovered] = useState<number | null>(null);
  /** メモ入力モード。**セッション中の揮発状態**であり永続化しない（9.2） */
  const [noteMode, setNoteMode] = useState(false);
  /** 確定前のキーボード入力（8.5.1）。パレット押下はここを通らない */
  const [pending, setPending] = useState<{ index: number; text: string } | null>(null);
  /**
   * 拡大したパレットが盤面の下側を覆っているか（C-159）。
   * 覆う・覆わないを決めるのは実寸を測っている操作パネルなので、そこから受け取る。
   * ここではルーペの置き場所にだけ使う。
   */
  const [paletteCover, setPaletteCover] = useState<PaletteCover | null>(null);
  /** 盤面領域の画面上の位置（C-198）。数字ボタンとの重なりはここを基準に測る */
  const [frameRect, setFrameRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** 数字ボタンの大きさを決めている最中か（C-190）。押しているあいだ実物の姿で見せる */
  const [sizePreview, setSizePreview] = useState(false);
  /**
   * 数字ボタンが盤面を覆った量を記録に残す（C-196）
   *
   * ルーペが逃げるかどうかはこの値で決まる。**覆っていないと判じていれば逃げようがない。**
   * 変わった瞬間だけ控える。
   */
  const lastCoverRef = useRef<string>('');

  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  /**
   * 「音を鳴らしますか？」（⑧ / C-180）
   *
   * MOMO Hanafuda v1.90 と同じ流儀。**起動した瞬間には出さず、最初の操作で出す**
   * （その操作は捨てずにやり直す）。**1時間以上ぶりに戻ったときも訊き直す。**
   * 出しどきの判断は `useSoundGate` に閉じており、ここは返事の中身だけを持つ。
   */
  const soundGate = useSoundGate();
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextToastId = useRef(1);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /**
   * 効果音と触覚（11.7 / 15.10）。**局をまたいで1つだけ持つ。**
   * 音源の方式はこの中に隠れており、ここからは契機を渡すだけである（U-18）。
   */
  const feedbackRef = useRef<FeedbackController | null>(null);
  if (feedbackRef.current === null) feedbackRef.current = createFeedback();
  const feedback = feedbackRef.current;
  const activeRef = useRef<Active | null>(active);
  activeRef.current = active;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const noteModeRef = useRef(noteMode);
  noteModeRef.current = noteMode;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const pushToast = useCallback((messageKey: string, kind: ToastKind, detail?: string) => {
    const id = nextToastId.current++;
    setToasts((prev) => [...prev, { id, kind, messageKey, detail }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  /**
   * 失敗をユーザーへ知らせる。
   *
   * ふだんは種別に応じた決まり文句だけを出す。**`?debug=1` のときに限り、
   * その1件が何だったのかを添える**（C-168）。ふつうに遊ぶ人には意味が無く、
   * 追跡するときには決まり文句だけでは何も分からないためである。
   */
  const reportError = useCallback(
    (error: DataError) => {
      const toast = TOAST_OF_ERROR[error.kind];
      pushToast(toast.key, toast.kind, diagnostics.isDebugMode() ? error.message : undefined);
    },
    [pushToast],
  );

  // ---------------------------------------------------------------- 起動シーケンス（2.4）

  /** [3] マニフェスト取得。失敗時は退避マニフェストを使う（第1分冊 3.9.3） */
  const loadManifest = useCallback(async (): Promise<Manifest | null> => {
    setDataState('loading');
    const result = await manifestService.load();
    const manifest: Manifest | null = result.ok ? result.value : manifestService.loadCached();

    if (manifest === null) {
      setReleasedSizes(new Set());
      setDataState('unavailable');
      return null;
    }

    const released = new Set(manifestService.releasedSizes(manifest));
    setReleasedSizes(released);
    setDataState('ready');

    // オフラインで手元にチャンクが無いサイズは選べない（第1分冊 3.9.3）
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const blocked = new Set<BoardSize>();
      for (const n of released) {
        const cached = await chunkLoader.listCached(n);
        if (cached.length === 0) blocked.add(n);
      }
      setOfflineSizes(blocked);
    } else {
      setOfflineSizes(new Set());
    }
    return manifest;
  }, []);

  // ---------------------------------------------------------------- 出題と再開

  /**
   * セッションを画面へ載せる。盤面の寸法はマウント後の通知で確定する（3.6）。
   *
   * `restoreZoom` は**中断からの再開のときだけ真**である。
   * 新規出題の初期表示は常に fit倍率とする（C-48 / 5.3）。
   */
  const enterPlay = useCallback(
    (session: sessionModule.SessionState, restoreZoom = false) => {
      const layout = createLayout(session.board.n);
      // 選択・メモモード・入力途中は局ごとに白紙から始める（9.2 の「再開時は OFF」を含む）
      setSelected(null);
      setNoteMode(false);
      setPending(null);
      setActive({
        session,
        layout,
        viewport: initialViewport(layout, 1, 1),
        lod: 'FULL',
        pendingZoomRatio: restoreZoom ? settingsRef.current.zoomPreference : null,
      });
    },
    [],
  );

  /** 元問題を id から引き当てる（第1分冊 3.7 手順[1]）。索引の id 範囲から所在チャンクを絞る */
  const findPuzzle = useCallback(
    async (n: BoardSize, id: string): Promise<Puzzle | null> => {
      const index = await indexLoader.load(n);
      if (!index.ok) return null;

      const summary = index.value.chunks.find(
        (chunk) => id >= chunk.idRange[0] && id <= chunk.idRange[1],
      );
      if (!summary) return null;

      const chunk = await chunkLoader.load(n, summary.file);
      if (!chunk.ok) return null;
      return chunk.value.puzzles.find((puzzle) => puzzle.id === id) ?? null;
    },
    [],
  );

  /** 新規出題（2.5 `TITLE → PLAY`）。失敗は結果を通知してタイトルに留まる（12.4） */
  const startNewGame = useCallback(
    async (n: BoardSize, difficulty: Difficulty) => {
      setPreparing(true);
      try {
        const index = await indexLoader.load(n);
        if (!index.ok) {
          reportError(index.error);
          return;
        }

        const candidates = indexLoader.filterChunks(index.value, difficulty);
        const chunk = await chunkLoader.acquire(n, candidates.chunks);
        if (!chunk.ok) {
          reportError(chunk.error);
          return;
        }

        const picked = pick({
          puzzles: chunk.value.puzzles,
          difficulty,
          recentIds: recentStore.list(n),
        });
        if (!picked.ok) {
          reportError(picked.error);
          return;
        }

        const puzzle = picked.value.puzzle;
        const params = randomParams(puzzle.n, puzzle.b);
        const session = sessionModule.begin({
          puzzle,
          // **選んだ難易度をそのまま渡す**（C-178）。在庫が無くて別の格付けの問題が
          // 返ってきても、遊ぶ決まりと成績は利用者が選んだ難易度に従う
          difficulty,
          params,
          undoLimit: settingsRef.current.undoLimit,
        });
        if (!session.ok) {
          reportError(session.error);
          return;
        }

        // 出題が確定した。既出へ積み、既存の中断を捨てる（第2分冊 12.3 / 8.3）
        const pushed = recentStore.push(n, puzzle.id);
        if (!pushed.ok) reportError(pushed.error);
        sessionStore.clear();
        setHasSuspended(false);

        // **プレイ回数はここで数える**（3.10 / C-206）。始めた1回であり、
        // 最後まで解くかどうかとは関係しない。**再開のときは数えない**
        const counted = statsStore.countPlay(`${n}:${difficulty}`);
        if (!counted.ok) reportError(counted.error);
        else setStats(counted.value);

        enterPlay(session.value);
      } finally {
        setPreparing(false);
      }
    },
    [enterPlay, reportError],
  );

  /** 中断からの再開（C-38）。失敗したら通知せずタイトルへ戻る（C-40 / 12.4） */
  const resumeSuspended = useCallback(async () => {
    const suspended = sessionStore.load();
    if (suspended === null) return;

    setPreparing(true);
    try {
      const puzzle = await findPuzzle(suspended.n, suspended.sourceId);
      if (puzzle === null) {
        sessionStore.clear();
        setHasSuspended(false);
        return;
      }

      const session = sessionModule.resume({
        suspended,
        puzzle,
        undoLimit: settingsRef.current.undoLimit,
      });
      if (!session.ok) {
        // 自動破棄は通知しない（C-40）
        sessionStore.clear();
        setHasSuspended(false);
        return;
      }
      // **「前回の続きから」は全体表示で始める**（C-193・利用者の指示）。
      // 前回いじった倍率のまま開くと、どこを見ているのか分からないところから再開になる
      enterPlay(session.value, false);
    } finally {
      setPreparing(false);
    }
  }, [enterPlay, findPuzzle]);

  useEffect(() => {
    // [1] 設定の読み出し（失敗時は既定値で継続）
    const loaded = settingsStore.load();

    // [2] 言語の適用と初回描画。モードの正本は共通ライブラリ側にある
    const resolved = initLocale();
    setMode(currentMode());
    setLocaleCode(resolved);
    setSettings(loaded.locale === resolved ? loaded : { ...loaded, locale: resolved });
    if (loaded.locale !== resolved) settingsStore.save({ ...loaded, locale: resolved });

    setStats(statsStore.load());
    const suspended = sessionStore.exists();
    setHasSuspended(suspended);

    // [3] 取得完了を待たずに初回描画を出す。[4] 中断があれば確認なしで再開する（C-38）
    void loadManifest().then((manifest) => {
      if (manifest !== null && suspended) void resumeSuspended();
    });

    return locale.subscribe((code) => setLocaleCode(code));
  }, [loadManifest, resumeSuspended]);

  // ---------------------------------------------------------------- 完成・失敗の提示

  /** 完成していれば結果を確定して提示する（11.4 / 第2分冊 10.4） */
  const settleIfComplete = useCallback(
    (session: sessionModule.SessionState): boolean => {
      if (!isComplete(session.board)) return false;

      const result = sessionModule.complete(session);
      if (result === null) return false;

      const before = statsStore.load();
      const key = `${result.n}:${result.difficulty}` as const;
      const previousBest = before.entries[key]?.bestTimeMs ?? null;
      const recorded = statsStore.record(result);
      if (!recorded.ok) reportError(recorded.error);
      else setStats(recorded.value);

      const best =
        result.completed &&
        !result.failed &&
        (previousBest === null || result.elapsedMs < previousBest);

      sessionStore.clear();
      setHasSuspended(false);
      setDialog({ kind: 'complete', result, best });
      // **完成を検知した瞬間を残す**（C-179）。音が鳴り始めた時刻との差が、遅れの正体である
      diagnostics.recordEvent('完成を検知（パネル表示）');
      feedback.fire('COMPLETED');
      return true;
    },
    [feedback, reportError],
  );

  // **入力のたびに走らせる**（U-45）。完成の定義はドメイン層の1箇所にあり、ここでは数え直さない
  useEffect(() => {
    if (active !== null) settleIfComplete(active.session);
  }, [active, revision, settleIfComplete]);

  // ---------------------------------------------------------------- 入力（8章）

  /**
   * 値を1つ入れる（8.7）。メモON なら候補の反転になる。
   *
   * 失敗到達（11.3）はここで拾う。**完成の提示はここでは行わない。**
   * 盤面が変わったことを伝えれば、完成判定は上の効果が拾う（U-45）。
   * 二重に呼ぶと経路が2つになり、どちらが効いているか分からなくなる。
   * **入力そのものは失敗後も制限しない**（5.5）。
   */
  const applyInput = useCallback(
    (index: number, value: number) => {
      const current = activeRef.current;
      if (current === null) return;

      if (noteModeRef.current) {
        sessionModule.toggleNote(current.session, index, value);
        bump();
        return;
      }

      const outcome = sessionModule.input(current.session, index, value);
      if (outcome.ignored) {
        bump();
        return;
      }

      /**
       * **音は盤面の書き換えより先に頼む**（C-202・利用者の指示）。
       *
       * 盤面が変わったと伝えた時点で描き直しの段取りが始まるので、音を後ろに置くと
       * そのぶん出遅れる。契機は2つ続けて渡すだけでよく（11.7.1）、
       * **打ち切りの判断は音の側が持つ**ので、ここに「誤りなら入力音を鳴らさない」
       * という条件分岐は書かない。
       */
      feedback.fire('VALUE_COMMITTED');
      if (outcome.wasMistake) feedback.fire('MISTAKE_DETECTED');
      if (outcome.justFailed) feedback.fire('FAILED');

      bump();
      if (outcome.justFailed) setDialog({ kind: 'failed' });
    },
    [bump, feedback],
  );

  /** 消去（8.6）。メモON なら**そのセルの候補をすべて消す。確定値は消さない**（9.2） */
  const applyErase = useCallback(
    (index: number) => {
      const current = activeRef.current;
      if (current === null) return;
      if (noteModeRef.current) sessionModule.clearNotes(current.session, index);
      else sessionModule.erase(current.session, index);
      bump();
    },
    [bump],
  );

  /**
   * 確定前のバッファを確定する（8.5.1）。**`0` だけのときは消去として扱う。**
   * 選択の変更・他の操作の直前にも呼ぶ。打った内容を捨てないためである
   * （仕様書は取り消しの手段を定めていないので、確定側へ寄せる）。
   */
  const commitPending = useCallback(
    (buffer: { index: number; text: string } | null) => {
      setPending(null);
      if (buffer === null || buffer.text === '') return;
      const value = Number(buffer.text);
      if (value === 0) applyErase(buffer.index);
      else applyInput(buffer.index, value);
    },
    [applyErase, applyInput],
  );

  /**
   * 数字キー1つを処理する（8.5.1）。**サイズ別の分岐を持たない。**
   * 「2桁になりえない値は即確定、なりえる値だけ待つ」という1つの規則で、
   * 9×9 以下では待ちが一度も起きず、25×25 では `1` だけが待つ、という結果になる。
   */
  const pushDigit = useCallback(
    (index: number, buffer: string, digit: string) => {
      const current = activeRef.current;
      if (current === null) return;

      const step = resolveDigit(current.session.board.n, buffer, digit);
      switch (step.kind) {
        case 'IGNORE':
          return;
        case 'COMMIT':
          commitPending({ index, text: step.text });
          return;
        case 'COMMIT_AND_RESTART':
          commitPending({ index, text: step.text });
          pushDigit(index, '', step.digit);
          return;
        case 'WAIT':
          // **時間では確定しない**（C-183）。次の桁・選択の移動・Enter のいずれかを待つ
          setPending({ index, text: step.text });
          return;
      }
    },
    [commitPending],
  );

  /** 選択を変える（8.3）。**盤面外は解除**。打ちかけがあれば先に確定させる */
  const onSelectCell = useCallback(
    (index: number | null) => {
      const buffer = pendingRef.current;
      if (buffer !== null && buffer.index !== index) commitPending(buffer);
      setSelected(index);
      // 手で縮めていたぶんはここで解除する（C-204）。**指定は次の1マスぶんだけ持つ**
      setPaletteCollapsed(false);
      // 解除（null）では上書きしない。**最後に選んだマスを覚えておく**ためである（C-185）
      if (index !== null) setLastSelected(index);
    },
    [commitPending],
  );

  /** マウスが盤面の上を動いた（C-185）。盤面の外へ出たら `null` が来る */
  const onHoverCell = useCallback((index: number | null) => setHovered(index), []);

  const onDismissHint = useCallback(
    (index: number) => {
      const current = activeRef.current;
      if (current === null) return;
      sessionModule.dismissHint(current.session, index);
      bump();
    },
    [bump],
  );

  /** ヒント（C-45）。**選択があればモードA、無ければモードB**。ボタンは1つである */
  const onHint = useCallback(() => {
    const current = activeRef.current;
    if (current === null) return;
    commitPending(pendingRef.current);
    const outcome = sessionModule.requestHint(current.session, selectedRef.current);
    bump();
    // 無効操作（対象なし・提示済み）では鳴らさない。押した手応えではなく提示の合図である
    if (!outcome.ignored) feedback.fire('HINT_SHOWN');
  }, [bump, commitPending, feedback]);

  const onUndo = useCallback(() => {
    const current = activeRef.current;
    if (current === null) return;
    commitPending(pendingRef.current);
    sessionModule.undo(current.session);
    bump();
  }, [bump, commitPending]);

  const onRedo = useCallback(() => {
    const current = activeRef.current;
    if (current === null) return;
    commitPending(pendingRef.current);
    sessionModule.redo(current.session);
    bump();
  }, [bump, commitPending]);

  const onPaletteInput = useCallback(
    (value: number) => {
      const index = selectedRef.current;
      if (index === null) return;
      // パレットは即時確定である。打ちかけがあれば先に片付ける
      commitPending(pendingRef.current);
      applyInput(index, value);
    },
    [applyInput, commitPending],
  );

  const onEraseButton = useCallback(() => {
    const index = selectedRef.current;
    if (index === null) return;
    commitPending(pendingRef.current);
    applyErase(index);
  }, [applyErase, commitPending]);

  const onToggleNoteMode = useCallback(() => {
    commitPending(pendingRef.current);
    setNoteMode((prev) => !prev);
  }, [commitPending]);

  // ---------------------------------------------------------------- キーボード（8.5）

  useEffect(() => {
    if (active === null || dialog !== null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const current = activeRef.current;
      if (current === null) return;
      const n = current.session.board.n;
      const index = selectedRef.current;
      const buffer = pendingRef.current;

      // 取消・やり直しは修飾キーつき。**先に見る**（`Z` は数字ではないが順序を明示しておく）
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          onUndo();
        } else if ((key === 'z' && event.shiftKey) || key === 'y') {
          event.preventDefault();
          onRedo();
        }
        return;
      }

      if (event.key >= '0' && event.key <= '9') {
        if (index === null) return;
        event.preventDefault();
        pushDigit(index, buffer !== null && buffer.index === index ? buffer.text : '', event.key);
        return;
      }

      switch (event.key) {
        case 'Enter':
          // [3] 明示の確定。待ち時間を飛ばすための近道である
          if (buffer !== null) {
            event.preventDefault();
            commitPending(buffer);
          }
          return;
        case 'Backspace':
        case 'Delete':
          if (index === null) return;
          event.preventDefault();
          commitPending(null);
          applyErase(index);
          return;
        case 'Escape':
          event.preventDefault();
          onSelectCell(null);
          return;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault();
          // 未選択のときは左上から始める。盤の外へは出ない
          if (index === null) {
            onSelectCell(0);
            return;
          }
          const row = Math.floor(index / n);
          const col = index % n;
          const dRow = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
          const dCol = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
          const nextRow = Math.min(n - 1, Math.max(0, row + dRow));
          const nextCol = Math.min(n - 1, Math.max(0, col + dCol));
          onSelectCell(nextRow * n + nextCol);
          return;
        }
        case 'm':
        case 'M':
          // メモは Easy では存在しない（C-53）。キーも同じ扱いにする
          if (current.session.board.difficulty === 'Easy') return;
          event.preventDefault();
          onToggleNoteMode();
          return;
        case 'h':
        case 'H':
          event.preventDefault();
          onHint();
          return;
        default:
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    active,
    dialog,
    applyErase,
    commitPending,
    onHint,
    onRedo,
    onSelectCell,
    onToggleNoteMode,
    onUndo,
    pushDigit,
  ]);


  // ---------------------------------------------------------------- 経過時間と可視性（11.1 / 15.8）

  useEffect(() => {
    if (active === null || dialog?.kind === 'complete') return;
    const timer = setInterval(() => setTick((prev) => prev + 1), TIMER_TICK_MS);
    return () => clearInterval(timer);
  }, [active, dialog]);

  /** 中断保存は同期で行う。`pagehide` は待ってもらえない（第1分冊 3.6.1 / 3.6.4） */
  const saveSuspended = useCallback(() => {
    const current = activeRef.current;
    if (current === null) return;
    if (sessionModule.phase(current.session) === 'COMPLETED') return;
    const written = sessionStore.save(sessionModule.toSuspended(current.session));
    if (written.ok) setHasSuspended(true);
  }, []);

  // 音・触覚の設定は変わった時点で音の側へ渡す（15.10）。切ったのに鳴り続けないようにする
  useEffect(() => feedback.applySettings(settings), [feedback, settings]);

  useEffect(() => {
    const onHidden = () => {
      const current = activeRef.current;
      if (current !== null) sessionModule.pause(current.session);
      // 隠れた瞬間に鳴っている音を打ち切る（11.7.4）
      feedback.suspend();
      saveSuspended();
    };
    const onVisible = () => {
      const current = activeRef.current;
      if (current !== null) sessionModule.unpause(current.session);
      setTick((prev) => prev + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHidden();
      else onVisible();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHidden);
    };
  }, [feedback, saveSuspended]);

  // ---------------------------------------------------------------- 設定の更新（3.6.3 即時永続化）

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        const written = settingsStore.save(next);
        if (!written.ok) reportError(written.error);
        return next;
      });
    },
    [reportError],
  );

  const onChangeMode = useCallback(
    (next: LocaleMode) => {
      const resolved = changeMode(next);
      setMode(next);
      setLocaleCode(resolved);
      updateSettings({ locale: resolved });
    },
    [updateSettings],
  );

  // ---------------------------------------------------------------- タイトルビューの操作

  const size: BoardSize =
    settings.lastSize !== null && releasedSizes.has(settings.lastSize)
      ? settings.lastSize
      : releasedSizes.has(DEFAULT_SIZE)
        ? DEFAULT_SIZE
        : (([...releasedSizes][0] ?? DEFAULT_SIZE) as BoardSize);

  const difficulty: Difficulty = settings.lastDifficulty ?? DEFAULT_DIFFICULTY;

  const selectableSizes = new Set(
    BOARD_SIZES.filter((n) => releasedSizes.has(n) && !offlineSizes.has(n)),
  );

  const sizeReason = useCallback(
    (n: BoardSize): 'locked' | 'offline' => (releasedSizes.has(n) ? 'offline' : 'locked'),
    [releasedSizes],
  );

  const onExport = useCallback(async () => {
    const result = await transferService.export();
    if (result.ok) pushToast('toast.exported', 'info');
    else reportError(result.error);
  }, [pushToast, reportError]);

  /** 検証を通ったときだけ上書き確認へ進む。承諾までは既存データを変えない（2.8 / 3.7.5） */
  const onPickFile = useCallback(
    async (file: File) => {
      const checked = await transferService.read(file);
      if (!checked.ok) {
        pushToast('toast.importInvalid', 'error');
        return;
      }
      setDialog({ kind: 'import', bundle: checked.value });
    },
    [pushToast],
  );

  const applyImport = useCallback(
    (bundle: ExportBundle) => {
      setDialog(null);
      transferService.apply(bundle);

      // 設定・成績・既出・中断がすべて置き換わるため、タイトルビューを組み直す（2.8）
      const reloaded = settingsStore.load();
      setSettings(reloaded);
      setStats(statsStore.load());
      setHasSuspended(sessionStore.exists());
      const resolved = changeMode(reloaded.locale);
      setMode(currentMode());
      setLocaleCode(resolved);
      pushToast('toast.imported', 'info');

      // **読み込んだ中断があれば、そのままゲーム画面を開く**（C-193・利用者の指示）。
      // 読み込みは「続きを持ってくる」操作なので、タイトルで止まる理由が無い
      if (sessionStore.exists()) void resumeSuspended();
    },
    [pushToast, resumeSuspended],
  );

  const onNew = useCallback(() => {
    if (hasSuspended) setDialog({ kind: 'discard' });
    else void startNewGame(size, difficulty);
  }, [difficulty, hasSuspended, size, startNewGame]);

  const onDiscardAndStart = useCallback(() => {
    sessionStore.clear();
    setHasSuspended(false);
    setDialog(null);
    void startNewGame(size, difficulty);
  }, [difficulty, size, startNewGame]);

  // ---------------------------------------------------------------- プレイビューの操作

  /** 中断して戻る（2.5）。中断保存・タイマ停止・盤面の破棄を行う */
  const onSuspend = useCallback(() => {
    // 打ちかけを捨てずに保存へ含める
    commitPending(pendingRef.current);
    saveSuspended();
    const current = activeRef.current;
    if (current !== null) sessionModule.release(current.session);
    setActive(null);
  }, [saveSuspended]);

  const onCloseComplete = useCallback(
    (again: boolean) => {
      const current = activeRef.current;
      const n = current?.session.board.n ?? size;
      const nextDifficulty = current?.session.board.difficulty ?? difficulty;
      setDialog(null);
      setActive(null);
      if (again) void startNewGame(n, nextDifficulty);
    },
    [difficulty, size, startNewGame],
  );

  /**
   * 盤面領域の寸法変更（3.6）。**倍率の復元もここで行う。**
   *
   * 盤面の実寸はマウント後に初めて分かるので、`fitZoom` に対する比を掛けられるのも
   * ここが最初である（5.3）。復元は1回きりで、以後は通常の寸法追随になる。
   */
  const onBoardResize = useCallback((width: number, height: number) => {
    setActive((prev) => {
      if (prev === null) return prev;
      // 盤面の実寸が分かる前は 1×1px の仮置きなので、**最初の1回は仮置きを捨てて組み直す**。
      // 段階7 までは「fit倍率を下回ったら引き上げる」規則がこれを兼ねていたが、
      // どこまでも縮小できるようになって（C-167）その規則を外したため、ここで受ける。
      const resized =
        prev.viewport.width <= 1 || prev.viewport.height <= 1
          ? initialViewport(prev.layout, width, height)
          : resizeViewport(prev.viewport, prev.layout, width, height);
      const ratio = prev.pendingZoomRatio;
      if (ratio === null) return withViewport(prev, resized);

      const fit = fitOf(prev.layout, width, height);
      const restored = zoomTo(resized, prev.layout, fit * ratio);
      return { ...withViewport(prev, restored), pendingZoomRatio: null };
    });
  }, []);

  /** ズーム・パンの結果を受ける（5.5）。盤面のジェスチャも操作パネルも同じ窓口を通る */
  const onViewportChange = useCallback((next: ViewportState) => {
    setActive((prev) => (prev === null ? prev : withViewport(prev, next)));
  }, []);

  /**
   * 倍率を設定へ書き出す（5.3）。**絶対倍率ではなく fit倍率に対する比**で保存する。
   * 絶対値で持つと、サイズや画面寸法が変わったときに意味を失う。
   * 操作中は書かず、手が止まってから1回だけ書く。
   */
  const zoomRatio =
    active === null
      ? null
      : active.viewport.width > 0
        ? active.viewport.zoom /
          fitOf(active.layout, active.viewport.width, active.viewport.height)
        : null;

  useEffect(() => {
    if (zoomRatio === null) return;
    const timer = setTimeout(() => {
      if (settingsRef.current.zoomPreference !== zoomRatio) updateSettings({ zoomPreference: zoomRatio });
    }, ZOOM_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [zoomRatio, updateSettings]);

  // 描画モデルは変化時のみ作る（3.4）。**盤面の変化は `revision` で伝わる**（U-45）
  /** 盤面領域の中で、数字ボタンにかぶられている部分（C-198） */
  const boardCover = useMemo(() => coverRect(paletteCover, frameRect), [paletteCover, frameRect]);

  /**
   * ルーペの状態（C-189）。**描画と操作部で同じものを使う。**
   * 別々に作ると、箱の位置と＋−ボタンの位置がずれる。
   */
  const loupe = useMemo(
    () => (active === null ? null : loupeState(active, hovered, lastSelected, boardCover, settings)),
    [active, boardCover, hovered, lastSelected, settings],
  );

  /** いまの倍率が刻みの何番目か。近いものを採る（設定が壊れていても落ちない） */
  const spanIndex = useMemo(() => {
    let best = 0;
    for (let i = 1; i < LOUPE_SPANS.length; i++) {
      if (Math.abs(LOUPE_SPANS[i] - settings.loupeSpan) < Math.abs(LOUPE_SPANS[best] - settings.loupeSpan)) best = i;
    }
    return best;
  }, [settings.loupeSpan]);

  /** ルーペの開閉と倍率。**設定に書くので次回も同じ状態で始まる**（C-189） */
  const onToggleLoupe = useCallback(
    () => updateSettings({ loupeOpen: !settingsRef.current.loupeOpen }),
    [updateSettings],
  );
  const stepLoupe = useCallback(
    (direction: 1 | -1) => {
      // **刻みの後ろほど狭い＝拡大**である。`＋` は後ろへ、`−` は前へ動く
      let index = 0;
      for (let i = 1; i < LOUPE_SPANS.length; i++) {
        const current = settingsRef.current.loupeSpan;
        if (Math.abs(LOUPE_SPANS[i] - current) < Math.abs(LOUPE_SPANS[index] - current)) index = i;
      }
      const next = Math.min(LOUPE_SPANS.length - 1, Math.max(0, index + direction));
      updateSettings({ loupeSpan: LOUPE_SPANS[next] });
    },
    [updateSettings],
  );

  useEffect(() => {
    const key =
      boardCover === null
        ? 'なし'
        : `(${Math.round(boardCover.x)},${Math.round(boardCover.y)}) ${Math.round(boardCover.w)}x${Math.round(boardCover.h)}`;
    if (key === lastCoverRef.current) return;
    lastCoverRef.current = key;
    const p = paletteCover;
    const f = frameRect;
    diagnostics.recordEvent(
      '数字ボタンの覆い',
      `かぶり=${key}` +
        (p ? ` ボタン(${Math.round(p.left)},${Math.round(p.top)})${Math.round(p.width)}x${Math.round(p.height)}` : ' ボタン=不明') +
        (f ? ` 盤面(${Math.round(f.left)},${Math.round(f.top)})${Math.round(f.width)}x${Math.round(f.height)}` : ' 盤面=不明'),
    );
  }, [boardCover, paletteCover, frameRect]);

  const model: RenderModel | null = useMemo(() => {
    if (active === null) return null;
    const { session, viewport } = active;
    return {
      n: session.board.n,
      b: session.board.b,
      givens: session.board.given,
      entered: session.board.entered,
      errorFlags: session.board.errorFlags,
      notes: session.board.notes,
      selected,
      pendingInput: pending,
      hints: [...session.hint.displays],
      viewport,
      lod: active.lod,
      loupe,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, revision, selected, pending, paletteCover, hovered, lastSelected, settings]);

  /** 値ごとの残数はドメイン層が数えたものを写すだけである（C-119）。UI は盤面を走査しない */
  const exhausted: readonly boolean[] = useMemo(() => {
    if (active === null) return [];
    return boardSummary(active.session.board).remainingByValue.map((rest) => rest === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, revision]);

  /** 選択セルの区分。活性条件（8.6）の判定に用いる */
  const selectedView = useMemo(() => {
    if (active === null || selected === null) return null;
    return board.cellState(active.session.board, selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, revision, selected]);

  const inPlay = active !== null && model !== null;

  /** 器の高さは実測に従わせる（C-207）。宣言に任せると携帯の横画面で下がはみ出す */
  useAppHeight();
  /** 画面を寝かせないのは**プレイ画面のあいだだけ**（C-209・利用者の指示） */
  useWakeLock(inPlay && settings.keepAwake);

  return (
    <div className="app">
      <Header
        locale={localeCode}
        mode={mode}
        onChangeMode={onChangeMode}
        settings={settings}
        onChangeSettings={updateSettings}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
        onCloseSettings={() => setSettingsOpen(false)}
        onPreviewSound={() => feedback.preview()}
        onSizePreview={setSizePreview}
        status={
          // 遊んでいるあいだだけ、タイトルの横に状態を出す（⑪）。
          // **ヘッダーは常に画面の上端にある**ので、スクロールで消えることが無い
          inPlay ? (
            <StatusBar
              n={active.session.board.n}
              difficulty={active.session.board.difficulty}
              mistakeCount={active.session.mistake.count}
              mistakeLimit={active.session.mistake.limit}
              failed={active.session.mistake.failed}
              elapsedMs={elapsedOf(active.session.timer)}
            />
          ) : undefined
        }
      />

      {inPlay ? (
        <PlayView
          n={active.session.board.n}
          b={active.session.board.b}
          difficulty={active.session.board.difficulty}
          model={model}
          layout={active.layout}
          onResize={onBoardResize}
          onSelectCell={onSelectCell}
          onDismissHint={onDismissHint}
          onHoverCell={onHoverCell}
          onFrameRect={setFrameRect}
          paletteScale={settings.paletteScale}
          paletteSizePreview={sizePreview}
          paletteCollapsed={paletteCollapsed}
          onTogglePaletteCollapsed={() => setPaletteCollapsed((prev) => !prev)}
          loupe={{
            homeCorner: settings.loupeCorner,
            open: settings.loupeOpen,
            corner: loupe?.corner ?? null,
            onToggle: onToggleLoupe,
            onZoomIn: () => stepLoupe(1),
            onZoomOut: () => stepLoupe(-1),
            canZoomIn: spanIndex < LOUPE_SPANS.length - 1,
            canZoomOut: spanIndex > 0,
          }}
          onViewportChange={onViewportChange}
          onPaletteCoveringChange={setPaletteCover}
          exhausted={exhausted}
          noteMode={noteMode}
          canUndo={sessionModule.canUndo(active.session)}
          canRedo={sessionModule.canRedo(active.session)}
          selected={selected}
          selectedIsGiven={selectedView?.kind === 'GIVEN'}
          selectedHasValue={selectedView !== null && selectedView.value !== 0}
          selectedHasNotes={selectedView !== null && selectedView.notes.length > 0}
          onInput={onPaletteInput}
          onErase={onEraseButton}
          onToggleNoteMode={onToggleNoteMode}
          onUndo={onUndo}
          onRedo={onRedo}
          onHint={onHint}
          onSuspend={onSuspend}
        />
      ) : (
        <TitleView
          dataState={dataState}
          preparing={preparing}
          onRetryData={() => void loadManifest()}
          selectableSizes={selectableSizes}
          sizeReason={sizeReason}
          size={size}
          onChangeSize={(n) => updateSettings({ lastSize: n })}
          difficulty={difficulty}
          onChangeDifficulty={(next) => updateSettings({ lastDifficulty: next })}
          hasSuspended={hasSuspended}
          onResume={() => void resumeSuspended()}
          onNew={onNew}
          stats={stats}
          onExport={() => void onExport()}
          onPickFile={(file) => void onPickFile(file)}
        />
      )}

      {soundGate.asking && (
        <Dialog
          title={t('dialog.sound.title')}
          body={t('dialog.sound.body')}
          defaultIndex={1}
          actions={[
            {
              label: t('dialog.sound.no'),
              onSelect: () => {
                updateSettings({ soundEnabled: false, hapticEnabled: false });
                soundGate.answer();
              },
            },
            {
              label: t('dialog.sound.yes'),
              onSelect: () => {
                updateSettings({ soundEnabled: true, hapticEnabled: true });
                soundGate.answer();
                // **鳴らしてよいと分かった今のうちに、全部取りに行かせる**（C-179）。
                // 完成音は1局に1度しか鳴らず、そのままだと鳴らす瞬間が毎回初回になる。
                // **試聴より先に頼む**（C-202）。展開はここから始まるので、早いほどよい
                feedback.warm();
                // 押した瞬間が「人が触った」合図になる。ここで一度鳴らして、
                // 以後ふつうに鳴らせる状態にしておく
                feedback.preview();
              },
            },
          ]}
        >
          <div className="settings-row">
            <span>{t('settings.sound.volume')}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.soundVolume * 100)}
              aria-label={t('settings.sound.volume')}
              onChange={(event) =>
                updateSettings({ soundVolume: Number(event.target.value) / 100 })
              }
            />
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'discard' && (
        <Dialog
          title={t('dialog.discard.title')}
          body={t('dialog.discard.body')}
          defaultIndex={0}
          actions={[
            { label: t('common.cancel'), onSelect: () => setDialog(null) },
            { label: t('dialog.discard.confirm'), onSelect: onDiscardAndStart, destructive: true },
          ]}
        />
      )}

      {dialog?.kind === 'import' && (
        <Dialog
          title={t('dialog.import.title')}
          body={t('dialog.import.body')}
          defaultIndex={0}
          actions={[
            { label: t('common.cancel'), onSelect: () => setDialog(null) },
            {
              label: t('dialog.import.confirm'),
              onSelect: () => applyImport(dialog.bundle),
              destructive: true,
            },
          ]}
        />
      )}

      {dialog?.kind === 'failed' && (
        <Dialog
          title={t('dialog.failed.title')}
          body={t('dialog.failed.body')}
          defaultIndex={0}
          actions={[{ label: t('dialog.failed.confirm'), onSelect: () => setDialog(null) }]}
        />
      )}

      {dialog?.kind === 'complete' && (
        <Dialog
          title={t('dialog.complete.title')}
          defaultIndex={1}
          actions={[
            { label: t('dialog.complete.again'), onSelect: () => onCloseComplete(true) },
            { label: t('dialog.complete.toTitle'), onSelect: () => onCloseComplete(false) },
          ]}
        >
          <CompleteSummary result={dialog.result} best={dialog.best} />
        </Dialog>
      )}

      <Toast items={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/** 完成ダイアログの中身（11.4）。表示のみを行い、統計は既に記録済みである */
function CompleteSummary({
  result,
  best,
}: {
  result: SessionResult;
  best: boolean;
}): React.ReactElement {
  const total = Math.floor(result.elapsedMs / 1000);
  const time =
    total >= 3600
      ? `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
      : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

  return (
    <div className="dialog-body">
      {/* 状態表示（11.1）と同じく、サイズと難易度のあいだは空白1文字だけとする */}
      <p>
        {result.n}×{result.n} {result.difficulty}
      </p>
      <p>{t('dialog.complete.time', { time })}</p>
      <p>{t('dialog.complete.mistake', { count: result.mistakeCount })}</p>
      <p>{t('dialog.complete.hint', { count: result.hintUsed })}</p>
      {result.failed && <p>{t('dialog.complete.failedNote')}</p>}
      {best && <p data-testid="best-updated">{t('dialog.complete.best')}</p>}
    </div>
  );
}
