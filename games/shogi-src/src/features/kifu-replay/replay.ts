/**
 * 棋譜を最初から指し直す。
 *
 * 記録した設定で盤を作り直し、記録された手を 1 手ずつ**対局中とまったく同じ経路**で
 * 適用する（合法手と突き合わせてから指す）。量子の候補更新・収縮も同じに走るので、
 * 「書き出した棋譜を読み直すと同じ局面に戻る」ことがそのまま確かめられる。
 */

import { useGameStore } from '../../core/store/game-store';
import { officialCustomRule } from '../../core/engine';
import type { Mgf } from '../../core/engine/mgf/types';
import type { KifuFile } from './types';

/** カスタムルールの参照（棋譜が持つ名前+版・§9.2.6）。 */
export type CustomRuleRef = NonNullable<KifuFile['meta']['customRule']>;

/**
 * カスタムルールの棋譜を**開く工程**での取り戻しの結果（§9.2.6）。
 * - `none`   ＝組み込みルール or 参照なし（取り戻し不要）。
 * - `resolved`＝手元 or 公式一覧で取り戻せた（そのまま再生できる）。
 * - `needsFile`＝公式にも手元にも無い＝**利用者にファイルを選ばせる**（段2・§9.2.6 ②）。
 */
export type CustomRuleResolution =
  | { kind: 'none' }
  | { kind: 'resolved'; mgf: Mgf }
  | { kind: 'needsFile'; ref: CustomRuleRef };

/**
 * 棋譜を開くときに、参照（名前+版）から定義を取り戻す（§9.2.6）。**非同期の取得の前に
 * まず同期で試す**＝①手元に読み込み済みで一致すればそれ（同一セッション）→ ②公式一覧から
 * `game_id` で引く。どちらでも取れなければ `needsFile`（ファイル選択が要る）。
 *
 * 取り戻しは**再生（同期）の中でなく開く工程で先に行う**（§9.2.6）＝ファイル選択は
 * 時間のかかる処理なので、定義を用意してから盤の並べ直しに入る。
 */
export function resolveCustomRuleForOpen(file: KifuFile): CustomRuleResolution {
  const ref = file.meta.customRule;
  if (!ref) return { kind: 'none' };
  const cur = useGameStore.getState().currentCustomMgf;
  if (cur && cur.metadata.game_id === ref.id && cur.metadata.version === ref.version) {
    return { kind: 'resolved', mgf: cur };
  }
  const off = officialCustomRule(ref.id);
  if (off) return { kind: 'resolved', mgf: off };
  return { kind: 'needsFile', ref };
}

/** 再生の内側で使う同期版（開く工程で取り戻せているものだけを引く）。 */
function resolveCustomRule(file: KifuFile): Mgf | undefined {
  const r = resolveCustomRuleForOpen(file);
  return r.kind === 'resolved' ? r.mgf : undefined;
}

export interface ReplayResult {
  /** 指し直せた手数。 */
  applied: number;
  /** 記録されていた手数。applied と食い違ったらどこかで指せなくなっている。 */
  recorded: number;
}

/**
 * 再生の最中かどうか。
 *
 * 再生は**盤を作り直して終局まで指し直す**ので、外から見ると新しい対局が始まって
 * 終わったのと区別がつかない。見張っている側（index.ts）がそれを本物の対局と
 * 取り違えると、**再生しただけで記憶が書き換わる**。ここで名乗って避ける。
 *
 * **入れ子になるので数で持つ**（v1.46）＝感想戦は画面が開いている間ずっと名乗り
 * 続けるが、その中で再生（`replayKifu`）も走る。真偽値だと内側が終わった時点で
 * 名乗りが解けてしまい、**外側がまだ続いているのに素通しになる**。
 */
let depth = 0;

export function isReplayingKifu(): boolean {
  return depth > 0;
}

/**
 * 「これは本物の対局ではない」と名乗りながら盤を触る。
 *
 * 棋譜再生画面を離れるとき、**入る前の盤をそのまま戻す**のに使う。戻すと status が
 * 対局中から終局へ動くので、見張っている側 (index.ts) がそれを新しい終局と取り違え、
 * **盤から作り直した棋譜で記憶を上書きしてしまう**（記録 → 盤の一方向が壊れる）。
 */
export function asReplay<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

/**
 * **画面が開いている間ずっと名乗り続ける**（感想戦 S11・親 §9.4.3）。返り値を呼ぶと解く。
 *
 * 感想戦は**人がいつ指すか分からない**ので、操作のたびに名乗る形にすると
 * **名乗り漏れが 1 か所でもあれば記憶が書き換わる**（分岐で詰ませた瞬間に、その
 * 分岐が「新しい対局の終局」として記録される）。**盤に触れる口を数え上げる代わりに、
 * 画面に居る間を丸ごと囲う**＝成るかどうかの確認のように、画面から離れたところで
 * 盤を動かす部品も自動で入る。
 */
export function holdReplayGuard(): () => void {
  depth++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth--;
  };
}

/**
 * 棋譜の設定で盤を作り直し、`upTo` 手まで指し直す（省略なら最後まで）。
 * 指せない手に当たったらそこで止める（残りは applied との差で分かる）。
 *
 * `rule` は**開く工程で取り戻した定義**（§9.2.6）＝ファイル選択で読んだものなど、
 * 同期の `resolveCustomRule` では引けない定義を明示的に渡す口。省略時は従来どおり
 * 手元・公式から取り戻す（組み込みルールと、公式一覧にあるチェスはこれで足りる）。
 *
 * **再生は破棄の契機ではない**（親 §9.2.3 ②）＝記憶は触らない。
 */
export function replayKifu(file: KifuFile, upTo?: number, rule?: Mgf): ReplayResult {
  depth++;
  try {
    const g = useGameStore.getState();
    g.reset({
      gameType: file.meta.gameType,
      // カスタムルール ('custom'・§5.0) は、棋譜の参照 (名前+版) から取り戻した定義で
      // 盤を作り直す (§9.2.6)。取れないと種類だけでは組み込みの一覧に無く、本将棋へ
      // 落ちて再生が化ける。開く工程で用意した `rule` があればそれを使う。
      customMgf: rule ?? resolveCustomRule(file),
      quantum: file.meta.quantum,
      torusMode: file.meta.torus,
      handicap: file.meta.handicap
        ? { typeId: file.meta.handicap.typeId, giver: file.meta.handicap.giver }
        : null,
    });
    const limit = upTo === undefined ? file.moves.length : Math.min(upTo, file.moves.length);
    let applied = 0;
    for (let i = 0; i < limit; i++) {
      if (!useGameStore.getState().replayRecordedMove(file.moves[i])) break;
      applied++;
    }
    return { applied, recorded: file.moves.length };
  } finally {
    depth--;
  }
}
