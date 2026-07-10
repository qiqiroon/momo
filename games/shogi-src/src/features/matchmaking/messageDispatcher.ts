/**
 * P2P で受信したゲームメッセージを type 別に処理する dispatcher。
 *
 * LobbyScreen の onMessage コールバックからここに転送される。
 * 各ハンドラは store の setState と、必要なら画面遷移を行う。
 *
 * 段階 2-5.1（S06 対局準備画面のハンドシェイク）:
 * - side_select   → oppSideChoice を更新
 * - ready         → oppReady を更新
 * - state_sync    → oppSideChoice / oppReady をまとめて更新
 * - game_start    → gameStartInfo を確定して S07 対局画面へ遷移
 *
 * 知らない type や不正な形式は黙って無視（フォワード互換）。
 */

import { useRouteStore } from '../../core/store/route-store';
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
      useMatchmakingStore.setState({
        gameStartInfo: { hostSide: msg.hostSide, guestSide: msg.guestSide },
      });
      useRouteStore.getState().setScreen('game');
      return;
    }
    default: {
      // 未知の type は無視（フォワード互換）
      return;
    }
  }
}
