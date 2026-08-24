import { useEffect, useState } from 'react';
import { hondou, initPosition, mgfForGameType, pieceNameFor } from '../../../core/engine';
import type { GameType } from '../roomNameCodec';
import type { TorusMode, QuantumDisplayMode } from '../store';
import type { LocaleCode } from '../../../core/i18n/types';

/** v0.63: 量子将棋の巡回表示駒 (強い順)。RuleSelectScreen と共有できるよう export。
 *  v0.86: 英語モード時の表記変換ヘルパも同居 (K/R/B/G/S/N/L/P)。 */
export const QUANTUM_PIECES = ['王', '飛', '角', '金', '銀', '桂', '香', '歩'] as const;

const KANJI_TO_EN: Record<string, string> = {
  '王': 'K', '玉': 'K', '飛': 'R', '角': 'B',
  '金': 'G', '銀': 'S', '桂': 'N', '香': 'L', '歩': 'P',
};

/** v0.86: 駒表記を locale に応じて変換 (英語モード時のみ英文字化) */
export function pieceLabel(kanji: string, locale: LocaleCode): string {
  if (locale === 'en') return KANJI_TO_EN[kanji] ?? kanji;
  return kanji;
}

/** S02 プレビュー用の 9×9 ミニ盤面。初期配置とトポロジー標示を担当。
 *
 *  役割:
 *  - 選択したルールに応じて初期配置を描画 (本将棋 / はさみ将棋 / カスタム)
 *  - トーラス指定時は盤の左右 (円筒) や上下左右 (完全) に 2 列/2 行分の
 *    「反対側からのコピー」を追加し、フェードグラデーションで「盤面がつながっている」
 *    印象を作る。
 *  - 量子 ON の場合は各駒の右上に ? を重ね、巡回=1 秒ごとに駒種を切替 /
 *    重ね=全駒を重ねて表示 (v0.63)
 *
 *  対局用の本盤とは分離しており、演出のみを担う。
 */

interface Cell {
  ch: string; // 駒文字（空マスは ''）
  gote?: boolean; // true なら 180 度回転して表示
}

const EMPTY: Cell = { ch: '' };

/**
 * v1.35: プレビューの初期配置は**ルール定義から起こす**（付録D-2 v1.8 §5）。
 *
 * 以前は本将棋とはさみ将棋の並びを、この画面の中に書き置いていた。**同じ見た目を
 * 2 か所で別々に作っている状態**で、実際に 2026-08-14 に片方だけ直して気づけない
 * 不具合（量子の候補の顔ぶれ）が出ている。ルールを増やしてもここは触らない形にする。
 *
 * 定義を持たないルール（自由ルールは Phase 7）は本将棋の並びで代用する。
 */
export function initialFor(rule: GameType): Cell[] {
  const mgf = mgfForGameType(rule) ?? hondou;
  const pos = initPosition(mgf);
  const cells: Cell[] = [];
  for (let row = 0; row < pos.height; row++) {
    for (let col = 0; col < pos.width; col++) {
      const piece = pos.board[row][col];
      if (!piece) {
        cells.push(EMPTY);
        continue;
      }
      // 将棋の駒字は漢字の対応表から。定義に無い駒 (チェスの K/Q/R… 等) は
      // **ルール定義の表示文字を string で引く** (§3.6.1)。以前は生の `name` を
      // そのまま入れており、name が言語ごとの {ja,en,zh} だとオブジェクトが
      // React の子に渡って落ちた (9-1 と同じ「決め打ち表に無いと生を出す」型)。
      const ch = PIECE_ID_TO_CH[piece.kind] ?? pieceNameFor(mgf, piece.kind, 'ja');
      cells.push(piece.owner === 'player2' ? { ch, gote: true } : { ch });
    }
  }
  return cells;
}

