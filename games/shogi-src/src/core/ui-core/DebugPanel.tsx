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

        <QuantumParamControls />
      </div>
    </>
  );
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 8,
  fontSize: 11,
} as const;

/**
 * Phase 5-15: 量子モードの実行時パラメータ (§Q17.8) の操作。
 *
 * 仕様は設定画面 (S09 系) への露出を「実装バリエーションとして認める」に留めており、
 * 項目名や見せ方は画面機能仕様側の決めごとなので、そこが決まるまではここに置く。
 * **既定値のままなら従来と完全に同じ挙動**になる。
 *
 * 反復上限を小さくすると「計算量が上限に達しました」を、異常時の挙動を変えると
 * 投票を挟まない終わり方を、それぞれ故意に試せる。
 */
function QuantumParamControls() {
  const params = useGameStore((s) => s.quantumParams);
  const setParams = useGameStore((s) => s.setQuantumParams);

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
        量子モードの実行時パラメータ (§Q17.8)
      </div>

      <label style={rowStyle}>
        <span>反復上限 (max_iterations)</span>
        <input
          type="number"
          min={1}
          value={params.maxIterations}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1) setParams({ maxIterations: Math.floor(n) });
          }}
          style={{
            width: 72, padding: '2px 4px', fontSize: 11,
            background: 'transparent', color: 'var(--text)',
            border: '1px solid var(--border-strong)', borderRadius: 4,
          }}
        />
      </label>

      <label style={{ ...rowStyle, cursor: 'pointer' }}>
        <span>開始時に絞り込みを 1 回 (initial_propagation)</span>
        <input
          type="checkbox"
          checked={params.initialPropagation}
          onChange={(e) => setParams({ initialPropagation: e.target.checked })}
          style={{ accentColor: 'var(--orange)' }}
        />
      </label>

      <label style={rowStyle}>
        <span>異常時 (anomaly_action)</span>
        <select
          value={params.anomalyAction}
          onChange={(e) => setParams({ anomalyAction: e.target.value as typeof params.anomalyAction })}
          style={{
            padding: '2px 4px', fontSize: 11,
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border-strong)', borderRadius: 4,
          }}
        >
          <option value="vote_to_annul">投票 (標準)</option>
          <option value="notify_user">知らせるだけ</option>
          <option value="no_game">即ノーゲーム</option>
        </select>
      </label>

      <div style={{ ...rowStyle, color: 'var(--text-muted)' }}>
        <span>観測タイミング (observation_timing)</span>
        <span>着手後</span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
        ※ 反復上限と異常時の挙動は次の 1 手から効きます。開始時の絞り込みは対局を
        始め直したときに効きます。手動観測 (manual) は仕様側が未確定です。
      </div>
    </div>
  );
}
