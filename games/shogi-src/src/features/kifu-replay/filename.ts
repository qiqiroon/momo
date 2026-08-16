/**
 * 棋譜ファイルの名前 (親 §9.2.2)。
 *
 * ```
 * YYMMDD_HHMM_相手_ルール[_モディファイア]_結果[_相手の名前][_連番].json
 * ```
 *
 * **狭い画面で末尾まで見えること**が規約の目的 (拡張子込み 30 文字前後)。
 * iOS では書類ピッカーが唯一の探し場所で、アプリ側から並べ替えも場所指定もできないため、
 * 素性を詰め込むより視認性を優先する。
 *
 * **名前は探すための手がかりであって正本ではない**。ユーザーが自由に改名できるので、
 * **名前から素性を読み戻してはならない** (素性の正本は必ずファイルの中身＝ meta)。
 */

import type { KifuFile } from './types';

/** ファイル名に使えない文字と、区切りに使っている `_`・空白を落とす。 */
function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f/\\:*?"<>|_\s.]/g, '');
}

/**
 * 「漢字 2 文字またはアルファベット 4 文字」に切り詰める。
 * 半角 1・全角 2 として数え、幅 4 を超えたところで止める＝混ざっていても破綻しない。
 */
function clipName(raw: string): string {
  const s = sanitizeName(raw);
  let width = 0;
  let out = '';
  for (const ch of s) {
    const w = ch.charCodeAt(0) < 0x80 ? 1 : 2;
    if (width + w > 4) break;
    width += w;
    out += ch;
  }
  return out;
}

function rulePart(gameType: string): string {
  if (gameType === 'shogi') return 'HON';
  if (gameType === 'hasami') return 'HAS';
  return 'CUS';
}

/**
 * モディファイア。**無いときは空文字を返し、欄ごと省く**。
 * 円筒と完全トーラスは別物なので 1 文字ずつ分ける (`C` / `T`)。
 */
function modifierPart(quantum: boolean, torus: 'none' | 'cylinder' | 'full'): string {
  const t = torus === 'cylinder' ? 'C' : torus === 'full' ? 'T' : '';
  return `${quantum ? 'Q' : ''}${t}`;
}

/**
 * 結果。`W` 勝ち / `L` 負け / `D` 引分 / `X` 不成立・中断。
 * **同じ端末の二人対局は先手から見て書く** (自分が 2 人居るため・親 §9.2.2)。
 */
function resultPart(file: KifuFile): 'W' | 'L' | 'D' | 'X' {
  const { result, viewerSide } = file.meta;
  if (result.status === 'playing' || result.status === 'nogame') return 'X';
  if (result.winner === null) return 'D';
  const me = viewerSide ?? 'player1';
  return result.winner === me ? 'W' : 'L';
}

/** 相手を表す欄。対 AI は強さの頭文字、ネット対戦は相手の名前、二人対局は後手の名前。 */
function opponentPart(file: KifuFile): string {
  const { opponent, players, viewerSide } = file.meta;
  if (opponent === 'com') {
    const lv = players.player1.kind === 'ai' ? players.player1.level : players.player2.level;
    return lv ? lv.charAt(0).toUpperCase() : '';
  }
  if (opponent === 'net') {
    const oppSide = viewerSide === 'player1' ? 'player2' : 'player1';
    return clipName(players[oppSide].name);
  }
  return clipName(players.player2.name);
}

/**
 * 棋譜ファイルの名前を組み立てる。
 * `seq` は同じ分に 2 局以上終わったときの連番 (0 なら付けない)。
 */
export function kifuFileName(file: KifuFile, seq = 0): string {
  const d = new Date(file.meta.savedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  const who = file.meta.opponent.toUpperCase();
  const parts = [stamp, who, rulePart(file.meta.gameType)];
  const mod = modifierPart(file.meta.quantum, file.meta.torus);
  if (mod) parts.push(mod);
  parts.push(resultPart(file));
  const opp = opponentPart(file);
  if (opp) parts.push(opp);
  if (seq > 0) parts.push(String(seq + 1));
  return `${parts.join('_')}.json`;
}
