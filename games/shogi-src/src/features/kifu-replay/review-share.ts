/**
 * 二人の感想戦 (S11) の受け持ち — 打診・諾否・棋譜の配布・盤と再生操作の共有。
 *
 * 意味論の正本＝親 v1.42 §9.4.4・通信＝親 §6.3.6・画面の要件＝画面機能 v0.37 §3 S11・
 * 絵柄＝付録D-12 v1.0 §3／§7。
 *
 * ★**運ぶのは差分ではなく「いまの居場所そのもの」**（何手目にいるか＋分岐で指した手の
 * 並び）。受け取った側は毎回そこから組み立て直すので**ずれようがない**。量子でも
 * 候補の減り方は手の並びから決まるので、並びが同じなら候補も同じになる。
 *
 * ★**食い違ったらホストを正**（親 §6.3.6）。同時に指したときは、
 *   - ゲストはホストの言い分を丸ごと採る（自分の手は消える。**黙って消さず知らせる**）
 *   - ホストは、送り手が居た場所が自分と違う伝言を**採らずに配り直す**
 * どちらが正しいかを後から突き合わせる材料が無い（感想戦の局面は記録に残らない）ので、
 * **先に決めた一方を正とするのがいちばん短い**。
 */

import { create } from 'zustand';
import { get as pluginGet } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage, ReviewMovePayload, ReviewPoint } from '../../core/plugin/review';
import { useOffersStore } from '../../core/store/offers-store';
import { useRouteStore } from '../../core/store/route-store';
import { parseKifu, serializeKifu } from './io';
import { clearReviewTarget, reviewTarget, setReviewTarget } from './review';

/** 部屋を建てた側か、入った側か。**正はホスト**（親 §6.3.6）。 */
export type ReviewRole = 'host' | 'guest';

/** 画面へ映す「いまの居場所」。**盤はここから毎回組み立て直す**。 */
export interface ReviewView {
  ply: number;
  branch: ReviewMovePayload[];
}

/** 画面に一言出すこと（付録D-12 §7／§8）。 */
export type ReviewNotice = 'declined' | 'aloneNoPeer' | 'oppLeft' | 'overridden' | null;

interface ReviewShareState {
  /** 二人でやっているときだけ入る。null＝ひとり（縮退＝何も送らない）。 */
  role: ReviewRole | null;
  /** 相手の名前。**始めたときに控える**＝抜けた後も「誰が居たか」を出せるように。 */
  opponentName: string;
  /** 相手が居るか（付録D-12 §3 の在室表示）。 */
  opponentPresent: boolean;
  /**
   * 棋譜が手元に届いているか。ホストは最初から true。
   * **ゲストは配り終えるまで再生操作を触れない**（画面機能 §3 S11）。
   */
  ready: boolean;
  /** 画面が拾って盤へ映す居場所。同じ中身でも映し直せるよう `seq` で数える。 */
  incoming: (ReviewView & { seq: number }) | null;
  /** 画面が拾って出す一言。 */
  notice: ReviewNotice;
  /**
   * v1.50: **この部屋は感想戦のために在る**（S11 で建てたか、一覧から入ったか）。
   *
   * 対局の終わりから入った感想戦とは扱いを分ける＝あちらは**部屋から出ない**
   * （結果の画面へ戻るだけで、相手を部屋から追い出さない）が、こちらは
   * **画面を離れると部屋そのものが用済み**になる。残すと一覧に**誰も居ない
   * 感想戦の部屋**が並び続ける（戻ってくる画面が無いので誰も片付けられない）。
   */
  ownsRoom: boolean;
}

const initial: ReviewShareState = {
  role: null,
  opponentName: '',
  opponentPresent: false,
  ready: true,
  incoming: null,
  notice: null,
  ownsRoom: false,
};

export const useReviewShareStore = create<ReviewShareState>(() => ({ ...initial }));

function connector(): OnlineGameConnector | undefined {
  return pluginGet<OnlineGameConnector>('gameConnector');
}

