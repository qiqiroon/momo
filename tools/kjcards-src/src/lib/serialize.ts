// ── 受け渡しプロンプトの直列化（概要設計書 v0.02 第8章）
//   盤面の構造を、AIが読んで理解しやすい "見出し付き箇条書きテキスト" にする（§8.2）。
//   除外規則（§8.1）: status:parked のカードは載せない。端点に退避カードを含む関係線も除外。
//   一列の順番はアプリからは与えない（順番決めはAIの仕事）。

import type { Board, Card } from '../types';

function noteSuffix(note: string): string {
  const n = note.trim();
  return n ? `（${n}）` : '';
}

/**
 * 盤面（退避を除外済みの素材）を §8.2 の書式で直列化する。
 */
export function serializeBoard(board: Board): string {
  const active: Card[] = board.cards.filter((c) => c.status === 'active');
  const activeIds = new Set(active.map((c) => c.id));
  const groupIds = new Set(board.groups.map((g) => g.id));

  // グループに連番（G1, G2, …）を割り当てる
  const gNum = new Map<string, string>();
  board.groups.forEach((g, i) => gNum.set(g.id, `G${i + 1}`));

  const lines: string[] = [];

  // ■ 目的
  lines.push('■ 目的');
  lines.push(`- 伝えたいこと: ${board.purpose.message.trim() || '（未記入）'}`);
  if (board.purpose.audience.trim()) lines.push(`- 読み手: ${board.purpose.audience.trim()}`);
  if (board.purpose.tone.trim()) lines.push(`- 調子: ${board.purpose.tone.trim()}`);
  lines.push('');

  // ■ グループと中身
  lines.push('■ グループと中身');
  for (const g of board.groups) {
    const label = gNum.get(g.id);
    lines.push(`${label}【表札: ${g.name.trim() || '（無題）'}】`);
    const members = active.filter((c) => c.groupId === g.id);
    if (members.length === 0) {
      lines.push('  - （カードなし）');
    } else {
      for (const c of members) {
        lines.push(`  - ${c.title}${noteSuffix(c.note)}`);
      }
    }
  }
  // 未分類（active かつ groupId:null）
  const unfiled = active.filter((c) => c.groupId === null);
  if (unfiled.length > 0) {
    lines.push('（未分類）');
    for (const c of unfiled) {
      lines.push(`  - ${c.title}${noteSuffix(c.note)}`);
    }
  }
  lines.push('');

  // ■ 関係（端点に退避カードを含む関係線は除外）
  const refLabel = (id: string): string | null => {
    if (groupIds.has(id)) return gNum.get(id) ?? null;
    if (activeIds.has(id)) {
      const card = active.find((c) => c.id === id);
      return card ? `「${card.title}」` : null;
    }
    return null; // 退避カードや不明ID → この関係は落とす
  };

  const relLines: string[] = [];
  for (const r of board.relations) {
    const from = refLabel(r.from);
    const to = refLabel(r.to);
    if (from === null || to === null) continue; // 退避端点を含む → 除外
    relLines.push(`- ${from} →(${r.label})→ ${to}`);
  }
  if (relLines.length > 0) {
    lines.push('■ 関係');
    lines.push(...relLines);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
