/**
 * 部屋の段（人待ち／対局中／終局後）をサーバーへ知らせる（★v1.55・親 §6.8.2）。
 *
 * ## なぜ要るのか
 *
 * **観戦の一覧（S13）に「その部屋がいまどの段か」を出すため**。これが無いと、
 * 一覧の側では**席が埋まっているかどうかしか測れず**、準備中と対局中を取り違える
 * （**分からないものを分かったように書かない**ので、その場合は 2 つの印しか出せない）。
 *
 * ## 実測した事実（2026-08-21・本番サーバーで確認）
 *
 * - サーバーは部屋一覧に **`gameState`** を載せて返す（既定は `'lobby'`）。
 * - **`{ type: 'game_state_update', gameState: '...' }`** を送ると、その部屋の
 *   `gameState` が置き換わる。
 * - **項目名は `gameState`**。`state` という名前で送っても**黙って無視される**
 *   （最初にそれで送って効かず、名前を変えて初めて効いた）。
 * - 共通ライブラリが必ず付ける **`to` が入っていても効く**。
 *
 * ## ★これは「対局の伝言」ではない
 *
 * したがって**包みに入れない**（親 §6.2 の包みは、参加者どうしで交わす伝言のためのもの）。
 * これは**サーバー自身に宛てた指示**なので、生の送信口をそのまま使う。
 * **例外はここだけ**で、対局の伝言は今までどおり `sendShogiMessage` を通す。
 *
 * ## 送るのはホストだけ
 *
 * **書き手を 1 人に絞る**＝二人が別々の段を書くと、どちらが正なのか誰も言えなくなる。
 */
import { useGameStore } from '../../core/store/game-store';
import { getMomoMatchmaking } from './client';
import { useMatchmakingStore } from './store';

export type RoomPhase = 'lobby' | 'playing' | 'ended';

/**
 * 直前に知らせた「部屋と段」の組み合わせ（同じことを何度も送らないため）。
 *
 * ★**部屋 ID も一緒に覚える**＝段だけを覚えると、**次の部屋でも同じ段なら送らない**
 * ことになり、建て直した部屋がいつまでも「人待ち」に見える。**忘れる処理を別に
 * 置かなくて済む**形にしてある（消し忘れ・消しすぎのどちらも起こらない）。
 */
let lastPublished: string | null = null;

/**
 * 部屋の段を知らせる。**ホストで、部屋に居るときだけ**送る。
 *
 * 同じ段を続けて送らない＝一覧の取り直しと無関係に何度も呼ばれる場所から使うため。
 */
export function publishRoomPhase(phase: RoomPhase): void {
  const s = useMatchmakingStore.getState();
  if (!s.isHost || !s.currentRoomId) return;
  const key = `${s.currentRoomId}:${phase}`;
  if (lastPublished === key) return;
  const client = getMomoMatchmaking();
  if (!client) return;
  lastPublished = key;
  // ★包まない（上記）＝サーバーに宛てた指示であって、参加者への伝言ではない。
  client.send({ type: 'game_state_update', gameState: phase });
}

/**
 * 盤の様子を見て、段が変わったら知らせ続ける。
 *
 * ★**呼び出し場所を数え上げない**＝「対局が始まったとき」「終局したとき」を
 * それぞれの画面に書き足すと、**入口が増えたときに必ずどれかを書き忘れる**
 * （書き忘れると、その入口から始めた部屋だけが一覧で「人待ち」のまま残る）。
 * **事実（先後が決まっているか・盤が終わっているか）を見て決める。**
 */
export function watchRoomPhase(): () => void {
  const compute = (): RoomPhase => {
    const mm = useMatchmakingStore.getState();
    if (!mm.gameStartInfo) return 'lobby';
    return useGameStore.getState().status === 'playing' ? 'playing' : 'ended';
  };
  const tick = () => publishRoomPhase(compute());
  const un1 = useGameStore.subscribe(tick);
  const un2 = useMatchmakingStore.subscribe(tick);
  tick();
  return () => {
    un1();
    un2();
  };
}
