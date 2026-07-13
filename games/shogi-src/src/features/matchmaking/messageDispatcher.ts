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
      useMatchmakingStore.setState({
        furigomaResult: { faceUps: msg.faceUps, hostIsSente: msg.hostIsSente },
      });
      return;
    }
    case 'game_start': {
      useMatchmakingStore.setState({
        gameStartInfo: { hostSide: msg.hostSide, guestSide: msg.guestSide },
      });
      const tc = useMatchmakingStore.getState().activeRoomConfig?.timeControl;
      if (tc) useGameStore.getState().setTimeControl(tc);
      useRouteStore.getState().setScreen('game');
      return;
    }
    case 'move': {
      const applied = useGameStore.getState().applyRemoteMove({
        kind: msg.kind,
        pieceId: msg.pieceId,
        from: msg.from,
        to: msg.to,
        promote: msg.promote,
      });
      if (applied && msg.time) {
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
      useGameStore.getState().timeout(msg.side);
      return;
    }
    case 'chat': {
      useChatStore.getState().addMessage(msg.side, msg.text);
      return;
    }
    case 'resign': {
      useGameStore.getState().resign(msg.side);
      return;
    }
    case 'draw_offer': {
      useOffersStore.getState().setDrawOfferFrom('opp');
      return;
    }
    case 'draw_response': {
      useOffersStore.getState().setDrawOfferFrom(null);
      useOffersStore.getState().setNotice('draw', msg.accepted ? null : 'rejected');
      if (msg.accepted) useGameStore.getState().agreeDraw();
      return;
    }
    case 'draw_cancel': {
      // 相手が引分申し出を撤回（v0.42）
      useOffersStore.getState().setDrawOfferFrom(null);
      useOffersStore.getState().setNotice('draw', 'cancelled');
      return;
    }
    case 'undo_offer': {
      // 相手からの待った申し出（v0.42：count / challengerSide 付き）
      useOffersStore.getState().setUndoOfferFrom('opp', {
        count: msg.count,
        challengerSide: msg.challengerSide,
      });
      return;
    }
    case 'undo_response': {
      // 自分が申し出た待ったへの相手の応答（v0.42）
      // 承諾時は「承諾者の時計だけ復元」＝申し出者側は penalty で保持
      const meta = useOffersStore.getState().undoOfferMeta;
      useOffersStore.getState().setUndoOfferFrom(null);
      useOffersStore.getState().setNotice('undo', msg.accepted ? null : 'rejected');
      if (msg.accepted && meta) {
        const restoreSide: 'player1' | 'player2' =
          meta.challengerSide === 'player1' ? 'player2' : 'player1';
        useGameStore.getState().undoLastMove(meta.count, { restoreClockForSide: restoreSide });
      }
      return;
    }
    case 'undo_cancel': {
      // 相手が待った申し出を撤回（v0.42）
      useOffersStore.getState().setUndoOfferFrom(null);
      useOffersStore.getState().setNotice('undo', 'cancelled');
      return;
    }
    case 'pause_notify': {
      // 相手が一時中断（v0.42：合意不要）→ 自分側も即中断
      useGameStore.getState().pauseGame();
      useOffersStore.getState().setNotice('pause', 'cancelled'); // 「相手が中断」を告知
      return;
    }
    case 'resume_offer': {
      useOffersStore.getState().setResumeOfferFrom('opp');
      return;
    }
    case 'resume_response': {
      useOffersStore.getState().setResumeOfferFrom(null);
      useOffersStore.getState().setNotice('resume', msg.accepted ? null : 'rejected');
      if (msg.accepted) useGameStore.getState().resumeGame();
      return;
    }
    default: {
      return;
    }
  }
}
