/**
 * 数値パレット（第3分冊 8.4 / C-51 / C-159）
 *
 * **1〜N のボタンを折り返しグリッドで表示する。** 横スクロールは行わない。
 * 列数は `b` の倍数を優先するが、収まらない場合は幅に従う（8.4）。**サイズ別の表を持たない。**
 * 最小寸法 44×44 CSS px はスタイル側で保証し、収まらないぶんは行数が増える。
 *
 * 「使い切った値」の判定は**ドメイン層が数えた残数**をそのまま写す（C-119）。
 * ここで盤面を走査しない。
 *
 * ---
 *
 * **二段構え（C-159 / U-46 の手当て）**
 *
 * 44px を守って行を増やすと、大きな盤面では**パレットが盤面を潰す**（49×49 で 444px）。
 * そこで、44px の実寸が画面に収まらない場合に限り、姿を2つに分ける。
 *
 * | 姿 | いつ | 見た目 |
 * |---|---|---|
 * | `FULL` | 収まるとき／収まらないときの**選択中** | 44px を守る。押せる |
 * | `MINI` | 収まらないときの**未選択** | 縮めて全値を一覧する。押せない（入力先が無いため） |
 *
 * 縮んでいるあいだも「使い切った値」は淡く出るので、**残数の一覧として役に立つ**。
 * どちらの姿になるかは**画面の実寸から出る帰結**であり、N による分岐ではない（B-6）。
 * 9×9 以下は常に `FULL`、25×25 も縦画面（375×667）で `FULL` に収まる。
 */

import type { BoardSize } from '../../data/types';
import { MIN_TOUCH_PX } from '../config';
import { toDisplay } from '../symbols';

/** ボタン1つの最小寸法（8.4）。スタイル側の `.palette-key` と同じ値である */
export const PALETTE_KEY_PX = MIN_TOUCH_PX;

/**
 * 倍率をかけたボタン1つの寸法（C-190）
 *
 * **触れないほど小さくも、画面をはみ出すほど大きくもできる**（利用者の指示）。
 * 44px は「押しやすさの下限」であって、**利用者が自分で下げるぶんには止めない**。
 */
export function keyPxOf(scale: number): number {
  return Math.max(4, Math.round(PALETTE_KEY_PX * scale));
}
/** ボタンの間隔。スタイル側の `.palette` の `gap` と同じ値である */
export const PALETTE_GAP_PX = 6;
/** 縮小時のボタン間隔。スタイル側の `.palette-mini` と同じ値である */
export const PALETTE_MINI_GAP_PX = 3;

export type PaletteVariant = 'FULL' | 'MINI';

export interface NumberPaletteProps {
  n: BoardSize;
  /** ブロック1辺。列数の見当に用いる */
  b: number;
  /** ボタンの大きさの倍率（C-190）。1 が仕様書どおりの 44px */
  scale?: number;
  /** 値ごとに「盤面上で使い切ったか」（8.4）。添字 v-1 が値 v */
  exhausted: readonly boolean[];
  /** メモ入力モード。押下の意味が変わるので見た目も変える（9.2） */
  noteMode: boolean;
  /** セル未選択・固定セル選択中は押せない（8.6） */
  disabled: boolean;
  /** 姿（C-159）。`MINI` は一覧のみで押せない */
  variant?: PaletteVariant;
  /**
   * 列数の指定（右置きのとき・C-166）。
   * 下置きでは幅に従って自動で決まるが、右置きでは**高さから決めた列数**を渡す。
   */
  columns?: number;
  onInput(value: number): void;
}

/**
 * 1行あたりのボタン数の上限（8.4 の推奨値）。
 *
 * **サイズごとの表を持たない。** 「`b` の倍数のうち、1行が長くなりすぎない最大のもの」
 * という1つの規則から求める。結果は 1→1・4→4・9→9・16→12・25→10・36→12・49→14 となり、
 * **16 だけが推奨表（8列）と違う。** 8.4 は推奨値であり実際の列数は幅に従うと定めているため、
 * 表に合わせるためのサイズ別分岐は書かない（B-6）。12列でも値の並びはブロック構造と対応する
 * （4個ずつ3ブロックが1行に入る）。
 */
export function columnsFor(n: BoardSize, b: number): number {
  const max = 14;
  let columns = b;
  while (columns + b <= max && columns < n) columns += b;
  return Math.min(columns, n);
}

/**
 * 44px を守ったときの実寸（8.4 / V-14）。
 *
 * 幅から入る列数を求め、推奨列数で頭打ちにする。**二段構えに入るかの判定に用いる。**
 * 幅が測れていない（0）ときは推奨列数で見積もる。描画前の1回だけ起こる。
 */
