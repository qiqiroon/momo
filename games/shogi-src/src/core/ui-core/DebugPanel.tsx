import { useDebugStore } from '../store/debug-store';
import { useGameStore } from '../store/game-store';

/**
 * v0.91 で新設 → v0.94 でインライン化 → v0.95 で **フローティング復活 (PieceID スイッチ専用)**。
 *
 * `?debug=1` + 歯車内「デバッグパネル」リンククリックで開く小さなフローティングパネル。
 * 中身は今のところ「盤マスに PieceID + [candidates.size] を表示」チェックボックスのみ。
 *
 * 駒クリック履歴は棋譜パネル直下の `DebugClickLog` に分離した (v0.94)。
 * 今後 Phase 5 の進行に合わせてデバッグ用のスイッチ/表示枠を追加する時、
 * 「対局中の視認 (棋譜下) は DebugClickLog」「切替スイッチ類はフローティング」で
 * 使い分ける想定。
 */
const dbgBtnStyle = {
  flex: 1,
  padding: '5px 6px',
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 4,
  color: 'var(--text-muted)',
  fontSize: 10,
  cursor: 'pointer',
} as const;

export function DebugPanel() {
  const enabled = useDebugStore((s) => s.enabled);
  const panelOpen = useDebugStore((s) => s.panelOpen);
  const showPieceIds = useDebugStore((s) => s.showPieceIds);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  const toggleShowPieceIds = useDebugStore((s) => s.toggleShowPieceIds);

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
          borderRadius: 10, padding: '12px 14px', width: 300,
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

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showPieceIds}
            onChange={toggleShowPieceIds}
            style={{ accentColor: 'var(--orange)' }}
          />
          <span>盤マスに PieceID + [candidates.size] を表示</span>
        </label>

        {/* Phase 5-13: 異常状態は自然には滅多に起きないので、故意に起こす入口を用意する
            (kickoff §5「意図的に破綻局面を作れるスクリプト」)。
            「候補を空に」は盤上の駒 1 枚の候補を実際に空にして本番と同じ検出経路を通す。
            「反復上限」は反復が終わらない局面を人工的に作るのが難しいので通知だけ直接出す。 */}
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>
            異常状態 (Phase 5-13) を故意に起こす
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={dbgBtnStyle} onClick={() => useGameStore.getState().debugForceAnomaly('empty')}>
              候補を空に (C-901)
            </button>
            <button type="button" style={dbgBtnStyle} onClick={() => useGameStore.getState().debugForceAnomaly('limit')}>
              反復上限
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
