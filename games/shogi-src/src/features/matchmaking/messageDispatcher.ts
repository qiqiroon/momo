/**
 * P2P で受信したゲームメッセージを type 別に処理する dispatcher。
 *
 * LobbyScreen の onMessage コールバックからここに転送される。
 * 各ハンドラは store の setState と、必要なら画面遷移を行う。
 *
 * 段階 2-5.1（S06 対局準備画面のハンドシェイク）:
 * - side_select    → oppSideChoice を更新
 * - ready          → oppReady を更新
 * - state_sync     → oppSideChoice / oppReady をまとめて更新
 * - furigoma_result → 振り駒結果を反映（両者同期）
 * - game_start     → gameStartInfo を確定して S07 対局画面へ遷移
 *
 * 段階 2-5.2（S07 対局中の着手送受信）:
 * - move           → 相手の着手を game-store に適用
 *
 * 知らない type や不正な形式は黙って無視（フォワード互換）。
 */

import { useChatStore } from '../../core/store/chat-store';
import { useRouteStore } from '../../core/store/route-store';
import { useGameStore } from '../../core/store/game-store';
import { useOffersStore } from '../../core/store/offers-store';
import { isShogiMessage, type ShogiMessage } from './protocol';
import { useMatchmakingStore } from './store';

export function handleShogiMessage(data: unknown): void {
  if (!isShogiMessage(data)) return;
  const msg = data as ShogiMessage;
  switch (msg.type) {
    case 'side_select': {
      // 相手の選択変更 → 相手の準備完了は解除
      // 加えて、両者おまかせが崩れる変更なら振り駒結果もリセット
      const state = useMatchmakingStore.getState();
      const nextPatch: {
        oppSideChoice: typeof msg.choice;
        oppReady: boolean;
        furigomaResult?: null;
      } = {
        oppSideChoice: msg.choice,
        oppReady: false,
      };
      if (state.furigomaResult && (state.mySideChoice !== 'random' || msg.choice !== 'random')) {
        nextPatch.furigomaResult = null;
      }
      useMatchmakingStore.setState(nextPatch);
      return;
    }
    case 'ready': {
      useMatchmakingStore.setState({ oppReady: msg.ready });
      return;
    }
    case 'state_sync': {
      useMatchmakingStore.setState({ oppSideChoice: msg.choice, oppReady: msg.ready });
      return;
    }
    case 'furigoma_result': {
      // ホストから配信された振り駒結果。両者が同じ結果でアニメ表示。
      useMatchmakingStore.setState({
        furigomaResult: { faceUps: msg.faceUps, hostIsSente: msg.hostIsSente },
      });
      return;
    }
    case 'game_start': {
      // v0.32: game_start では chat をクリアしない（S06 の対局前チャットが対局中も残る）
      // 再対局時は returnToPreparation で明示的にクリアする
      useMatchmakingStore.setState({
        gameStartInfo: { hostSide: msg.hostSide, guestSide: msg.guestSide },
      });
      // v0.35: 部屋の timeControl を game-store に反映（先手の時計が動き始める）
      const tc = useMatchmakingStore.getState().activeRoomConfig?.timeControl;
      if (tc) useGameStore.getState().setTimeControl(tc);
      useRouteStore.getState().setScreen('game');
      return;
    }
    case 'move': {
      // 相手の着手を盤面に反映（合法性の相互検証は段階 2-6 で追加予定）
      const applied = useGameStore.getState().applyRemoteMove({
        kind: msg.kind,
        pieceId: msg.pieceId,
        from: msg.from,
        to: msg.to,
        promote: msg.promote,
      });
      // v0.35: 送信側の時計状態を反映（受信側は指し手側の残り時間をシンク）
      if (applied && msg.time) {
        // 指し手側 = 直前の position.sideToMove（applyRemoteMove 内で position が更新される前）
        // applyAndCommit 後は position.sideToMove が入れ替わっているので、その反対が moverSide
        const nextSide = useGameStore.getState().position.sideToMove;
        const moverSide: 'player1' | 'player2' = nextSide === 'player1' ? 'player2' : 'player1';
        useGameStore.getState().syncClock(moverSide, {
          mainMs: msg.time.mainMs,
          byoyomiMs: msg.time.byoyomiMs,
          inByoyomi: msg.time.inByoyomi,
        });
      }
      return;
    }
    case 'timeout': {
      // 相手からの時間切れ通知（段階 2-8 v0.35）。既に対局が終わっていれば no-op。
      useGameStore.getState().timeout(msg.side);
      return;
    }
    case 'chat': {
      // 相手からのチャット発言をローカル履歴に追加（段階 2-7 v0.28）
      useChatStore.getState().addMessage(msg.side, msg.text);
      return;
    }
    case 'resign': {
      // 相手からの投了通知を盤面状態に反映（段階 2-7 v0.30）
      useGameStore.getState().resign(msg.side);
      return;
    }
    case 'draw_offer': {
      // 相手からの引分申し出（段階 2-7 v0.33）→ 自分側で「相手が申し出中」を立てる
      useOffersStore.getState().setDrawOfferFrom('opp');
      return;
    }
    case 'draw_response': {
      // 自分が申し出た引分への相手の応答（段階 2-7 v0.33）
      useOffersStore.getState().setDrawOfferFrom(null);
      useOffersStore.getState().setLastResponse('draw', msg.accepted);
      if (msg.accepted) {
        useGameStore.getState().agreeDraw();
      }
      return;
    }
    case 'undo_offer': {
      // 相手からの待った申し出（段階 2-7 v0.33）
      useOffersStore.getState().setUndoOfferFrom('opp');
      return;
    }
    case 'undo_response': {
      // 自分が申し出た待ったへの相手の応答（段階 2-7 v0.33）
      useOffersStore.getState().setUndoOfferFrom(null);
      useOffersStore.getState().setLastResponse('undo', msg.accepted);
      if (msg.accepted) {
        useGameStore.getState().undoLastMove(msg.count ?? 1);
      }
      return;
    }
    default: {
      // 未知の type は無視（フォワード互換）
      return;
    }
  }
}
