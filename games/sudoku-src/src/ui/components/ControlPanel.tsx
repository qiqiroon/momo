/**
 * 操作パネル（第3分冊 2.9 / 8.6 / C-52 / C-159）
 *
 * 常時表示とし、折りたたみ機構を設けない。**操作はここへ集約する。**
 * 中身はズームバー（5.5）・数値パレット（8.4）・操作ボタン（8.6）。
 *
 * 本部品は表示と通知のみを担い、**遊びの状態は持たない**（15.6）。
 * 例外は自分自身の実寸で、これは 8.4 の「44px を守れるか」の判定に要る。
 */

import { useEffect, useRef, useState } from 'react';
import type { BoardSize, Difficulty } from '../../data/types';
import { cellRect, type BoardLayout } from '../canvas/layout';
import { toScreen, type ViewportState } from '../canvas/viewport';
import { LOUPE_RESERVE_PX, PALETTE_MAX_HEIGHT_RATIO } from '../config';
import { ActionButtons } from './ActionButtons';
import { NumberPalette, keyPxOf, paletteMetrics, paletteMetricsForHeight } from './NumberPalette';
import { ZoomBar } from './ZoomBar';

export interface ControlPanelProps {
  n: BoardSize;
  b: number;
  difficulty: Difficulty;
  /** 各値の残数が 0 か（8.4）。ドメイン層が数えた値を写したもの（C-119） */
  exhausted: readonly boolean[];
  noteMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selected: number | null;
  selectedIsGiven: boolean;
  /** 選択セルに記入値があるか。消去の活性判定に用いる（8.6） */
  selectedHasValue: boolean;
  /** 選択セルに候補があるか。メモON中の消去の活性判定に用いる（9.2） */
  selectedHasNotes: boolean;
  viewport: ViewportState;
  layout: BoardLayout;
  onInput(value: number): void;
  onErase(): void;
  onToggleNoteMode(): void;
  onUndo(): void;
  onRedo(): void;
  onHint(): void;
  onSuspend(): void;
  onZoom(next: ViewportState): void;
  /** 拡大したパレットが盤面のどちら側を覆っているか（C-159）。ルーペの置き場所に効く */
  onCoveringChange(cover: PaletteCover | null): void;
  /** 数字ボタンの大きさの倍率（C-190） */
  paletteScale: number;
  /**
   * 大きさを決めている最中か（C-190）
   *
   * 二段構えのときはふだん縮めた姿で出ているが、**押している最中だけ実物の大きさで見せる**。
   * そうしないと、いま何を決めているのかが見えない（利用者の指示）。
   */
  sizePreview?: boolean;
}

/** 操作パネルの置き場所（C-166） */
export type PanelPlacement = 'BOTTOM' | 'RIGHT';

/**
 * 拡大したパレットが盤面のどちら側を覆っているか。覆っていなければ `null`
 *
 * 右置きでは横へせり出すため、盤面の上下は空いたままである。よって `null` を返す。
 */
export type CoverSide = 'TOP' | 'BOTTOM' | null;

/**
 * 数字ボタンが盤面を覆っている帯（C-191）
 *
 * 段階7 までは「どちら側か」だけを伝えていたが、**ルーペが「覆われ方のいちばん少ない角」へ
 * 逃げる**ようになったため、**どれだけ覆っているか**も要る。面積で比べるからである。
 */
/**
 * 数字ボタンが実際に占めている矩形（画面座標・C-198）
 *
 * **どちら側をどれだけ、という要約はやめた。** 段階7 の「せり上がる帯」だけを見ていたため、
 * **せり上がらない置き方（横長の画面）では覆っていても『なし』と報告していた**
 * （実機の記録で判明）。**実物の矩形を渡し、重なりは受け取った側が測る。**
 */