export function paletteMetrics(
  n: BoardSize,
  b: number,
  widthPx: number,
  keyPx: number = PALETTE_KEY_PX,
): { columns: number; rows: number; heightPx: number } {
  const cap = columnsFor(n, b);
  const byWidth =
    widthPx > 0 ? Math.floor((widthPx + PALETTE_GAP_PX) / (keyPx + PALETTE_GAP_PX)) : cap;
  const columns = Math.max(1, Math.min(cap, byWidth));
  const rows = Math.ceil(n / columns);
  return { columns, rows, heightPx: rows * keyPx + (rows - 1) * PALETTE_GAP_PX };
}

/** 指定の列数でボタン寸法を守ったときの高さ */
export function heightOf(n: BoardSize, columns: number, keyPx: number = PALETTE_KEY_PX): number {
  const rows = Math.ceil(n / columns);
  return rows * keyPx + (rows - 1) * PALETTE_GAP_PX;
}

/**
 * 高さから列数を決めたときの実寸（右置きのとき・C-166）
 *
 * 下置きでは幅が先に決まって行が増えるが、**右置きでは高さが先に決まって列が増える。**
 * 向きが入れ替わるだけで、規則は同じ「44px を守る」である。
 *
 * 列数は `b` の倍数のうち**収まる最小のもの**を採る。細い帯で済むほど盤面が広くなるためで、
 * どれも収まらないときは推奨列数まで広げる（そのぶん内側が縦に送られる）。
 */
export function paletteMetricsForHeight(
  n: BoardSize,
  b: number,
  heightPx: number,
  keyPx: number = PALETTE_KEY_PX,
): { columns: number; rows: number; widthPx: number; heightPx: number } {
  const cap = columnsFor(n, b);
  const step = Math.max(1, b);

  let columns = cap;
  for (let candidate = step; candidate <= cap; candidate += step) {
    if (heightOf(n, candidate, keyPx) <= heightPx) {
      columns = candidate;
      break;
    }
  }

  const rows = Math.ceil(n / columns);
  return {
    columns,
    rows,
    widthPx: columns * keyPx + (columns - 1) * PALETTE_GAP_PX,
    heightPx: heightOf(n, columns, keyPx),
  };
}

export function NumberPalette({
  n,
  b,
  exhausted,
  noteMode,
  disabled,
  variant = 'FULL',
  columns: fixedColumns,
  onInput,
  scale = 1,
}: NumberPaletteProps): React.ReactElement {
  const columns = fixedColumns ?? columnsFor(n, b);
  const values = Array.from({ length: n }, (_, i) => i + 1);
  const mini = variant === 'MINI';

  /**
   * **幅が足りるときだけ推奨の列数になる。**
   * 列そのものは幅から決め（`auto-fill`）、推奨列数は「これ以上は広げない」上限として効かせる。
   * こうすると、広い画面では `b` の倍数で並び、狭い画面では 44px を守ったまま行が増える（8.4）。
   *
   * 縮小時（`MINI`）だけは逆で、**推奨の列数を先に決めてボタンを幅へ合わせる。**
   * 全値をひと目で見せることが目的で、押すのは拡大した姿の役目だからである。
   */
  const keyPx = keyPxOf(scale);
  const width = `${columns * keyPx + (columns - 1) * PALETTE_GAP_PX}px`;
  const style: React.CSSProperties = mini
    ? { gridTemplateColumns: `repeat(${columns}, 1fr)` }
    : fixedColumns !== undefined
      ? // 右置きは列数が先に決まっているので、そのまま実寸で並べる（パネルの幅がこれで決まる）
        { gridTemplateColumns: `repeat(${columns}, ${keyPx}px)`, width }
      : {
          gridTemplateColumns: `repeat(auto-fill, minmax(${keyPx}px, 1fr))`,
          maxWidth: width,
        };

  // 文字の大きさをボタンに追随させるため、寸法を CSS 変数で渡す（C-190）
  (style as Record<string, string>)['--palette-key'] = `${keyPx}px`;
  const className = ['palette', noteMode ? 'palette-note' : '', mini ? 'palette-mini' : '']
    .filter((part) => part !== '')
    .join(' ');

  return (
    <div className={className} style={style} data-testid={mini ? 'palette-mini' : 'palette'}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className="palette-key"
          // 縮んだ姿では全部が非活性になるため、使い切った値は別の目印で見分ける
          data-exhausted={exhausted[value - 1] === true ? 'true' : undefined}
          // 縮んでいるあいだは入力先が無いので押せない。見えているのは残数の一覧である
          disabled={mini || disabled || exhausted[value - 1] === true}
          onClick={() => onInput(value)}
        >
          {toDisplay(value)}
        </button>
      ))}
    </div>
  );
}
