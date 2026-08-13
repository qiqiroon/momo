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
import { useAiStore } from '../store/ai-store';
import { findEngine, defaultEngine } from '../ai/engine-registry';
import type { EngineAdapter } from '../ai/types';
import { thinkBudgetMs } from '../ai/think-budget';

function turnKey(moveNumber: number, side: string): string {
  return `${moveNumber}:${side}`;
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

    const key = turnKey(position.moveNumber, position.sideToMove);
    if (startedKeyRef.current === key) return; // 同じ手番で二重に頼まない
    startedKeyRef.current = key;

    const descriptor = (engineId ? findEngine(engineId) : undefined) ?? defaultEngine();
    if (!descriptor) return; // 思考ルーチンが 1 つも積まれていない (A ビルド)
    if (!engineRef.current || engineRef.current.id !== descriptor.id) {
      engineRef.current?.quit();
      engineRef.current = descriptor.create();
    }
    const engine = engineRef.current;

    const { mgf, timeControl, clocks } = useGameStore.getState();
    const ai = useAiStore.getState();
    const budget = thinkBudgetMs(timeControl, clocks[aiSide], ai.thinkMs);

    engine.init(mgf);
    engine.setPosition(position);
    ai.setThinking(true);

    void engine
      .go({ movetimeMs: budget, depth: ai.maxDepth }, (p) => {
        useAiStore.getState().setLastThink({ depth: p.depth, nodes: p.nodes, elapsedMs: p.elapsedMs });
      })
      .then((move) => {
        useAiStore.getState().setThinking(false);
        if (!move) return; // 指す手が無い (詰み・手詰まり) → 対局側の判定に任せる

        // 考えている間に局面が動いていたら捨てる
        const now = useGameStore.getState();
        if (turnKey(now.position.moveNumber, now.position.sideToMove) !== key) return;
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