/**
 * いま画面が居る場所を教えてもらう口。**画面が出ている間だけ入る**
 * ＝出ていない時点では「どこに居るか」がそもそも無い（配られるのを待っている）。
 */
let localView: (() => ReviewView) | null = null;

export function bindReviewView(getter: (() => ReviewView) | null): void {
  localView = getter;
}

/** 相手が居て打診できるか（S07 の「感想戦」が二人用に振る舞う条件）。 */
export function canOfferReview(): boolean {
  const c = connector();
  return !!c && c.isOnline() && c.getOpponentName() !== '';
}

/** いま二人の感想戦をしているか（通信側が切断の扱いを分けるために見る）。 */
export function isSharedReview(): boolean {
  return useReviewShareStore.getState().role !== null;
}

/** 画面が一言を出し終えたら消す。 */
export function clearReviewNotice(): void {
  useReviewShareStore.setState({ notice: null });
}

/** ひとりへ戻す（断られたとき・後始末）。 */
export function endSharedReview(): void {
  useReviewShareStore.setState({ ...initial });
}

/**
 * 感想戦の画面を離れる。**相手にも伝える**＝黙って居なくなると、相手は共有されて
 * いない操作を続けてしまう（画面機能 §3 S11「相手が抜けたことは知らせる」）。
 *
 * **対局の終わりから入った感想戦では部屋から出ない**（結果の画面へ戻るだけ＝
 * 相手を部屋から追い出さない）。**v1.50** ＝ここで建てた／一覧から入った部屋だけは
 * 出る（`ownsRoom`）＝その部屋は感想戦のためだけに在り、残すと一覧に**誰も居ない
 * 部屋**が並び続ける。
 */
export function leaveSharedReview(): void {
  const s = useReviewShareStore.getState();
  if (s.role !== null) connector()?.sendReview({ kind: 'reply', accepted: false });
  if (s.ownsRoom) pluginGet<() => void>('reviewRoom:leave')?.();
  if (s.role === null && !s.ownsRoom) return;
  endSharedReview();
}

/**
 * 二人の感想戦を始める。**役はその部屋のホストかどうかで決まる**（打診した側ではない）
 * ＝食い違いの正を先に決めておくため（親 §6.3.6）。
 */
function beginSharedReview(): ReviewRole {
  const c = connector();
  const role: ReviewRole = c?.isRoomHost() ? 'host' : 'guest';
  useReviewShareStore.setState({
    role,
    opponentName: c?.getOpponentName() ?? '',
    opponentPresent: true,
    // ゲストは棋譜が配られるまで待つ（自分が持っているものを当てにしない・親 §6.3.6）。
    ready: role === 'host',
    incoming: null,
    notice: null,
  });
  return role;
}

/** 感想戦を相手に申し出る（付録D-12 §7）。返事を待つ間も**閉じ込めない**。 */
export function offerReview(): void {
  useOffersStore.getState().setReviewOfferFrom('me');
  connector()?.sendReview({ kind: 'offer' });
}

/**
 * ★v1.50: 感想戦の部屋を建てた（S11 の「部屋を作る」・付録D-12 §8）。
 *
 * **建てただけでは二人にならない**＝相手が来るまでは今までどおりひとりで、
 * 役が決まるのは**ゲストが入ってきた時点**（`reviewGuestArrived`）。
 * ここで控えるのは「この部屋は感想戦のために在る」ことだけ。
 */
export function reviewRoomCreated(): void {
  useReviewShareStore.setState({ ownsRoom: true });
}

/**
 * ★v1.50: 感想戦の部屋へゲストとして入った（ロビー S04 の一覧から・画面機能 §3 S04）。
 *
 * **待機画面 (S05) は通らない**＝先後も持ち時間も無いので決めることが無い。
 * **棋譜は持っていない**ので、配られるまで待つ（`beginSharedReview` が `ready` を
 * false にする）。**手元の記憶を代わりに映さない**＝配られる 1 局とは限らないのに
 * 盤に出ると、届いた瞬間に別の対局へ化けたように見える。
 */
