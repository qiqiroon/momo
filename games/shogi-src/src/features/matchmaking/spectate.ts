/**
 * ネット観戦の「いまの対局を丸ごと配る／組み立て直す」(★v1.55・親 §6.8.4)。
 *
 * ## なぜ盤の絵ではなく「手の並び」を送るのか
 *
 * **並べ直せば、棋譜・持ち駒・量子の候補まで一度に揃う**ため。盤の絵だけを送ると
 * 「どうやってそこに至ったか」が失われ、**棋譜ペインが空のまま**になる。
 * **§6.3.6 の感想戦がまったく同じ問題を同じ形で解いてある**ので、その形を借りた
 * （2 つの画面で違う理屈を持たない）。
 *
 * ## なぜ差分ではないのか
 *
 * **観戦者は途中から入ってくる**ので、差分を積み上げる形では出発点が無い。
 * また差分は**届く順や取りこぼしでずれたことにも気づけない**（v1.43 §6.3.6 の
 * 感想戦で確かめた話がそのまま当てはまる）。
 *
 * ## 配ったあと
 *
 * **以降の着手は対局者どうしの `move` がそのまま観戦者にも届く**
 * （既定の宛先＝自分以外の全員・親 §6.2）ので、**観戦のための伝言はこれ 1 つで足りる**。
 */
import { useGameStore } from '../../core/store/game-store';
import { useRouteStore } from '../../core/store/route-store';
import type { Move } from '../../core/engine/position/types';
import { PROTOCOL_VERSION, type MoveMsg, type SpectateSyncMsg } from './protocol';
import { applySyncedRules, rulesFromConfig, startGameFromSides } from './rulesSync';
import { hasSeat } from './roster';
import { useMatchmakingStore } from './store';

/**
 * 対局の履歴を、そのまま送れる形（`move` の伝言と同じ形）に直す。
 *
 * **感想戦の「自由な手」は落とす**＝対局では生まれない種類であり、
 * 受け取った側が並べ直せないため（親 §9.4.2.1）。
 */
export function movesFromHistory(history: readonly Move[]): MoveMsg[] {
  const out: MoveMsg[] = [];
  for (const m of history) {
    if (m.type === 'move') {
      out.push({
        v: PROTOCOL_VERSION,
        type: 'move',
        kind: 'move',
        pieceId: m.pieceId,
        from: { row: m.from.row, col: m.from.col },
        to: { row: m.to.row, col: m.to.col },
        promote: m.promote,
      });
    } else if (m.type === 'drop') {
      out.push({
        v: PROTOCOL_VERSION,
        type: 'move',
        kind: 'drop',
        pieceId: m.pieceId,
        to: { row: m.to.row, col: m.to.col },
      });
    }
  }
  return out;
}

/**
 * 席に着いている二人の名前を名簿から読む（親 §6.8.4）。
 *
 * **観戦者には「あなた／あいて」が使えない**ので、画面に出す名前をここで作る。
 * まだ相手が来ていなければ空文字（**空であることも配るべき事実**）。
 */
export function seatNamesFromRoster(): { host: string; guest: string } {
  const s = useMatchmakingStore.getState();
  const seated = s.roster.filter((p) => hasSeat(p.role));
  const host = seated.find((p) => p.role === 'host');
  const guest = seated.find((p) => p.role !== 'host');
  return {
    host: host?.name ?? (s.isHost ? s.playerName : s.opponentName),
    guest: guest?.name ?? (s.isHost ? s.opponentName : s.playerName),
  };
}

/**
 * ホスト側：**いまの対局を丸ごと**組み立てる。
 *
 * **まだ何も決まっていない部屋でも作れる**（`phase:'lobby'`・ルールも先後も null）＝
 * **「無い」は送るべき事実であって、送らない理由ではない**。黙ると、入ってきた
 * 観戦者は「まだ来ていない」と「無いと知らされた」を区別できず、待ち続ける。
 */
export function buildSpectateSync(): SpectateSyncMsg {
  const mm = useMatchmakingStore.getState();
  const g = useGameStore.getState();
  const started = !!mm.gameStartInfo;
  return {
    v: PROTOCOL_VERSION,
    type: 'spectate_sync',
    phase: !started ? 'lobby' : g.status === 'playing' ? 'playing' : 'ended',
    rules: mm.activeRoomConfig ? rulesFromConfig(mm.activeRoomConfig) : null,
    sides: mm.gameStartInfo,
    names: seatNamesFromRoster(),
    moves: started ? movesFromHistory(g.position.history) : [],
    // ★終局は手ではないので、手の並びとは別に配る（親 §6.8.4）。
    status: g.status,
  };
}

/**
 * 観戦者側：受け取ったものから盤を組み立て直す。
 *
 * **順番に意味がある**＝ルール → 先後（盤を作り直す）→ 手を並べ直す。
 * ルールを先に入れないと、作り直す盤の種類・手合い・量子の有無が決まらない。
 */
export function applySpectateSync(msg: SpectateSyncMsg): void {
  const mm = useMatchmakingStore.getState();

  // ① ルール（あれば）。**無ければ触らない**＝既定で上書きすると、あとから
  //    ルール同期が届いたときに一度違う盤を見せてしまう。
  if (msg.rules) {
    mm.setActiveRoomConfig(applySyncedRules(msg.rules));
    useGameStore.getState().setQuantumParams(msg.rules.quantumParams);
  }

  // ② 対局者の名前。**観戦者の画面はこれだけを見る**（親 §6.8.4）。
  useMatchmakingStore.setState({ seatNames: msg.names });

  // ③ 先後が決まっていれば盤を作り直し、手を初手から並べ直す。
  if (msg.sides) {
    startGameFromSides(msg.sides);
    for (const m of msg.moves) {
      useGameStore.getState().applyRemoteMove({
        kind: m.kind,
        pieceId: m.pieceId,
        from: m.from,
        to: m.to,
        promote: m.promote,
      });
    }
  }

  // ★終わっている対局なら、その終わりを載せる。**手を並べ直しただけでは
  //   盤に現れない**（投了・時間切れ・中断合意は手ではない）ので、
  //   これが無いと**終わった対局が「対局中」に見える**。
  if (msg.sides && msg.status && msg.status !== 'playing') {
    useGameStore.getState().applySpectatedStatus(msg.status as never);
  }

  // ④ 受け取り終わったことを画面へ知らせ、盤へ移る。
  //    **人待ちの部屋では盤へ移らない**＝見るべき盤がまだ無いので、準備画面のまま。
  useMatchmakingStore.setState({ spectateWaiting: false });
  if (msg.phase !== 'lobby') {
    useRouteStore.getState().setScreen('game', { skipKifuGuard: true });
  }
}
