import { useEffect, useMemo, useRef } from 'react';
import {
  useDebugStore,
  type DebugClickEntry,
  type DebugCandidateChangeEntry,
  type DebugLayoutEntry,
} from '../store/debug-store';
import { useGameStore } from '../store/game-store';
import { buildInitialInfoMap } from '../../features/quantum/piece-lookup';

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
  // ★v1.62: 窓の大きさ → 盤の大きさ の記録（2026-08-20 ユーザーご依頼）。
  const layoutLog = useDebugStore((s) => s.layoutLog);
  const clearLayoutLog = useDebugStore((s) => s.clearLayoutLog);
  // Phase 5-6.5: candidates を「初期 kind@初期筋」でグルーピング表示するための resolver。
  // 現局面の board/hands 全部をスキャンして pid→initialKind, initialSquare の map を作る。
  // 描画のたびに再計算されるが、40 駒スキャンなので許容範囲。
  const position = useGameStore((s) => s.position);
  const infoMap = useMemo(() => buildInitialInfoMap(position), [position]);

  const clickLogRef = useRef<HTMLDivElement>(null);
  const changeLogRef = useRef<HTMLDivElement>(null);
  const layoutLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (clickLogRef.current) clickLogRef.current.scrollTop = clickLogRef.current.scrollHeight;
  }, [clickLog]);
  useEffect(() => {
    if (changeLogRef.current) changeLogRef.current.scrollTop = changeLogRef.current.scrollHeight;
  }, [candidateChangeLog]);
  useEffect(() => {
    if (layoutLogRef.current) layoutLogRef.current.scrollTop = layoutLogRef.current.scrollHeight;
  }, [layoutLog]);

  if (!enabled) return null;

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-label">
        <span style={{ color: 'var(--orange)', letterSpacing: '0.06em' }}>デバッグ情報</span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        {/* ★v1.62: 盤が不自然に小さくなったとき、**そのまま貼って渡せる**ように
            「窓 → 盤」を時系列で残す（2026-08-20 ユーザーご依頼）。 */}
        <LogSection
          title="画面サイズと盤面サイズ (最新 60 件)"
          onClear={clearLayoutLog}
          logRef={layoutLogRef}
          empty={layoutLog.length === 0}
          extra={
            <button
              type="button"
              onClick={() => copyText(layoutLog.map(formatLayoutEntry).join('\n'))}
              style={{
                padding: '2px 8px', background: 'transparent',
                border: '1px solid var(--orange)', borderRadius: 4,
                color: 'var(--orange)', fontSize: 10, cursor: 'pointer',
              }}
            >
              コピー
            </button>
          }
        >
          {layoutLog.map((entry, i) => (
            <div key={i} style={{ marginBottom: 2, lineHeight: 1.4, whiteSpace: 'pre' }}>
              {formatLayoutEntry(entry)}
            </div>
          ))}
        </LogSection>

        <div style={{ height: 10 }} />

        <LogSection
          title="駒クリック履歴 (最新 20 件)"
          onClear={clearLog}
          logRef={clickLogRef}
          empty={clickLog.length === 0}
        >
          {clickLog.map((entry, i) => (
            <div key={i} style={{ marginBottom: 4, lineHeight: 1.4, wordBreak: 'break-all' }}>
              {formatClickEntry(entry, infoMap)}
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
              {formatCandidateChangeEntry(entry, infoMap)}
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
  extra,
}: {
  title: string;
  onClear: () => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  empty: boolean;
  children: React.ReactNode;
  /** clear の左に置く追加ボタン (v1.62: 「コピー」)。 */
  extra?: React.ReactNode;
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
        <span style={{ display: 'flex', gap: 6 }}>
        {extra}
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
        </span>
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

/**
 * PieceID 集合を「fu@1+fu@2, kaku@2, ou@5, ...」形式の可読文字列に整形する。
 * Phase 5-6.5 で candidates が PieceID になったので、初期 kind と 初期筋 (1-indexed) を
 * infoMap から取り出して表示する。resolve できない pid はそのまま列挙 (テスト用フォールバック)。
 */
function formatCandidatePieceIds(
  pids: readonly string[],
  infoMap: Map<string, { initialKind: string; initialSquare: { row: number; col: number } }>,
): string {
  if (pids.length === 0) return '';
  // initialKind でグルーピング。同じ kind 内は initialSquare.col (筋 = 1..9) 昇順で並べる。
  const groups = new Map<string, number[]>();
  const unresolved: string[] = [];
  for (const pid of pids) {
    const info = infoMap.get(pid);
    if (!info) { unresolved.push(pid); continue; }
    const list = groups.get(info.initialKind);
    // 筋の 1-indexed 表示 (右から数える将棋流)。col=8 → 1 筋 (最右)、col=0 → 9 筋 (最左)。
    const file = 9 - info.initialSquare.col;
    if (list) list.push(file);
    else groups.set(info.initialKind, [file]);
  }
  const parts: string[] = [];
  // 強さ順に並べる (ou, hi, kaku, kin, gin, kei, kyo, fu の順)
  const kindOrder = ['ou', 'hi', 'kaku', 'kin', 'gin', 'kei', 'kyo', 'fu'];
  for (const k of kindOrder) {
    const files = groups.get(k);
    if (!files || files.length === 0) continue;
    files.sort((a, b) => a - b);
    parts.push(`${k}@${files.join(',')}`);
    groups.delete(k);
  }
  // 未知 kind (成駒や仕様外) は残りを追加
  for (const [k, files] of groups) {
    files.sort((a, b) => a - b);
    parts.push(`${k}@${files.join(',')}`);
  }
  if (unresolved.length > 0) parts.push(`?[${unresolved.join(',')}]`);
  return parts.join('+');
}

function formatClickEntry(
  entry: DebugClickEntry,
  infoMap: Map<string, { initialKind: string; initialSquare: { row: number; col: number } }>,
): string {
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
    parts.push(`candidates(${arr.length})=[${formatCandidatePieceIds(arr, infoMap)}]`);
  }
  return parts.join(' ');
}

function formatCandidateChangeEntry(
  entry: DebugCandidateChangeEntry,
  infoMap: Map<string, { initialKind: string; initialSquare: { row: number; col: number } }>,
): string {
  const t = new Date(entry.time);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const parts: string[] = [
    `[${hh}:${mm}:${ss}]`,
    `mv${entry.moveNumber}`,
    `${entry.pieceId}`,
    `[${formatCandidatePieceIds(entry.before, infoMap)}]→[${formatCandidatePieceIds(entry.after, infoMap)}]`,
  ];
  if (entry.removed.length > 0) parts.push(`removed=[${formatCandidatePieceIds(entry.removed, infoMap)}]`);
  if (entry.added.length > 0) parts.push(`added=[${formatCandidatePieceIds(entry.added, infoMap)}]`);
  return parts.join(' ');
}

/**
 * ★v1.62: 「窓 → 盤」1 件を、そのまま貼って渡せる 1 行にする（2026-08-20 ユーザーご依頼）。
 *
 * 桁を揃えて書く＝**縦に並べたときに、どこで急に小さくなったかが目で追える**ようにする。
 */
function formatLayoutEntry(entry: DebugLayoutEntry): string {
  const t = new Date(entry.time);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const win = `${entry.vw}x${entry.vh}`.padEnd(9, ' ');
  const shape = entry.landscape ? '横長' : '縦長';
  const fixed = (entry.fixed === null ? '--' : String(entry.fixed)).padStart(4, ' ');
  const board = String(entry.boardPx).padStart(4, ' ');
  const cell = entry.cellPx.toFixed(1).padStart(5, ' ');
  const over = entry.overflowX === 0 && entry.overflowY === 0
    ? 'はみ出し無し'
    : `はみ出し 横${entry.overflowX} 縦${entry.overflowY}`;
  return `[${hh}:${mm}:${ss}] 窓 ${win} ${shape} 引${fixed} 盤${board} マス${cell} ${over}`;
}

/**
 * ★v1.62: 文字を写し取る。**うまくいかない環境でも黙って終わらせない**
 * （記憶＝灰色や無反応で「成功」を表さない）ので、取れなかったときは
 * 選択状態にして「自分で写せる」状態にする。
 */
function copyText(text: string) {
  if (!text) return;
  const done = () => window.alert('コピーしました');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  window.alert(ok ? 'コピーしました' : 'コピーできませんでした。枠の中を選んで写してください。');
}
