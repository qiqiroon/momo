/**
 * AI に手番を引き受けさせる係 (Phase 3)。
 *
 * 対局画面から呼ぶと、AI の手番になったときだけ考えさせて 1 手指す。盤に反映する入口は
 * 相手の着手を受け取るのと同じ道 (applyRemoteMove) を使う。**自分で指した手ではない**
 * ので送信もされず、合法かどうかもそこで確かめられる。
 *
 * 考えている間に局面が変わった場合 (待った・投了・リセット) は、返ってきた手を捨てる。
 * 「いつ頼んだ手か」を手数と手番で覚えておき、答えが返った時点の局面と突き合わせる。
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/game-store';
import { useAiStore, isSmallScreen, THINK_BUDGET_CAP_MS } from '../store/ai-store';
import { findEngine, defaultEngine, supports } from '../ai/engine-registry';
import { aiModeFrom } from '../ai/mode';
import type { EngineAdapter } from '../ai/types';
import { thinkBudgetMs } from '../ai/think-budget';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';

/**
 * 「いつ頼んだ手か」の合印。
 *
 * ★v1.53: **巻き戻した回数を混ぜる**（2026-08-18 ユーザー報告「待ったをかけると
 * AI が指さなくなる」）。手数と手番だけで名乗ると、**待ったで 1 手戻った先は、
 * 直前に AI が考えたのとまったく同じ合印**になる。すると AI は「もう頼んだ手番だ」と
 * 見て**二度と考えない**（＝指さなくなる）。
 *
 * 巻き戻しは**手の並びが短くなること**で分かるので、その回数を数えて混ぜる。
 * 答えが返ったときの照合にも同じ合印を使う＝**戻された盤に古い答えを置かない**。
 * 盤の作り直し（新しい対局・リセット）も並びが 0 に戻るので同じ数え方で拾える。
 */
function turnKey(rewinds: number, moveNumber: number, side: string): string {
  return `${rewinds}:${moveNumber}:${side}`;
}

/**
 * 対 AI 対局を進める。オンライン対局中は何もしない (AI は対人戦に混ざらない)。
 */
export function useAiOpponent(isOnline: boolean): void {
  const enabled = useAiStore((s) => s.enabled);
  const aiSide = useAiStore((s) => s.aiSide);
  const engineId = useAiStore((s) => s.engineId);
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const position = useGameStore((s) => s.position);
  const anomaly = useGameStore((s) => s.anomaly);

  const engineRef = useRef<EngineAdapter | null>(null);
  const startedKeyRef = useRef<string | null>(null);
  /** 盤が巻き戻された回数（待った・リセット・新しい対局）。合印に混ぜる。 */
  const rewindsRef = useRef(0);
  const seenLenRef = useRef(0);

  /**
   * ★v1.53: 巻き戻しを見張る。**AI へ頼む側より先に数える**ので、この効果を先に置く
   * （同じ描き直しではここが先に走る）。手の並びが短くなったら 1 つ数える。
   */
  useEffect(() => {
    const len = position.history.length;
    if (len < seenLenRef.current) rewindsRef.current++;
    seenLenRef.current = len;
  }, [position]);

  // 画面を離れるときは考えるのをやめる (別スレッドも片付ける)
  useEffect(() => {
    return () => {
      engineRef.current?.quit();
      engineRef.current = null;
      startedKeyRef.current = null;
      useAiStore.getState().setThinking(false);
    };
  }, []);

  useEffect(() => {
    if (!enabled || isOnline) return;
    if (status !== 'playing' || paused) return;
    if (anomaly) return; // 量子の異常が出ている間は人の判断待ち
    if (position.sideToMove !== aiSide) return;

    const key = turnKey(rewindsRef.current, position.moveNumber, position.sideToMove);
    if (startedKeyRef.current === key) return; // 同じ手番で二重に頼まない
    startedKeyRef.current = key;

    // 親 §7.1.1: どの思考ルーチンを使うかはモード (ルール x モディファイア) で決まる。
    // S03 で選んだものがこの対局のモードに対応していなければ、そのモードの既定へ移す。
    // 盤の端のつなぎ方と量子は対局中の実値 (game-store) を見る。ルールの種類だけは
    // 対局設定側にしか無いので、通信モジュールが積まれていなければ本将棋として扱う。
    const gs0 = useGameStore.getState();
    const mode = aiModeFrom({
      gameType: pluginGet<OnlineGameConnector>('gameConnector')?.getActiveRules()?.gameType ?? 'shogi',
      torusMode: gs0.currentTorusMode,
      quantum: gs0.currentQuantum,
    });
    const picked = engineId ? findEngine(engineId) : undefined;
    const descriptor = picked && supports(picked, mode) ? picked : defaultEngine(mode);
    if (!descriptor) return; // 思考ルーチンが 1 つも積まれていない (A ビルド)
    if (!engineRef.current || engineRef.current.id !== descriptor.id) {
      engineRef.current?.quit();
      engineRef.current = descriptor.create();
    }
    const engine = engineRef.current;

    const { mgf, timeControl, clocks } = useGameStore.getState();
    const ai = useAiStore.getState();
    // 持ち時間から割り出した上限。**段が求める時間との小さい方**を思考ルーチンが採る
    // (親 §7.5.3)。core は段の名前を渡すだけで、具体値には触らない。
    const budget = thinkBudgetMs(timeControl, clocks[aiSide], THINK_BUDGET_CAP_MS);

    engine.init(mgf);
    engine.setPosition(position);
    ai.setThinking(true);

    void engine
      .go({ movetimeMs: budget, level: ai.level, mobile: isSmallScreen() }, (p) => {
        useAiStore.getState().setLastThink({ depth: p.depth, nodes: p.nodes, elapsedMs: p.elapsedMs });
      })
      .then((move) => {
        useAiStore.getState().setThinking(false);
        if (!move) return; // 指す手が無い (詰み・手詰まり) → 対局側の判定に任せる

        // 考えている間に局面が動いていたら捨てる
        const now = useGameStore.getState();
        if (turnKey(rewindsRef.current, now.position.moveNumber, now.position.sideToMove) !== key)
          return;
        if (now.status !== 'playing') return;

        if (move.type === 'move') {
          now.applyRemoteMove({
            kind: 'move',
            pieceId: move.pieceId,
            from: move.from,
            to: move.to,
            promote: move.promote,
          });
        } else {
          now.applyRemoteMove({ kind: 'drop', pieceId: move.pieceId, to: move.to });
        }
      })
      .catch(() => {
        useAiStore.getState().setThinking(false);
      });
  }, [enabled, isOnline, aiSide, engineId, status, paused, position, anomaly]);
}
