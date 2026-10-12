// CPU の強さ Easy（段階7の2）。考えに入れるのは「アガリまでの近さ（向聴数）」と「役が無くならないこと」だけ。
// 待ちの広さ・点数・守りは見ない（リーチされても押す）。狙いのぶれは入れない＝同じ局面では必ず同じ手。
//
// - アガれるならアガる。テンパイになったらリーチする（門前なら役は必ず付く）
// - 切る牌：切ったあと一番アガリに近い牌。同じなら一番孤立している牌（つながりの少ない牌）
// - 鳴き：役牌の対子だけポンする。役牌を鳴いたあとは、近づくチー・ポンもする（役が付いている）。カンはしない
// - 九種九牌は流す。流局ではテンパイと言う。オーラスでトップの親はやめる

import { kindCounts } from '../engine/agari';
import type { Seat } from '../engine/events';
import { legalActions, type Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { kindOf } from '../engine/tiles';
import { chooseQue, connection, hasOpenYakuhai, pick, shantenAfterCall, shantenAfterDiscard, yakuhaiKinds } from './common';
import { shanten } from './shanten';

export function easyCpu(view: GameState, seat: Seat): Action {
  const legal = legalActions(view, seat);
  if (legal.length === 0) throw new Error(`席 ${seat} はいま選べることが無い`);
  if (view.phase === 'que') return chooseQue(view, seat, legal);
  const win = pick(legal, 'tsumo') ?? pick(legal, 'ron') ?? pick(legal, 'tenpai');
  if (win) return win;
  const stop = legal.find((a) => a.type === 'yame' && a.stop);
  if (stop) return stop;
  if (view.phase === 'claim') return claimReply(view, seat, legal);
  const kyushu = pick(legal, 'kyushu');
  if (kyushu) return kyushu;
  const noten = pick(legal, 'noten');
  if (noten) return noten;
  return discard(view, seat, legal);
}

function claimReply(view: GameState, seat: Seat, legal: readonly Action[]): Action {
  const pass = pick(legal, 'pass')!;
  const c = view.claim!;
  const yakuhai = yakuhaiKinds(view, seat);
  const opened = hasOpenYakuhai(view, seat);
  const now = shanten(kindCounts(view.hands[seat]), view.melds[seat].length);
  for (const a of legal) {
    if (a.type !== 'pon' && a.type !== 'chi') continue;
    const yakuPon = a.type === 'pon' && yakuhai.has(kindOf(c.tile));
    if (!yakuPon && !opened) continue;
    if (shantenAfterCall(view, seat, a.tiles) < now) return a;
  }
  return pass;
}

function discard(view: GameState, seat: Seat, legal: readonly Action[]): Action {
  const after = shantenAfterDiscard(view, seat);
  const counts = kindCounts(view.hands[seat]);
  let best: Action | null = null;
  let bestKey: [number, number] = [99, 99];
  for (const a of legal) {
    if (a.type !== 'discard') continue;
    const key: [number, number] = [after(a.tile), connection(a.tile, counts)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) [best, bestKey] = [a, key];
  }
  if (!best || best.type !== 'discard') return legal[legal.length - 1];
  const tile = best.tile;
  // その牌でリーチできるならリーチする
  return legal.find((a) => a.type === 'riichi' && a.tile === tile) ?? best;
}