/** ルール定義の駒 id → プレビューの駒文字。定義に無い駒は落とせない (無視する)。 */
const PIECE_ID_TO_CH: Record<string, string> = {
  fu: '歩', kyo: '香', kei: '桂', gin: '銀', kin: '金', kaku: '角', hi: '飛', ou: '玉', gyoku: '玉',
};

/** プレビューに渡す手合い。giverIsBottom = 落とす側が盤の下側 (＝自分側) か。 */
export interface PreviewHandicap {
  giverIsBottom: boolean;
  remove: { piece: string; count?: number; pick?: 'left' | 'right' | 'any' }[];
}

/**
 * 手合いぶんの駒を盤から抜く (親 §3.12.1 / 付録D-2 v1.6 §5)。
 *
 * どれを抜くかの決め方は本番の初期局面と同じ＝**駒の種類と「上手から見た左右」**。
 * 盤は先手 (下側) から見て描いてあるので、**下側の上手から見た左＝列 0 側**、
 * **上側の上手から見た左＝列 8 側**になる。
 */
export function applyHandicapToCells(base: Cell[], hc: PreviewHandicap): Cell[] {
  const cells = [...base];
  const removed = new Set<number>();
  for (const entry of hc.remove) {
    const ch = PIECE_ID_TO_CH[entry.piece];
    if (!ch) continue;
    const count = entry.count ?? 1;
    const found: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (removed.has(i)) continue;
      const c = cells[i];
      if (c.ch !== ch) continue;
      if (!c.gote !== hc.giverIsBottom) continue;
      found.push(i);
    }
    found.sort((a, b) => (hc.giverIsBottom ? (a % 9) - (b % 9) : (b % 9) - (a % 9)));
    const ordered = entry.pick === 'right' ? [...found].reverse() : found;
    for (const i of ordered.slice(0, count)) {
      removed.add(i);
      cells[i] = EMPTY;
    }
  }
  return cells;
}

/**
 * v1.34: 量子 ON のときプレビューに出す候補の顔ぶれ (付録D-2 v1.7 §5)。
 *
 * 候補は「自陣営の駒の集合」(量子分冊 §Q4.2) なので、**その側に残っている駒種だけ**を
 * 強い順に返す。駒落ちで落ちた駒種はここから自動的に消える (六枚落ちの上手なら
 * 玉・金・銀・歩の 4 種)。決め打ちの 8 種を回すと、盤に 1 枚も無い飛や角が候補として
 * 回り続け、対局盤 (候補集合から顔を作る) と食い違う。
 *
 * `gote` はプレビュー盤の上側 (相手側) を指す。手合いを適用した後の盤を渡すこと。
 */
export function quantumKindsFor(cells: Cell[], gote: boolean): readonly string[] {
  const present = new Set<string>();
  for (const c of cells) {
    if (!c.ch) continue;
    if (!!c.gote !== gote) continue;
    // 盤の駒字は「玉」だが候補の並びは「王」で持っているので寄せる
    present.add(c.ch === '玉' ? '王' : c.ch);
  }
  const kinds = QUANTUM_PIECES.filter((p) => present.has(p));
  // 駒が 1 枚も無い側 (はさみ将棋の空側など) は従来どおり全種を回す
  return kinds.length > 0 ? kinds : QUANTUM_PIECES;
}

/** 9×9 の 1 次元配列から (row, col) を取得 */
function cellAt(cells: Cell[], row: number, col: number): Cell {
  return cells[row * 9 + col];
}

/** トーラス円筒モード用: 13 列 × 9 行にコピー拡張。
 *  左端 2 列 = 原盤の 右端 2 列 (列 7, 8) のコピー
 *  右端 2 列 = 原盤の 左端 2 列 (列 0, 1) のコピー */
function extendCylinder(base: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < 9; r++) {
    for (let ec = 0; ec < 13; ec++) {
      // ec: 0,1 = base col 7,8 / 2..10 = base col 0..8 / 11,12 = base col 0,1
      const baseCol = ec < 2 ? 7 + ec : ec < 11 ? ec - 2 : ec - 11;
      out.push(cellAt(base, r, baseCol));
    }
  }
  return out;
}

