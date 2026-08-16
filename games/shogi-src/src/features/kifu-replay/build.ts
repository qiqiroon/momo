/**
 * いま画面に出ている対局から棋譜ファイルを組み立てる。
 *
 * 指し手の列は**局面が自分で持っている履歴**をそのまま使う (待ったで巻き戻せば
 * 履歴も一緒に戻るので、常に「盤に出ている通り」になる)。
 */

import { useGameStore, winnerOf } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { get as pluginGet } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import { KIFU_FORMAT, KIFU_VERSION, type KifuFile, type KifuOpponent, type KifuPlayer } from './types';

/**
 * 対局者名の既定。名乗っていない相手は空文字で返ってくるので、ここで埋める。
 * 画面の表示名 (t('player.you') 等) は言語で変わるため使わない
 * ＝棋譜は保存した端末の言語に左右されないようにする。
 */
const ANON_HUMAN = '';

export function buildKifuFile(now: Date): KifuFile {
  const g = useGameStore.getState();
  const ai = useAiStore.getState();
  const c = pluginGet<OnlineGameConnector>('gameConnector');
  const online = c?.isOnline() === true;

  // 誰と指したか。オンラインが最優先 (オンライン中は対 AI にならない)。
  const opponent: KifuOpponent = online ? 'net' : ai.enabled ? 'com' : 'f2f';

  const aiPlayer = (): KifuPlayer => ({
    name: 'AI',
    kind: 'ai',
    engineId: ai.engineId,
    level: ai.level,
  });
  const humanPlayer = (name: string): KifuPlayer => ({ name: name || ANON_HUMAN, kind: 'human' });

  let player1: KifuPlayer;
  let player2: KifuPlayer;
  let viewerSide: 'player1' | 'player2' | null;
  if (opponent === 'com') {
    const aiSide = ai.aiSide;
    viewerSide = aiSide === 'player1' ? 'player2' : 'player1';
    player1 = aiSide === 'player1' ? aiPlayer() : humanPlayer('');
    player2 = aiSide === 'player2' ? aiPlayer() : humanPlayer('');
  } else if (opponent === 'net') {
    const mySide = c?.getMySide() ?? 'player1';
    viewerSide = mySide;
    const me = humanPlayer(c?.getMyName() ?? '');
    const opp = humanPlayer(c?.getOpponentName() ?? '');
    player1 = mySide === 'player1' ? me : opp;
    player2 = mySide === 'player2' ? me : opp;
  } else {
    // 同じ端末で二人。「自分」が定まらないので勝敗は先手視点で書く (親 §9.2.2)。
    viewerSide = null;
    player1 = humanPlayer('');
    player2 = humanPlayer('');
  }

  return {
    format: KIFU_FORMAT,
    version: KIFU_VERSION,
    meta: {
      savedAt: toLocalIso(now),
      opponent,
      gameType: g.currentGameType,
      quantum: g.currentQuantum,
      torus: g.currentTorusMode,
      handicap: g.currentHandicap
        ? { typeId: g.currentHandicap.typeId, giver: g.currentHandicap.giver }
        : null,
      players: { player1, player2 },
      viewerSide,
      result: {
        status: g.status,
        winner: winnerOf(g.status, g.position.sideToMove),
      },
      moveCount: g.position.history.length,
      timeControl: g.timeControl,
    },
    moves: g.position.history.map((m) => ({ ...m })),
    moveTexts: [...g.moveHistory],
  };
}

/**
 * ISO 8601 を**端末の時刻帯のまま**書く。
 * `toISOString()` は世界標準時に直してしまい、日付が 1 日ずれて見えることがある
 * (日本の朝 9 時前に指した対局が前日の日付になる)。ファイル名の日付とも食い違う。
 */
export function toLocalIso(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`
  );
}
