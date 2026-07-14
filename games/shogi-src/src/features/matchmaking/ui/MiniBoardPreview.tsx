import type { GameType } from '../roomNameCodec';
import type { TorusMode } from '../store';

/** v0.57: S02 プレビュー用の 9×9 ミニ盤面。初期配置とトポロジー標示を担当。
 *
 *  役割:
 *  - 選択したルールに応じて初期配置を描画 (本将棋 / はさみ将棋 / カスタム)
 *  - トーラス指定時は盤の端に「つながり」を示すオレンジのマーカーを追加
 *
 *  対局用の本盤とは分離しており、演出のみを担う (実プレイのロジックとは共有しない)。
 */

interface Cell {
  ch: string; // 駒文字（空マスは ''）
  gote?: boolean; // true なら 180 度回転して表示
}

const EMPTY: Cell = { ch: '' };

// 本将棋初期配置 (9x9 の 1 次元配列、上=後手・下=先手)
function shogiInitial(): Cell[] {
  const g = (ch: string): Cell => ({ ch, gote: true });
  const s = (ch: string): Cell => ({ ch });
  return [
    // 1 段目 (後手陣)
    g('香'), g('桂'), g('銀'), g('金'), g('玉'), g('金'), g('銀'), g('桂'), g('香'),
    // 2 段目
    EMPTY, g('飛'), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, g('角'), EMPTY,
    // 3 段目
    g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'), g('歩'),
    // 4 段目
    EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
    // 5 段目
    EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
    // 6 段目
    EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
    // 7 段目 (先手陣)
    s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'), s('歩'),
    // 8 段目
    EMPTY, s('角'), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, s('飛'), EMPTY,
    // 9 段目
    s('香'), s('桂'), s('銀'), s('金'), s('玉'), s('金'), s('銀'), s('桂'), s('香'),
  ];
}

// はさみ将棋 (両陣とも歩 9 枚のみ)
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

// カスタムはデフォルトで本将棋配置を流用 (見た目のみ)
function initialFor(rule: GameType): Cell[] {
  if (rule === 'hasami') return hasamiInitial();
  return shogiInitial();
}

interface Props {
  rule: GameType;
  torusMode: TorusMode;
}

export function MiniBoardPreview({ rule, torusMode }: Props) {
  const cells = initialFor(rule);

  return (
    <div className="mini-board">
      <div
        className="mini-grid"
        style={
          torusMode === 'cylinder' || torusMode === 'full'
            ? { boxShadow: '2px 0 0 0 var(--orange), -2px 0 0 0 var(--orange)' }
            : undefined
        }
      >
        {cells.map((c, i) => (
          <div key={i} className="mini-sq">
            {c.ch && (
              <div className={`mini-pc${c.gote ? ' g2' : ''}`}>
                <span>{c.ch}</span>
              </div>
            )}
          </div>
        ))}
        {torusMode === 'full' && (
          // 上下の縁もオレンジで示す (完全トーラスのとき)
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              boxShadow: 'inset 0 2px 0 0 var(--orange), inset 0 -2px 0 0 var(--orange)',
            }}
          />
        )}
      </div>
    </div>
  );
}
