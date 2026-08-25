/**
 * 部屋のルール一式の「詰める／取り出す」を 1 か所に集めたもの (v1.55)。
 *
 * ★ここに切り出した理由＝**ルール同期 (§6.5) と観戦の配り物 (§6.8.4) が、
 * まったく同じルールの形を運ぶ**ため。片方に書いておくともう片方が写しを持ち、
 * **項目を足したときに片方だけ直った状態**になる（v1.50 の感想戦で実際に起きた
 * 「書き写す欄に無いものは黙って捨てられる」と同じ形）。
 *
 * 中身は v1.54 まで `messageDispatcher.ts` に private で置いてあったものを
 * **そのまま**移しただけで、振る舞いは変えていない。
 */
import { useGameStore } from '../../core/store/game-store';
import { handicapSettingFor, officialCustomRule } from '../../core/engine';
import { mgfFingerprint } from '../../core/engine/mgf/fingerprint';
import { fetchOfficialRuleById } from '../../core/engine/mgf/rule-catalog';
import type { Mgf } from '../../core/engine/mgf/types';
import type { SyncedRules } from './protocol';
import type { SideSelection } from './store';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore, type RoomConfig } from './store';

/**
 * ★段B②: 届いたルール一式から**遊ぶための定義を用意する**（ユーザー判断 2026-08-25）。
 *
 * 順に、①**ホストが配ってくれた定義**（公式一覧に無いルール）→ ②**アプリが持っている
 * 公式の定義**（同じ session で読み込み済みのものと同じ引き方）→ ③**公式一覧から
 * 自分で取ってくる**。どれでも用意できなければ null。
 *
 * ★**null は「用意できなかった」という事実**であって、黙って本将棋で始めてよいという
 * 意味ではない（呼ぶ側は必ず断りを返す）。
 */
export async function resolveCustomRuleForSync(rules: SyncedRules): Promise<Mgf | null> {
  if (rules.gameType !== 'custom') return null;
  if (rules.customMgf) return rules.customMgf;
  const id = rules.customRuleId;
  if (!id) return null;
  return officialCustomRule(id) ?? (await fetchOfficialRuleById(import.meta.env.BASE_URL, id));
}

/**
 * 受け取ったルールを自分の部屋設定に流し込む。
 *
 * 部屋名は自分が既に持っているもの (サーバー経由で先に届いている) を残す。ルール同期が
 * 運ぶのはルールだけで、部屋の呼び名は同期の対象ではないため。
 *
 * `resolved` ＝**開く工程で用意した定義**（`resolveCustomRuleForSync` の結果）。
 */
export function applySyncedRules(rules: SyncedRules, resolved?: Mgf | null): RoomConfig {
  const base = useMatchmakingStore.getState().activeRoomConfig ?? DEFAULT_ROOM_CONFIG;
  return {
    ...base,
    gameType: rules.gameType,
    torus: rules.torusMode !== 'none',
    torusMode: rules.torusMode,
    quantum: rules.quantum,
    quantumDisplayMode: rules.quantumDisplayMode,
    customRuleName: rules.customRuleName,
    customRuleId: rules.customRuleId,
    // ★段B② (親 §6.5): **用意できた定義を自分の部屋の設定に据える**。custom は定義が
    // 正体なので、名札だけ写しても盤が作れない。**取り戻した定義は呼ぶ側が渡す**
    // ＝公式一覧から取ってくるのは時間のかかる処理なので、ここでは受け取るだけにする。
    customMgf: resolved ?? rules.customMgf,
    timeControl: rules.timeControl,
    // v1.33: 手合いも部屋のルールの一部。席は送り手 (ホスト) から見た向きのまま持つ。
    handicap: rules.handicap ?? null,
  };
}

