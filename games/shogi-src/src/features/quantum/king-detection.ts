/**
 * §Q13.4 王手判定の量子拡張 (Phase 5-10)。
 *
 * 通常将棋モードの findKing は「盤上で kind='ou' な駒を探す」で完結するが、
 * 量子モードでは初期玉位置に置かれた駒も他の駒と区別されないので、候補集合が
 * 1 個に絞られ、その正体が royal な PieceID になった駒だけが玉。
 *
 * 呼び出し側 (core/engine/moves/check.ts findKing) は plugin registry 経由で
 * 本関数を取得する。features/quantum が import されない A ビルド (通常将棋モード
 * 単独) では hook 未登録 → 従来通り kind ベースで動作する。
 */

import type { Mgf, Player } from '../../core/engine/mgf/types';
import type { PieceId, Position, Square } from '../../core/engine/position/types';
import { buildInitialInfoMap } from './piece-lookup';

export function findConfirmedKing(mgf: Mgf, position: Position, player: Player): Square | null {
  const royalKinds = new Set<string>();
  for (const p of mgf.pieces) if (p.is_royal) royalKinds.add(p.id);

  const infoMap = buildInitialInfoMap(position);
  const royalPieceIds = new Set<PieceId>();
  for (const [pid, info] of infoMap) if (royalKinds.has(info.initialKind)) royalPieceIds.add(pid);

  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== player) continue;
      if (cell.candidates === undefined) {
        // 通常将棋モード縮退: 候補なし → 従来通り kind で判定 (mgf 混在対策)
        if (royalKinds.has(cell.kind)) return { row, col };
        continue;
      }
      // 量子モード: 候補が 1 つに絞れて、それが royal な PieceID なら王
      if (cell.candidates.size !== 1) continue;
      const only = cell.candidates.values().next().value as PieceId;
      if (royalPieceIds.has(only)) return { row, col };
    }
  }
  return null;
}