/** トーラス完全モード用: 13 列 × 13 行にコピー拡張。上下も同様にラップ。 */
function extendFullTorus(base: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (let er = 0; er < 13; er++) {
    const baseRow = er < 2 ? 7 + er : er < 11 ? er - 2 : er - 11;
    for (let ec = 0; ec < 13; ec++) {
      const baseCol = ec < 2 ? 7 + ec : ec < 11 ? ec - 2 : ec - 11;
      out.push(cellAt(base, baseRow, baseCol));
    }
  }
  return out;
}

interface Props {
  rule: GameType;
  torusMode: TorusMode;
  quantum?: boolean;
  quantumDisplayMode?: QuantumDisplayMode;
  /** v0.86: en 時のみ駒表記を英語化 (それ以外は漢字) */
  locale?: LocaleCode;
  /** v1.33: 手合い (駒落ち)。落とす駒を抜いた形で描く。平手なら省略。 */
  handicap?: PreviewHandicap | null;
}

export function MiniBoardPreview({ rule, torusMode, quantum = false, quantumDisplayMode = 'cycle', locale = 'ja', handicap = null }: Props) {
  const plain = initialFor(rule);
  // 手合いは盤を広げる前に適用する。回り込みの写しは元の盤から作るので、
  // 欠けもそのまま写る (付録D-2 v1.6 §5)。
  const base = handicap ? applyHandicapToCells(plain, handicap) : plain;
  const cells =
    torusMode === 'full' ? extendFullTorus(base)
    : torusMode === 'cylinder' ? extendCylinder(base)
    : base;

  // v1.34: 候補の顔ぶれは側ごとに作る (手合いで上手だけ減るため・付録D-2 v1.7 §5)
  const kindsBottom = quantumKindsFor(base, false);
  const kindsTop = quantumKindsFor(base, true);

  // 量子 ON の巡回表示: 1 秒ごとに駒種を切替 (プレビュー用)
  // 上下で顔ぶれの数が違い得るので、拍だけ共通にして表示のときに各側の長さで折り返す。
  // 840 は 1〜8 のどれでも割り切れるので、どの顔ぶれでも一巡の途中で飛ばない。
  const [qIdx, setQIdx] = useState(0);
  useEffect(() => {
    if (!quantum || quantumDisplayMode !== 'cycle') return;
    const id = setInterval(() => setQIdx((i) => (i + 1) % 840), 1000);
    return () => clearInterval(id);
  }, [quantum, quantumDisplayMode]);

  const gridClass =
    torusMode === 'full' ? 'mini-grid torus-full'
    : torusMode === 'cylinder' ? 'mini-grid torus-cyl'
    : 'mini-grid';

  return (
    <div className={`mini-board${torusMode !== 'none' ? ' is-torus' : ''}`}>
      <div className={gridClass}>
        {cells.map((c, i) => {
          const kinds = c.gote ? kindsTop : kindsBottom;
          return (
          <div key={i} className="mini-sq">
            {c.ch && (
              <>
                <div className={`mini-pc${c.gote ? ' g2' : ''}`}>
                  {quantum ? (
                    quantumDisplayMode === 'stack' ? (
                      <span className="mini-stack">
                        {kinds.map((p) => (
                          <span key={p}>{pieceLabel(p, locale)}</span>
                        ))}
                      </span>
                    ) : (
                      <span>{pieceLabel(kinds[qIdx % kinds.length], locale)}</span>
                    )
                  ) : (
                    <span>{pieceLabel(c.ch, locale)}</span>
                  )}
                </div>
                {/* v0.64: ? は駒の外 (.mini-sq 直下) に置く。モック S06 の .qmark-b と同じ思想。
                    駒 (clip-path) の外に出さないと ? がクリップされて見えないため。 */}
                {quantum && <span className={`mini-qmk${c.gote ? ' g2' : ''}`}>?</span>}
              </>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
