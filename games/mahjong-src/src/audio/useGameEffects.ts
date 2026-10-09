// 対局の音と演出（訂正26100917・2026-10-09）。局面の変化を見て鳴らす・出す。ルール部分には触らない。
// - 局の始め：牌を混ぜる音 → 配る音を配る動きの回数（4 枚ずつ 3 回＋1 枚）だけ鳴らし、手牌を少しずつ見せる
// - ツモ・打牌・鳴き（チー・ポン・カン）の音
// - リーチ：その人の手牌の上を「リーチ」が左から右へ流れ、中央に大きく出る（花札のこいこいと同じ）＋ BGM を立直用へ
// - アガリ：自分がアガった＝「ロン！」「ツモ！」とファンファーレ／自分が振り込んだ＝「振り込み…」と負けの音
// - 対局の終わり：1 位＝「勝利！」とファンファーレ 2 つ＋くす玉／それ以外＝負けの音
// - BGM：対局中は麻雀用（誰かがリーチしている局は立直用）、それ以外（トップ・再生）はロビー共通。対局が終わったら止める

import { useEffect, useRef, useState } from 'react';
import type { Seat } from '../engine/events';
import { finalResult } from '../engine/final';
import type { GameState } from '../engine/state';
import { DICE_SHOW_MS, HUMAN, dealShowOn, showsDice } from '../game/useTable';
import { isAudioRunning, playRandomBgm, playSample, stopBgm, type BgmPool } from './engine';

/** 混ぜる音を聞かせる長さ（素材は 8.95 秒あるので途中で消す） */
const SHUFFLE_MS = 1500;
/** 配る 1 回ごとの間 */
const DEAL_STEP_MS = 300;
/** 配る動き：4 枚ずつ 3 回・最後に 1 枚 */
const DEAL_STEPS = [4, 8, 12, 13];
/** 演出の全体の長さ（useTable の DEAL_SHOW_MS と同じにする） */
export const DEAL_TOTAL_MS = SHUFFLE_MS + DEAL_STEP_MS * DEAL_STEPS.length;

export type BannerKind = 'dice' | 'riichi' | 'ron' | 'tsumo' | 'dealIn' | 'win' | 'lose';
export interface Banner {
  kind: BannerKind;
  /** リーチした席（流れる帯の高さを決める）・親決めで起家になった席 */
  seat?: Seat;
  /** 親決めのサイコロの目 */
  dice?: [number, number];
  /** 同じ種類を続けて出しても動き直すための番号 */
  key: number;
}

const total = (xs: readonly (readonly unknown[])[]) => xs.reduce((n, x) => n + x.length, 0);

export function useGameEffects(view: GameState, live: boolean) {
  const prev = useRef<GameState | null>(null);
  /** 配っている途中で見せる手牌の枚数（null＝全部見せる） */
  const [dealt, setDealt] = useState<number | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [kusudama, setKusudama] = useState(false);
  const timers = useRef<number[]>([]);
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
  const show = (b: Omit<Banner, 'key'>) => setBanner({ ...b, key: Date.now() + Math.random() });

  // 対局から離れたら、途中の演出を止めて消す
  useEffect(() => {
    if (live) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    prev.current = null;
    setDealt(null);
    setBanner(null);
    setKusudama(false);
  }, [live]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!live) return;
    const p = prev.current;
    prev.current = view;
    // 局の始め（配り終えて最初のツモの前）
    if (view.phase === 'deal' && (!p || p.phase !== 'deal')) {
      setKusudama(false);
      if (!dealShowOn()) return;
      setDealt(0);
      // 対局の最初の局は、先に親決めのサイコロを見せる
      const t0 = showsDice(view) && view.dealerDice ? DICE_SHOW_MS : 0;
      if (t0 > 0) {
        show({ kind: 'dice', dice: view.dealerDice!, seat: view.chicha });
        playSample('deal');
        later(400, () => playSample('deal'));
      }
      later(t0, () => playSample('shuffle', { trimSec: SHUFFLE_MS / 1000 }));
      DEAL_STEPS.forEach((n, i) =>
        later(t0 + SHUFFLE_MS + DEAL_STEP_MS * i, () => {
          setDealt(n);
          playSample('deal');
        }),
      );
      later(t0 + DEAL_TOTAL_MS, () => setDealt(null));
      return;
    }
    if (!p) return;
    // 鳴き（チー・ポン・カン）
    if (total(view.melds) > total(p.melds)) playSample('deal');
    // 打牌
    else if (total(view.discards) > total(p.discards)) playSample('discard');
    // ツモ（嶺上牌も）
    if (view.drawn.some((d, i) => d !== null && d !== p.drawn[i])) playSample('draw');
    // リーチ
    const riichiSeat = view.riichi.findIndex((r, i) => r !== 'none' && p.riichi[i] === 'none');
    if (riichiSeat >= 0) {
      show({ kind: 'riichi', seat: riichiSeat as Seat });
      playSample('riichiSlide', { at: 0.06 });
      later(1000, () => playSample('riichiFlash'));
    }
    // 局の結果
    const r = view.result;
    if (r && !p.result) {
      if ((r.type === 'tsumo' && r.seat === HUMAN) || (r.type === 'ron' && r.wins.some((w) => w.seat === HUMAN))) {
        show({ kind: r.type === 'tsumo' ? 'tsumo' : 'ron' });
        playSample('fanfareWin');
      } else if (r.type === 'ron' && r.from === HUMAN) {
        show({ kind: 'dealIn' });
        playSample('gameLose');
      }
    }
    // 対局の終わり（局の結果の演出が済むころに出す）
    if (view.phase === 'gameover' && p.phase !== 'gameover') {
      const first = finalResult(view).find((row) => row.rank === 1);
      later(1600, () => {
        if (first?.seat === HUMAN) {
          show({ kind: 'win' });
          playSample('fanfareWin');
          playSample('fanfareWin2', { at: 0.8 });
          setKusudama(true);
        } else {
          show({ kind: 'lose' });
          playSample('gameLose');
        }
      });
    }
  }, [view, live]);

  // BGM（音の出口が開いているときだけ。開く前は「音楽を再生しますか？」で選んだときに始める）
  const pool: BgmPool | null = !live
    ? 'lobby'
    : view.phase === 'gameover'
      ? null
      : view.phase !== 'ended' && view.riichi.some((r) => r !== 'none')
        ? 'riichi'
        : 'game';
  const syncBgm = () => {
    if (!isAudioRunning()) return;
    if (pool === null) stopBgm();
    else void playRandomBgm(pool);
  };
  useEffect(syncBgm, [pool]);

  return { dealt, banner, kusudama, syncBgm };
}
