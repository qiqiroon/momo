import { useEffect, useRef } from 'react';
import {
  useDebugStore,
  type DebugClickEntry,
  type DebugCandidateChangeEntry,
} from '../store/debug-store';

/**
 * v0.94 で新設 (棋譜下 DEBUG インライン枠) → v0.95 で PieceID スイッチはフローティング側に分離 →
 * v0.99 で **「デバッグ情報」に改名** し、駒クリック履歴に加えて「候補変更履歴」を並列表示。
 *
 * `?debug=1` (useDebugStore.enabled) の間だけレンダリングされる。ノーマルモードでは非表示。
 * 描画位置は GameScreen 側で棋譜パネル直後に配置している。
 *
 * ## 中身
 * 1. 駒クリック履歴: 直近 20 件の駒クリックを PieceInstance の読める整形で列挙
 * 2. 候補変更履歴: 直近 20 件の「量子モードで candidates が変化した駒」を時系列で
 *    列挙。1 手ぶんの複数駒変化はまとめて連続 entry として積まれる。
 *
 * それぞれ clear ボタンで独立に消せる。
 */
export function DebugClickLog() {
  const enabled = useDebugStore((s) => s.enabled);
  const clickLog = useDebugStore((s) => s.clickLog);
  const candidateChangeLog = useDebugStore((s) => s.candidateChangeLog);
  const clearLog = useDebugStore((s) => s.clearLog);
  const clearCandidateChangeLog = useDebugStore((s) => s.clearCandidateChangeLog);

  const clickLogRef = useRef<HTMLDivElement>(null);
  const changeLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (clickLogRef.current) clickLogRef.current.scrollTop = clickLogRef.current.scrollHeight;
  }, [clickLog]);
  useEffect(() => {
    if (changeLogRef.current) changeLogRef.current.scrollTop = changeLogRef.current.scrollHeight;
  }, [candidateChangeLog]);

  if (!enabled) return null;

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-label">
        <span style={{ color: 'var(--orange)', letterSpacing: '0.06em' }}>デバッグ情報</span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <LogSection
          title="駒クリック履歴 (最新 20 件)"
          onClear={clearLog}
          logRef={clickLogRef}
          empty={clickLog.length === 0}
        >
          {clickLog.map((entry, i) => (
            <div key={i} style={{ marginBottom: 4, lineHeight: 1.4, wordBreak: 'break-all' }}>
              {formatClickEntry(entry)}
            </div>
          ))}
        </LogSection>

        <div style={{ height: 10 }} />

        <LogSection
          title="候補変更履歴 (最新 20 件)"
          onClear={clearCandidateChangeLog}
          logRef={changeLogRef}
          empty={candidateChangeLog.length === 0}
        >
          {candidateChangeLog.map((entry, i) => (
            <div key={i} style={{ marginBottom: 4, lineHeight: 1.4, wordBreak: 'break-all' }}>
              {formatCandidateChangeEntry(entry)}
            </div>
          ))}
        </LogSection>
      </div>
    </div>
  );
}

function LogSection({
  title,
  onClear,
  logRef,
  empty,
  children,
}: {
  title: string;
  onClear: () => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{title}</span>
        <button
          type="button"
          onClick={onClear}
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
          minHeight: 60, maxHeight: 180, overflowY: 'auto',
          fontSize: 11, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          color: 'var(--text-muted)', display: 'flex', flexDirection: 'column',
        }}
      >
        {empty ? <span style={{ opacity: 0.6 }}>(まだ何も無し)</span> : children}
      </div>
    </>
  );
}

function formatClickEntry(entry: DebugClickEntry): string {
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

function formatCandidateChangeEntry(entry: DebugCandidateChangeEntry): string {
  const t = new Date(entry.time);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const parts: string[] = [
    `[${hh}:${mm}:${ss}]`,
    `mv${entry.moveNumber}`,
    `${entry.pieceId}`,
    `[${entry.before.join(',')}]→[${entry.after.join(',')}]`,
  ];
  if (entry.removed.length > 0) parts.push(`removed=[${entry.removed.join(',')}]`);
  if (entry.added.length > 0) parts.push(`added=[${entry.added.join(',')}]`);
  return parts.join(' ');
}