export function joinedReviewRoom(): void {
  clearReviewTarget('lobby');
  beginSharedReview();
  useReviewShareStore.setState({ ownsRoom: true });
  enterReviewScreen();
}

/**
 * ★v1.50: 自分が建てた感想戦の部屋へゲストが入ってきた（ホスト側）。
 *
 * **棋譜を配るのはここ**＝終局から入る経路では「受ける」の返事が合図だったが、
 * 一覧から入ってくる経路にはその返事が無い。**合図を 1 つに束ねられない**ので、
 * 入り口ごとに配り始める場所を持つ（配り忘れると相手は待ち続ける）。
 *
 * 感想戦の部屋でなければ false を返し、呼んだ側は今までどおりに扱う。
 */
export function reviewGuestArrived(): boolean {
  if (!useReviewShareStore.getState().ownsRoom) return false;
  if (!reviewTarget()) return false;
  const role = beginSharedReview();
  if (role === 'host') distributeKifu();
  return true;
}

/** 打診を取り下げてひとりで始める（「ひとりで始める」を押したとき）。 */
export function withdrawReviewOffer(): void {
  useOffersStore.getState().setReviewOfferFrom(null);
}

/** 打診に答える（付録D-12 §7 の「受ける」「断る」）。 */
export function answerReviewOffer(accepted: boolean): void {
  useOffersStore.getState().setReviewOfferFrom(null);
  if (!accepted) {
    connector()?.sendReview({ kind: 'reply', accepted: false });
    return;
  }
  // **先に場を開いてから返事をする**＝返事の直後に届く棋譜を取りこぼさないため。
  const role = beginSharedReview();
  connector()?.sendReview({ kind: 'reply', accepted: true });
  enterReviewScreen();
  if (role === 'host') distributeKifu();
}

/** 感想戦の画面へ移る。**破棄の契機ではない**ので確認は挟まない（親 §9.4.3）。 */
function enterReviewScreen(): void {
  useRouteStore.getState().setScreen('review');
}

/**
 * ホストが棋譜を配る（親 §6.3.6）。**相手が同じ対局を指していた場合でも必ず送る**
 * ＝入るまでの間にゲスト側の記憶が置き換わったり失われたりしている可能性があるため。
 */
function distributeKifu(): void {
  const file = reviewTarget();
  if (!file) return;
  connector()?.sendReview({ kind: 'state', kifu: serializeKifu(file), ply: 0, branch: [] });
}

/** いまの居場所を線に乗せる（分岐は手そのものを運ぶ）。 */
export function shareReviewMove(base: ReviewPoint, view: ReviewView): void {
  if (!isSharedReview()) return;
  connector()?.sendReview({ kind: 'move', base, ply: view.ply, branch: view.branch });
}

export function shareReviewSeek(base: ReviewPoint, ply: number): void {
  if (!isSharedReview()) return;
  connector()?.sendReview({ kind: 'seek', base, ply });
}

export function shareReviewUndo(base: ReviewPoint, view: ReviewView): void {
  if (!isSharedReview()) return;
  connector()?.sendReview({ kind: 'undo', base, ply: view.ply, branch: view.branch });
}

/**
 * 相手が抜けた（親 §9.4.4）。**感想戦は終わらない**＝残った側がひとりで続ける。
 *
 * 二人でやっていたときだけ true を返す＝呼んだ通信側は、対局中の切断としての
 * 始末（退室を促すモーダル）をしない。
 */
export function reviewOpponentLeft(): boolean {
  if (!isSharedReview()) return false;
  useReviewShareStore.setState({
    opponentPresent: false,
    // 相手が居なくなった以上、配られるのを待ち続けない（ひとりで続けられる形にする）。
    ready: true,
    notice: 'oppLeft',
  });
  return true;
}

/**
 * 相手から届いた伝言を受ける（親 §6.3.6）。
 *
 * **画面ではなくここが受ける**＝画面がまだ出ていない時点でも棋譜が届くので、
 * 受け取ったものを持っておいて、画面が出たときに映せるようにする。
 */
