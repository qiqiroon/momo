/**
 * 観戦者を感想戦へ連れて移る段（★v1.59・段3・親 §6.8.6／画面機能 §3 S07・付録D-3 §4.3）。
 *
 * ## なぜ別の置き場にするのか
 *
 * **ここに置く控えは、部屋より長生きしなければならない**。ホストは移り先を知らせた
 * **直後に部屋を出て**移り先を建てる（§6.3.6 の手順 2〜3）ので、**観戦者の部屋は
 * ほぼ必ず閉じる**。部屋の状態と一緒に片付けられる場所へ置くと、**確認は出た直後に
 * 消え、観戦者は決して連れて行かれない**（**控えを取る場所と消す場所を同じ関数に
 * 置かない**）。
 *
 * ## 引っ込めるのはいつか
 *
 * **「移り先の知らせが来ないまま部屋が閉じたとき」だけ**（親 v1.59 §6.8.6）。
 * **分ける根拠は行き先を持っているかどうか**であって、画面の名前でも部屋の状態でもない。
 * **答えた時点と、実際に行き先が失われる時点は別**なので、「入る」を押して探しに行き、
 * **入れないと分かった時点で初めて**「対局が終わりました」と伝えて一覧へ戻す。
 */

import { create } from 'zustand';
import { useRouteStore } from '../../core/store/route-store';
import { get as pluginGet } from '../../core/plugin/registry';

interface SpectateMigrateState {
  /** 受け取った移り先（＝確認を出す）。null＝確認は出ていない。 */
  offer: { room: string; pass: string } | null;
  /** 「入る」を押して移り先を探している最中。**盤には触れない**。 */
  moving: boolean;
  /** 「対局が終わりました」の知らせ。**本人が閉じるまで残す**（付録D-3 §4.2）。 */
  ended: boolean;
}

const initial: SpectateMigrateState = { offer: null, moving: false, ended: false };

export const useSpectateMigrateStore = create<SpectateMigrateState>(() => ({ ...initial }));

/** 移り先を探す上限。**対局者側とまったく同じ**（§6.3.6・2 つの画面で違う理屈を持たない）。 */
const MIGRATE_TIMEOUT_MS = 12_000;
let timer: number | null = null;

function clearTimer(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/**
 * 観戦に入り直すときは決め直す（**画面より長生きする控えは入るたびに決め直す**）。
 * 前の対局で答えなかった確認が次の観戦に出てこないようにするため。
 */
export function resetSpectateMigrate(): void {
  clearTimer();
  useSpectateMigrateStore.setState({ ...initial });
}

/** ホストから移り先が届いた（`review_migrate`）＝確認を出す。 */
export function offerSpectateMigrate(room: string, pass: string): void {
  if (!room || !pass) return;
  useSpectateMigrateStore.setState({ offer: { room, pass }, moving: false, ended: false });
}

/**
 * 「入る」を押した。**先に部屋を出てから探す**＝土台は「いま居る部屋」を 1 つしか
 * 持てないので、居たままでは移り先に入れない（閉じた後なら出るのは空振りで済む）。
 */
export function acceptSpectateMigrate(): void {
  const { offer } = useSpectateMigrateStore.getState();
  if (!offer) return;
  useSpectateMigrateStore.setState({ offer: null, moving: true });
  pluginGet<() => void>('reviewRoom:leave')?.();
  pluginGet<(p: { room: string; pass: string; asSpectator?: boolean }) => void>('reviewRoom:joinMigrated')?.({
    room: offer.room,
    pass: offer.pass,
    asSpectator: true,
  });
  // **待ち続けない**＝見つからなければ「対局が終わりました」と伝えて一覧へ戻す。
  clearTimer();
  timer = window.setTimeout(() => {
    if (useSpectateMigrateStore.getState().moving) failSpectateMigrate();
  }, MIGRATE_TIMEOUT_MS);
}

/** 「観戦の一覧へ戻る」を押した＝出口（付録D-3 §4.3・**確認には必ず出口を置く**）。 */
export function declineSpectateMigrate(): void {
  clearTimer();
  useSpectateMigrateStore.setState({ ...initial });
  pluginGet<() => void>('reviewRoom:leave')?.();
  useRouteStore.getState().setScreen('spectate-lobby', { skipKifuGuard: true });
}

/** 移り終えた（感想戦の部屋へ入れた）。 */
export function spectateMigrateSettled(): void {
  clearTimer();
  useSpectateMigrateStore.setState({ ...initial });
}

/**
 * 部屋が閉じた／対局者が居なくなった。
 *
 * **移り先を持っているなら何もしない**＝**知らせた直後に部屋が閉じるのは予期された
 * こと**であり、行き先はもう手元にある（親 v1.59 §6.8.6）。**持っていないときだけ**
 * 「対局が終わりました」と伝える＝**「無い」は送るべき事実であって、送らない理由ではない**。
 */
export function noteSpectatedRoomClosed(): void {
  const s = useSpectateMigrateStore.getState();
  if (s.offer || s.moving || s.ended) return;
  useSpectateMigrateStore.setState({ ended: true });
}

/** 移り先へ入れなかった＝ここで初めて「対局が終わりました」を出す。 */
export function failSpectateMigrate(): void {
  clearTimer();
  useSpectateMigrateStore.setState({ offer: null, moving: false, ended: true });
}

/** 「対局が終わりました」の OK を押した＝観戦の一覧へ戻る。 */
export function dismissSpectateEnded(): void {
  clearTimer();
  useSpectateMigrateStore.setState({ ...initial });
  pluginGet<() => void>('reviewRoom:leave')?.();
  useRouteStore.getState().setScreen('spectate-lobby', { skipKifuGuard: true });
}