export interface PaletteCover {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 選んだマスが、せり上がった帯に隠れるか（ユーザー指示）
 *
 * 帯は操作パネルの上端から立ち上がるので、**パネル自身の高さを越えたぶんだけ**が盤面へかかる。
 */
export function hiddenByOverlay(
  viewport: ViewportState,
  layout: BoardLayout,
  selected: number | null,
  overlayHeightPx: number,
  panelUpperHeightPx: number,
): boolean {
  if (selected === null || overlayHeightPx <= 0) return false;
  const coverPx = Math.max(0, overlayHeightPx - panelUpperHeightPx);
  if (coverPx <= 0) return false;
  const cell = cellRect(layout, selected);
  const top = toScreen(viewport, cell.x, cell.y).y;
  return top + cell.h * viewport.zoom > viewport.height - coverPx;
}

/**
 * 上へ逃がせるか（ユーザー指示「無理ならかぶってもよい」）
 *
 * 逃がした先でも**ルーペの帯は残す**。残せないほど帯が高いときは動かさない。
 * 高さを詰めてまで逃がすと、数字ボタンが小さくなって本末転倒になる。
 */
export function canFlipOverlay(viewportHeightPx: number, overlayHeightPx: number): boolean {
  return overlayHeightPx > 0 && overlayHeightPx <= viewportHeightPx - LOUPE_RESERVE_PX;
}

/** 右置きの帯の左右余白（`.control-panel[data-placement='RIGHT']` の padding と同じ値） */
export const RIGHT_PANEL_PADDING_PX = 24;
/**
 * 右置きの帯の最小幅。
 *
 * ズームバーが読めること、**操作ボタンが2つ並ぶこと**が条件である。1列に落ちると
 * ボタンだけで 206px を食い、パレットの居場所が無くなる（2026-08-07 の採寸）。
 */
export const RIGHT_PANEL_MIN_PX = 220;

/**
 * 置き場所は**画面の縦横比だけ**で決まる（C-166）
 *
 * 横長なら右、縦長なら下。横長の画面で下に置くと、高さの取り合いになって盤面が消える
 * （667×375 の 16×16 で盤面 13px という実測がある）。**N による分岐ではない**（B-6）。
 */
export function decidePlacement(windowWidth: number, windowHeight: number): PanelPlacement {
  return windowWidth > windowHeight ? 'RIGHT' : 'BOTTOM';
}

/**
 * 操作パネルが 44px を守ったまま画面に収まるか（U-46 / C-159 / C-166）
 *
 * 収まらない場合だけ二段構えになる。**判定は画面の実寸から出る帰結**であり、
 * N による分岐ではない（B-6）。寸法が測れていないあいだは「収まる」とみなし、
 * 従来どおりの常時表示から始める。
 *
 * `chromePx` は**パレット以外の部分**（ズームバー・操作ボタン・余白）の実寸である。
 * ここを足さずにパレットだけで判じていたのが段階7 の取りこぼしだった。
 */
export function needsTwoStage(
  n: BoardSize,
  b: number,
  placement: PanelPlacement,
  paletteSpanPx: number,
  chromePx: number,
  windowSpanPx: number,
  /** ボタンの大きさの倍率（C-190）。**大きくすれば二段構えに入る**という関係になる */
  keyPx?: number,
): boolean {
  if (paletteSpanPx <= 0 || windowSpanPx <= 0) return false;

  if (placement === 'BOTTOM') {
    const palette = paletteMetrics(n, b, paletteSpanPx, keyPx).heightPx;
    return chromePx + palette > windowSpanPx * PALETTE_MAX_HEIGHT_RATIO;
  }

  // 右置きは**幅と高さの両方**を見る。細い帯に収まっても、縦に入りきらなければ意味が無い。
  const metrics = rightPaletteMetrics(n, b, paletteSpanPx, chromePx, keyPx);
  const tooWide = rightPanelWidth(metrics.widthPx) > windowSpanPx * PALETTE_MAX_HEIGHT_RATIO;
  const tooTall = metrics.heightPx > rightPaletteRoom(paletteSpanPx, chromePx);
  return tooWide || tooTall;
}

/** 右置きでパレットに使える高さ。行の高さから、ズームバーと操作ボタンのぶんを引いた残り */
export function rightPaletteRoom(columnHeightPx: number, chromePx: number): number {
  return Math.max(0, columnHeightPx - chromePx);
}

/**
 * 右置きのパレットの姿（C-166）
 *
 * **「収まる中でいちばん細い」ではなく「残った高さに収まる」列数**を選ぶ。
 * 帯を細くしようと列を減らすと行が増え、ズームバーと操作ボタンに押されて入らなくなる。
 * 高さのほうが先に尽きるので、そちらを条件にする。
 */
export function rightPaletteMetrics(
  n: BoardSize,
  b: number,
  columnHeightPx: number,
  chromePx: number,
  keyPx?: number,
): { columns: number; rows: number; widthPx: number; heightPx: number } {
  return paletteMetricsForHeight(n, b, rightPaletteRoom(columnHeightPx, chromePx), keyPx);
}

/** 右置きの帯の幅。数字ボタンの実寸に左右の余白を足したもので、**下限だけ設ける**（ズームバーが読める幅） */
export function rightPanelWidth(paletteWidthPx: number): number {
  return Math.max(RIGHT_PANEL_MIN_PX, paletteWidthPx + RIGHT_PANEL_PADDING_PX);
}

/** 窓の実寸。SSR や検査環境で `window` が無い場合に備える */
function currentScreen(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/** 要素の実寸を追い続ける。パネルとパレット置き場で同じ手順が要るのでまとめた */
function useObservedSize(
  ref: React.RefObject<HTMLElement | null>,
  set: (size: { width: number; height: number }) => void,
): void {
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      set({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    return () => observer?.disconnect();
    // set は呼び出し側で安定している（useState の設定関数）
  }, [ref, set]);
}

export function ControlPanel(props: ControlPanelProps): React.ReactElement {
  // セル未選択・固定セル選択中は入力できない（8.6）
  const canInput = props.selected !== null && !props.selectedIsGiven;
  // メモON中の消去は「候補の全消去」であり、対象は確定値ではなく候補である（9.2）
  const canErase =
    canInput && (props.noteMode ? props.selectedHasNotes : props.selectedHasValue);

  /** ズームバーとパレットを収める領域。ここの実寸が二段構えの判定と拡大時の上限を決める */
  const upperRef = useRef<HTMLDivElement>(null);
  const [upper, setUpper] = useState({ width: 0, height: 0 });
  /**
   * パネル全体と、パレットだけの置き場。**差がパレット以外の部分（chrome）** である（C-166）。
   *
   * ズームバーを含む `panel-upper` との差で測ると**ズームバーのぶんが chrome から抜け落ちる**。
   * 375×667 の 16×16 で 42px ぶん見落とし、二段構えに入るべきところで常時表示になっていた。
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState({ width: 0, height: 0 });
  const slotRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState({ width: 0, height: 0 });

  useObservedSize(upperRef, setUpper);
  useObservedSize(panelRef, setPanel);
  useObservedSize(slotRef, setSlot);

  /** 画面の向きが変わると置き場所が変わるので、窓の寸法を状態として持つ（C-166） */
  const [screen, setScreen] = useState(() => currentScreen());
  useEffect(() => {
    const onResize = (): void => setScreen(currentScreen());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const placement = decidePlacement(screen.width, screen.height);
  const right = placement === 'RIGHT';

  /**
   * パレット以外の部分（ズームバー・操作ボタン・余白）の高さ。
   *
   * 姿（FULL / MINI）が変わっても動かない。**幅は帯の実寸から先に決めてしまう**ので、
   * 操作ボタンの折り返し方がここへ跳ね返って判定が揺れる、ということも起きない。
   */
  const chromePx = Math.max(0, panel.height - slot.height);
  /** 右置きでは帯として使える高さ（＝盤面と同じ行の高さ）、下置きでは使える幅 */
  const paletteSpanPx = right ? panel.height : slot.width;
  const windowSpanPx = right ? screen.width : screen.height;

  const keyPx = keyPxOf(props.paletteScale);
  const twoStage = needsTwoStage(
    props.n,
    props.b,
    placement,
    paletteSpanPx,
    chromePx,
    windowSpanPx,
    keyPx,
  );
  // **大きさを決めている最中は、二段目に相当する姿で見せる**（C-190・利用者の指示）
  const expanded = twoStage && (canInput || props.sizePreview === true);

  /**
   * 右置きの列数と帯の幅（C-166）。
   *
   * **縦に使える寸法だけから決める。** パネルの幅を見て決めると、操作ボタンの折り返しが幅を変え、
   * その幅がまた列数を変える、という堂々巡りになる。右置きの操作ボタンは2列組みに固定してあり、
   * 高さが幅に左右されないので、ここは一度で落ち着く。
   */
  const rightMetrics = right
    ? rightPaletteMetrics(props.n, props.b, paletteSpanPx, chromePx)
    : null;
  const rightColumns = rightMetrics?.columns;

  /** せり上がった帯の実寸。**選んだマスを隠しているかの判定に要る**（ユーザー指示） */
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState({ width: 0, height: 0 });
  useObservedSize(overlayRef, setOverlay);

  /**
   * 下からせり上がると選んだマスが隠れる場合、**上へ逃がす**（ユーザー指示）。
   * 逃がせないときは覆ったままでよい、というのが明示の了解である。
   * 右置きは横へせり出すので、この逃がしは要らない。
   */
  const flipped =
    expanded &&
    !right &&
    hiddenByOverlay(props.viewport, props.layout, props.selected, overlay.height, upper.height) &&
    canFlipOverlay(props.viewport.height, overlay.height);

  /**
   * 盤面のどこを、どれだけ覆っているか（C-197）
   *
   * 段階7 では「右置きなら上下が空いたままなので知らせることが無い」としていた。
   * **ルーペを画面の中央上下ではなく四隅へ置くようにしたので、この前提が崩れた**
   * （C-185）。右置きの帯はパネルの外へ左へせり出し、**右の角を覆う**。
   * 実機の記録で「覆い なし」と出ていたのはこのためである。
   *
   * 下置き … 帯の高さからパネルの上段ぶんを引いた残りが、盤面へかかる高さ
   * 右置き … 帯の幅からパネル自身の幅を引いた残りが、盤面へかかる幅
   */
  /**
   * いま数字ボタンが占めている矩形を、そのまま知らせる（C-198）。
   * せり上がった帯があればそちら、無ければパネルの中の数字ボタンそのもの。
   */
  const onCoveringChange = props.onCoveringChange;
  useEffect(() => {
    const element = overlayRef.current ?? slotRef.current;
    if (element === null) {
      onCoveringChange(null);
      return;
    }
    const report = (): void => {
      const r = element.getBoundingClientRect();
      onCoveringChange(r.width <= 0 || r.height <= 0
        ? null
        : { left: r.left, top: r.top, width: r.width, height: r.height });
    };
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [onCoveringChange, expanded, twoStage, right, flipped, props.paletteScale, props.n]);

  /**
   * 拡大したパレットの高さの上限。
   *
   * 盤面領域と自分の領域を合わせた高さから、**ルーペの帯だけを必ず残す**（承認済みの手当て）。
   * 上限に達したときだけ内側が縦に送られる。
   */
  // 右置きでは横へ広がるので、高さは自分の領域そのままでよい（ルーペの帯は上下に残る）
  const overlayMaxHeight = right
    ? Math.max(0, panel.height)
    : Math.max(0, props.viewport.height + upper.height - LOUPE_RESERVE_PX);

  const palette = (variant: 'FULL' | 'MINI'): React.ReactElement => (
    <NumberPalette
          scale={props.paletteScale}
      n={props.n}
      b={props.b}
      exhausted={props.exhausted}
      noteMode={props.noteMode}
      disabled={!canInput}
      variant={variant}
      columns={variant === 'FULL' ? rightColumns : undefined}
      onInput={props.onInput}
    />
  );

  return (
    <div
      className="control-panel"
      data-placement={placement}
      ref={panelRef}
      // 二段構えに入ったということは「44px を守った姿は収まらない」ということなので、
      // その幅で帯を広げても盤面を削るだけである。縮んだ姿は最小幅で足りる（C-166）
      style={
        rightMetrics
          ? {
              width: `${twoStage ? RIGHT_PANEL_MIN_PX : rightPanelWidth(rightMetrics.widthPx)}px`,
            }
          : undefined
      }
    >
      <div className="panel-upper" ref={upperRef}>
        <ZoomBar
          viewport={props.viewport}
          layout={props.layout}
          onZoom={props.onZoom}
          selected={props.selected}
        />
        {/* 二段構えのあいだ、パネル側は縮んだ姿のまま置く。**高さが変わらないので盤面の倍率も動かない** */}
        <div className="palette-slot" ref={slotRef}>
          {palette(twoStage ? 'MINI' : 'FULL')}
        </div>
        {expanded && (
          <div
            className="palette-overlay"
            data-testid="palette-overlay"
            data-flipped={flipped ? 'true' : 'false'}
            ref={overlayRef}
            style={
              // 上へ逃がすときは、盤面の上端に合わせて置く。パネルの上端が盤面の下端なので、
              // 盤面の高さぶん上へ出せばちょうど揃う
              flipped
                ? { maxHeight: `${overlayMaxHeight}px`, bottom: 'auto', top: `${-props.viewport.height}px` }
                : { maxHeight: `${overlayMaxHeight}px` }
            }
          >
            {palette('FULL')}
          </div>
        )}
      </div>
      <ActionButtons
        difficulty={props.difficulty}
        noteMode={props.noteMode}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        canErase={canErase}
        canInput={canInput}
        onErase={props.onErase}
        onToggleNoteMode={props.onToggleNoteMode}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onHint={props.onHint}
        onSuspend={props.onSuspend}
      />
    </div>
  );
}
