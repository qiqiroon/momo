import { useDebugStore, type DebugClickEntry } from '../store/debug-store';

/**
 * v0.91: `?debug=1` 有効時のみアクセス可能なデバッグパネル。
 *
 * SettingsPopup (歯車内) から「デバッグパネル」リンクで開かれる。
 * 現時点で提供する機能:
 *   - 盤マス左上に PieceID + [candidates.size] を出す表示 ON/OFF
 *   - 直近 20 件の駒クリック履歴 (盤上/持ち駒台の両方) を PieceInstance の
 *     読める整形で列挙 + 全消しボタン
 *
 * 今後 Phase 5 の実装が進むにつれて機能拡張予定 (制約適用ログ等)。
 */
export function DebugPanel() {
  const enabled = useDebugStore((s) => s.enabled);
  const panelOpen = useDebugStore((s) => s.panelOpen);
  const showPieceIds = useDebugStore((s) => s.showPieceIds);
  const clickLog = useDebugStore((s) => s.clickLog);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  const toggleShowPieceIds = useDebugStore((s) => s.toggleShowPieceIds);
  const clearLog = useDebugStore((s) => s.clearLog);

  if (!enabled || !panelOpen) return null;

  return (
    <>
      <div
        onClick={() => setPanelOpen(false)}
        style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 600 }}
      />
      <div
        style={{
          position: 'fixed', top: 46, right: 12, zIndex: 601,
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 10, padding: '12px 14px', width: 360,
          maxHeight: '80vh', overflowY: 'auto',
          color: 'var(--text)', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.06em' }}>
            DEBUG PANEL
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            style={{
              padding: '2px 8px', background: 'transparent',
              border: '1px solid var(--border-strong)', borderRadius: 4,
              color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer',
            }}
          >
            close
          </button>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showPieceIds}
            onChange={toggleShowPieceIds}
            style={{ accentColor: 'var(--orange)' }}
          />
          <span>盤マスに PieceID + [candidates.size] を表示</span>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 6 }}>
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
          style={{
            background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-strong)',
            borderRadius: 6, padding: '6px 8px', minHeight: 120, maxHeight: 320,
            overflowY: 'auto', fontSize: 11, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
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
    </>
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
