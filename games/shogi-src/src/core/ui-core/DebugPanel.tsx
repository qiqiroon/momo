import { useEffect, useRef } from 'react';
import { useDebugStore, type DebugClickEntry } from '../store/debug-store';

/**
 * v0.91 で新設。v0.94 で「棋譜パネル直下に常時表示するインラインパネル」に変更。
 *
 * `?debug=1` (useDebugStore.enabled) の時のみ描画。ノーマルモードでは何も出さない。
 * 描画位置は GameScreen 側で棋譜パネル直後に配置している。
 *
 * 表示内容:
 *   - 盤マス左上に PieceID + [candidates.size] を出す表示 ON/OFF チェックボックス
 *   - 直近 20 件の駒クリック履歴 (盤上/持ち駒台の両方) を PieceInstance の読める整形で列挙
 *   - 履歴の全消しボタン
 *
 * 今後 Phase 5 の実装が進むにつれて機能拡張予定 (制約適用ログ等)。
 */
export function DebugPanel() {
  const enabled = useDebugStore((s) => s.enabled);
  const showPieceIds = useDebugStore((s) => s.showPieceIds);
  const clickLog = useDebugStore((s) => s.clickLog);
  const toggleShowPieceIds = useDebugStore((s) => s.toggleShowPieceIds);
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
        <label
          style={{
            display: 'flex', gap: 8, alignItems: 'center',
            fontSize: 12, marginBottom: 10, cursor: 'pointer', color: 'var(--text)',
          }}
        >
          <input
            type="checkbox"
            checked={showPieceIds}
            onChange={toggleShowPieceIds}
            style={{ accentColor: 'var(--orange)' }}
          />
          <span>盤マスに PieceID + [candidates.size] を表示</span>
        </label>

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