export function receiveReviewMessage(msg: ReviewMessage): void {
  switch (msg.kind) {
    case 'offer': {
      // 打診を受けた（付録D-12 §7）。答えるまで S07 に居る。
      useOffersStore.getState().setReviewOfferFrom('opp');
      return;
    }
    case 'reply': {
      useOffersStore.getState().setReviewOfferFrom(null);
      // ★既に二人で始めている最中の「しません」＝**相手が感想戦から出た**
      //   （画面を離れた）。**感想戦は終わらない**ので、ひとりで続ける形にするだけ。
      //   伝言を増やさずに済むのは、断りも離脱も「もうあなたとはやりません」で同じだから。
      if (!msg.accepted && isSharedReview()) {
        useReviewShareStore.setState({ opponentPresent: false, ready: true, notice: 'oppLeft' });
        return;
      }
      if (!msg.accepted) {
        // **断られてもひとりで入る**（親 §9.4.1）。黙って隠さず、一言だけ知らせる。
        useReviewShareStore.setState({ ...initial, notice: 'declined' });
        enterReviewScreen();
        return;
      }
      const role = beginSharedReview();
      enterReviewScreen();
      if (role === 'host') distributeKifu();
      return;
    }
    case 'state': {
      if (!isSharedReview()) return;
      if (msg.kifu) {
        try {
          const file = parseKifu(msg.kifu);
          // 振り返る対象を差し替える。**記憶には触らない**（親 §9.4.3）。
          setReviewTarget(file, 'game');
        } catch {
          // 読めない棋譜だった。配り直しを待つ（勝手に部屋から出さない）。
          return;
        }
      }
      adopt({ ply: msg.ply, branch: msg.branch }, true);
      return;
    }
    case 'move':
    case 'undo': {
      applyFromPeer(msg.base, { ply: msg.ply, branch: msg.branch });
      return;
    }
    case 'seek': {
      applyFromPeer(msg.base, { ply: msg.ply, branch: [] });
      return;
    }
  }
}

/**
 * 相手の操作を採るかどうかを決める。**ホストが正**（親 §6.3.6）。
 *
 * 送り手が居た場所が自分と違う＝同時に操作した。
 *   - 自分がホスト … 採らずに、自分の居場所を配り直す（相手がそろえ直す）
 *   - 自分がゲスト … ホストの言い分を丸ごと採る。**自分の手が消えたら知らせる**
 */
function applyFromPeer(base: ReviewPoint, view: ReviewView): void {
  const s = useReviewShareStore.getState();
  if (!s.role) return;
  const here = currentPoint();
  const sameSpot = here !== null && here.ply === base.ply && here.branchLen === base.branchLen;
  if (sameSpot) {
    adopt(view, false);
    return;
  }
  if (s.role === 'host') {
    redistribute();
    return;
  }
  adopt(view, false);
  if (here && here.branchLen > base.branchLen) {
    useReviewShareStore.setState({ notice: 'overridden' });
  }
}

/** ホストがいまの居場所を配り直す（棋譜は既に相手が持っているので省く）。 */
function redistribute(): void {
  const here = localView?.();
  if (!here) return;
  connector()?.sendReview({ kind: 'state', ply: here.ply, branch: here.branch });
}

/** いま自分が居る場所。画面が出ていなければ分からない（null）。 */
function currentPoint(): ReviewPoint | null {
  const here = localView?.();
  return here ? { ply: here.ply, branchLen: here.branch.length } : null;
}

/** 届いた居場所を画面へ渡す。`seq` を進めるので、同じ中身でも映し直る。 */
function adopt(view: ReviewView, ready: boolean): void {
  const seq = (useReviewShareStore.getState().incoming?.seq ?? 0) + 1;
  useReviewShareStore.setState({
    incoming: { ...view, seq },
    ...(ready ? { ready: true } : {}),
  });
}
