import { useEffect, useRef } from 'react';
import { useDebugStore, type DebugClickEntry } from '../store/debug-store';

/**
 * v0.94 で新設 (v0.95 で DebugPanel から分離)。
 *
 * `?debug=1` の間は棋譜パネル直下に **常時表示** され、直近 20 件の駒クリック履歴を
 * PieceInstance の読める整形で列挙する。ノーマルモードでは何もレンダリングしない。
 *
 * PieceID 表示 ON/OFF 等のスイッチ類はフローティングの `DebugPanel` 側にある
 * (歯車内「デバッグパネル」リンクから開く)。役割分担:
 *   - 棋譜下 DebugClickLog: 対局中に垂れ流しで見るログ
 *   - フローティング DebugPanel: 表示/挙動を切り替えるスイッチ類
 *
 * 今後 Phase 5 の実装が進むにつれて機能拡張予定 (制約適用ログ等)。
 */
export function DebugClickLog() {
  const enabled = useDebugStore((s) => s.enabled);
  const clickLog = useDebugStore((s) => s.clickLog);
  const clearLog = useDebugStore((s) => s.clearLog);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [clickLog]);

  if (!enabled) return null;

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-label">
        <span style={{ color: 'var(--orange)', letterSpacing: '0.06em' }}>DEBUG</span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            駒クリック履歴 (最新 20 件)
          </span>
          <button
            type="button"
            onClick={clearLog}
            style={{
              padding: '2px 8px', background: 'transparent',
              border: '1px solid var(--border-strong)', borderRadius: 4,
              color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer',
            }}
          >
            clear
          </button>
        </div>
        <div
          ref={logRef}
          style={{
            background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-strong)',
            borderRadius: 6, padding: '6px 8px',
            minHeight: 80, maxHeight: 220, overflowY: 'auto',
            fontSize: 11, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            color: 'var(--text-muted)', display: 'flex', flexDirection: 'column',
          }}
        >
          {clickLog.length === 0 ? (
            <span style={{ opacity: 0.6 }}>(まだ何も無し)</span>
          ) : (
            clickLog.map((entry, i) => (
              <div key={i} style={{ marginBottom: 4, lineHeight: 1.4, wordBreak: 'break-all' }}>
                {formatEntry(entry)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatEntry(entry: DebugClickEntry): string {
  const p = entry.piece;
  const t = new Date(entry.time);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const parts: string[] = [
    `[${hh}:${mm}:${ss}]`,
    `${entry.source}`,
    `${p.pieceId}`,
    `kind=${p.kind}`,
    `owner=${p.owner}`,
    `initialOwner=${p.initialOwner}`,
    `promoted=${p.promoted}`,
  ];
  if (p.candidates !== undefined) {
    const arr = Array.from(p.candidates).sort();
    parts.push(`confirmed=${p.confirmed}`);
    parts.push(`candidates(${arr.length})=[${arr.join(',')}]`);
  }
  return parts.join(' ');
}