/** 自分が採用した設定から、送られてきたのと同じ形のルール一式を組み立て直す。 */
export function rulesFromConfig(cfg: RoomConfig): SyncedRules {
  return {
    gameType: cfg.gameType,
    torusMode: cfg.torusMode,
    quantum: cfg.quantum,
    quantumDisplayMode: cfg.quantumDisplayMode,
    timeControl: cfg.timeControl,
    handicap: cfg.handicap,
    customRuleName: cfg.customRuleName,
    customRuleId: cfg.customRuleId,
    // ★段B② (ユーザー判断 2026-08-25): **公式一覧にあるルールは定義を送らない**
    // ＝受け取った側が目印で自分で取りに行く。**作った本人が配っているルールだけ配る**。
    // **目印を持たないものは配る側へ倒す**＝印を付け忘れたら「送ってしまう」ほうへ
    // 転ぶので、忘れても盤が食い違わない（重くなるだけ）。
    customMgf: cfg.customRuleId ? undefined : cfg.customMgf,
    // 中身の印は**定義を送るかどうかに関わらず必ず添える**（照合の材料が消えないように）。
    customRuleDigest: cfg.customMgf ? mgfFingerprint(cfg.customMgf) : undefined,
    quantumParams: useGameStore.getState().quantumParams,
  };
}

/**
 * 先後が確定したので、その部屋のルールで盤を作り直す。
 *
 * ★v1.55: **`game_start` を受けたときと、観戦者が途中から入って
 * `spectate_sync` を受けたときの両方が、まったく同じ処理を要る**ので 1 か所にまとめた。
 * 2 か所に書くと、片方だけ直った状態が生まれる（ルールの項目を足したときに必ず起きる）。
 * **画面を移すのは呼んだ側の仕事**＝観戦者は人待ちの部屋なら盤へ移らないため。
 */
export function startGameFromSides(sides: { hostSide: SideSelection; guestSide: SideSelection }): void {
  useMatchmakingStore.setState({ gameStartInfo: sides });
  const cfg = useMatchmakingStore.getState().activeRoomConfig;
  if (cfg?.timeControl) useGameStore.getState().setTimeControl(cfg.timeControl);
  // v0.90: 量子 ON の部屋なら初期候補集合を割り当てる (Phase 5-2)。
  // オフライン側と揃えるため、game_start を受けたタイミングで盤面を初期化する。
  // v1.08 (Phase 5-11): 未確定駒の見せ方 (qtdisp) は部屋のルールの一部なので、
  // ホストの選択をゲスト側にも「部屋の値」として適用する (spec 駒UI v0.8 §4.4)。
  // v1.22: 部屋の値が巡回なら、実際の見え方は各自の画面の値になる。
  // v1.25 (Phase 4): 盤の端のつなぎ方も部屋のルールの一部。ホスト・ゲスト・観戦者が
  // 同じ盤で始まらないと、同じ手が片方だけ非合法になって局面がずれる。
  useGameStore.getState().reset({
    // Phase 6: 部屋のルール (本将棋 / はさみ将棋)。ホストが決めた種類がルール同期で
    // 届いているので、対戦者も観戦者も同じルール定義で盤を作る。
    gameType: cfg?.gameType ?? 'shogi',
    // ★段B②: **カスタムルールは定義そのものを渡す**。渡さないと盤を作る側は
    // 「前にこの端末で読み込んだ定義」を引き継ぐか、無ければ本将棋に落ちる＝
    // **部屋のルールと違う盤で対局が始まる**。ホスト・ゲスト・観戦者はいずれも
    // ここを通るので、渡す場所は 1 か所で足りる。
    customMgf: cfg?.customMgf,
    // v1.33: ネット対戦でも手合いを使う (親 v1.28 §3.12.1)。上手＝先手＝player1 で、
    // 誰がその席に座るかは部屋の先後の確定値 (駒落ちなら自動確定) が受け持つ。
    // 平手なら null が渡り、直前の対AI対局の手合いを引きずらない。
    handicap: handicapSettingFor(cfg?.handicap ?? null),
    quantum: cfg?.quantum ?? false,
    quantumDisplay: cfg?.quantumDisplayMode ?? 'cycle',
    torusMode: cfg?.torusMode ?? 'none',
  });
}
