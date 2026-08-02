// ── 保存・読込（概要設計書 v0.02 第10章）
//   盤面を kjboard 形式の JSON で書き出し／読み込む。外部送信なし（ローカルのみ）。
//   退避カードも含めて保存する（復活のため）。読込時は format/version を検証する。

import type { Board } from '../types';
import { BOARD_FORMAT } from '../types';

export function downloadBoard(board: Board, filename = 'kjboard'): void {
  const json = JSON.stringify(board, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ParseBoardResult {
  ok: boolean;
  board?: Board;
  error?: string;
}

/** JSON文字列を検証して Board にする。壊れていれば ok:false＋理由。 */
export function parseBoardJson(text: string): ParseBoardResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSONとして読み取れませんでした。' };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: '盤面データの形式ではありません。' };
  }
  const obj = data as Record<string, unknown>;
  if (obj.format !== BOARD_FORMAT) {
    return { ok: false, error: 'kjboard 形式のファイルではありません。' };
  }
  const board: Board = {
    format: BOARD_FORMAT,
    version: typeof obj.version === 'string' ? obj.version : '0.01',
    purpose: {
      message: str((obj.purpose as Record<string, unknown>)?.message),
      audience: str((obj.purpose as Record<string, unknown>)?.audience),
      tone: str((obj.purpose as Record<string, unknown>)?.tone),
    },
    cards: Array.isArray(obj.cards) ? (obj.cards as Board['cards']) : [],
    groups: Array.isArray(obj.groups) ? (obj.groups as Board['groups']) : [],
    relations: Array.isArray(obj.relations) ? (obj.relations as Board['relations']) : [],
  };
  return { ok: true, board };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
