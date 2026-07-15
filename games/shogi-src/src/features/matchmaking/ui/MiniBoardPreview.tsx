import { useEffect, useState } from 'react';
import type { GameType } from '../roomNameCodec';
import type { TorusMode, QuantumDisplayMode } from '../store';

/** v0.63: 量子将棋の巡回表示駒 (強い順)。RuleSelectScreen と共有できるよう export。 */
export const QUANTUM_PIECES = ['王', '飛', '角', '金', '銀', '桂', '香', '歩'] as const;

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

function shogiInitial(): Cell[] {
  const g = (ch: string): Cell => ({ ch, gote: true });
  const s = (ch: string): Cell => ({ ch });
  return [
    g('香'), g('桂'), g('銀'), g('金'), g('玉'), g('金'), g('銀'), g('桂'), g('香'),
    EMPTY, g('飛'), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, g('角'), EMPTY,
    g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'),
    EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
    EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
    EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
    s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'),
    EMPTY, s('角'), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, s('飛'), EMPTY,
    s('香'), s('桂'), s('銀'), s('金'), s('玉'), s('金'), s('銀'), s('桂'), s('香'),
  ];
}

function hasamiInitial(): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (r === 0) cells.push({ ch: '歩', gote: true });
      else if (r === 8) cells.push({ ch: '歩' });
      else cells.push(EMPTY);
    }
  }
  return cells;
}

function initialFor(rule: GameType): Cell[] {
  if (rule === 'hasami') return hasamiInitial();
  return shogiInitial();
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
}

export function MiniBoardPreview({ rule, torusMode, quantum = false, quantumDisplayMode = 'cycle' }: Props) {
  const base = initialFor(rule);
  const cells =
    torusMode === 'full' ? extendFullTorus(base)
    : torusMode === 'cylinder' ? extendCylinder(base)
    : base;

  // 量子 ON の巡回表示: 1 秒ごとに駒種を切替 (プレビュー用)
  const [qIdx, setQIdx] = useState(0);
  useEffect(() => {
    if (!quantum || quantumDisplayMode !== 'cycle') return;
    const id = setInterval(() => setQIdx((i) => (i + 1) % QUANTUM_PIECES.length), 1000);
    return () => clearInterval(id);
  }, [quantum, quantumDisplayMode]);

  const gridClass =
    torusMode === 'full' ? 'mini-grid torus-full'
    : torusMode === 'cylinder' ? 'mini-grid torus-cyl'
    : 'mini-grid';

  return (
    <div className={`mini-board${torusMode !== 'none' ? ' is-torus' : ''}`}>
      <div className={gridClass}>
        {cells.map((c, i) => (
          <div key={i} className="mini-sq">
            {c.ch && (
              <>
                <div className={`mini-pc${c.gote ? ' g2' : ''}`}>
                  {quantum ? (
                    quantumDisplayMode === 'stack' ? (
                      <span className="mini-stack">
                        {QUANTUM_PIECES.map((p) => (
                          <span key={p}>{p}</span>
                        ))}
                      </span>
                    ) : (
                      <span>{QUANTUM_PIECES[qIdx]}</span>
                    )
                  ) : (
                    <span>{c.ch}</span>
                  )}
                </div>
                {/* v0.64: ? は駒の外 (.mini-sq 直下) に置く。モック S06 の .qmark-b と同じ思想。
                    駒 (clip-path) の外に出さないと ? がクリップされて見えないため。 */}
                {quantum && <span className={`mini-qmk${c.gote ? ' g2' : ''}`}>?</span>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
