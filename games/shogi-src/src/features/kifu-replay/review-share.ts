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
import { loadLastKifu } from './storage';
import type { KifuFile } from './types';

/** 部屋を建てた側か、入った側か。**正はホスト**（親 §6.3.6）。 */
export type ReviewRole = 'host' | 'guest';

/** 画面へ映す「いまの居場所」。**盤はここから毎回組み立て直す**。 */
export interface ReviewView {
  ply: number;
  branch: ReviewMovePayload[];
}

/** 画面に一言出すこと（付録D-12 §7／§8）。 */
export type ReviewNotice =
  | 'declined'
  | 'aloneNoPeer'
  | 'oppLeft'
  | 'overridden'
  /** ★v1.55: 感想戦の部屋へ移れなかった（親 §9.4.4＝ひとりで続ける）。 */
  | 'migrateFailed'
  | null;

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
  /**
   * ★v1.55: 相手が付けたハイライト（親 v1.49 §9.4.2.2）。null＝付いていない。
   *
   * **自分の印と描き分けない**＝印は 1 つであり、どちらが付けたかは「いま話して
   * いる人」で分かる（描き分けると同じ場所を指したときに 2 重に出る）。したがって
   * 画面は**自分の印と相手の印を同じ 1 つの入れ物として扱う**が、**受け取ったことを
   * 画面が拾えるよう `seq` で数える**（同じマスを指し直されても映せるように）。
   */
  mark: { row: number; col: number; seq: number } | null;
  /**
   * ★v1.55: **対局の部屋から感想戦の部屋へ移っている最中**（親 v1.49 §9.4.4／§6.3.6）。
   *
   * この間は**互いに部屋の外に居る時間がある**ので、**切断を「相手が抜けた」と
   * 取り違えない**。画面は「移っています」と出して盤に触れない（線が切れている
   * 間に指しても相手へ届かないため）。
   */
  migrating: boolean;
}

const initial: ReviewShareState = {
  role: null,
  opponentName: '',
  opponentPresent: false,
  ready: true,
  incoming: null,
  notice: null,
  ownsRoom: false,
  mark: null,
  migrating: false,
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
 * ★**v1.54: 入り口によらず、部屋からも出る**（親 v1.48 §9.4.3）。
 *
 * v1.53 までは**対局の終わりから入った感想戦だけ部屋に残っていた**＝戻る先が
 * 「結果の画面」で、そこから部屋へ戻れたため。**戻る先がモード選択の一択になった**
 * 以上、**部屋に残っても戻る道が無く、誰も居ない部屋になる**（v1.50 が一覧から入った
 * 部屋について直したのと同じ形を、全経路へ広げた）。
 *
 * **相手を追い出すことにはならない**＝残った側の感想戦は終わらない（§9.4.4）。
 */
export function leaveSharedReview(): void {
  const s = useReviewShareStore.getState();
  if (s.role !== null) connector()?.sendReview({ kind: 'reply', accepted: false });
  // **部屋に居るかどうかは通信側が知っている**＝こちらで数え上げない（`ownsRoom` は
  // 「感想戦のために建てた／入った」の印であって、部屋に居るかの印ではない）。
  pluginGet<() => void>('reviewRoom:leave')?.();
  if (s.role === null && !s.ownsRoom) return;
  endSharedReview();
}

/**
 * ★v1.51: **振り返る 1 局が決まっていなければ、記憶している 1 局で決める**。
 *
 * 親 §9.4.1 は「入るときに対象が決まる」と定めているのに、**終局から二人で入る経路
 * だけ決める工程が無かった**（v1.47〜v1.50）＝終局パネルの「感想戦」は相手が居ると
 * 打診しかせず、受ける側も決めない。**結果、ホストの配布は「配る 1 局が無い」ので
 * 黙って何もせず戻り**、両者とも 1 局の無いまま画面へ入っていた（盤が並び直されず、
 * 進む・戻すが押せず、指した手は「分岐が対局まるごと」という形で送られて相手が
 * 組み立て直せない）。
 *
 * **入口ごとに決めるのではなく、二人で始まる 1 か所で埋める**＝入口は 4 通りあり、
 * 数え上げる形にすると必ずどれかが漏れる（今回漏れたのがまさにその形）。
 *
 * **★埋めるのは配る側（ホスト）だけ**＝**ゲストは配られるのを待つ**のが決まりで
 * （親 §6.3.6）、手元の記憶を代わりに置くと**配られる 1 局とは限らないもの**が
 * 盤に出る（一覧から入ったゲストは、その対局を指してすらいない）。**必要なのは
 * 「配るものが無い」を無くすことだけ**なので、必要な側にだけ入れる。
 *
 * ★v1.53: **対局の終わりから入るときは、いま終わった対局で必ず決め直す**
 * （2026-08-18 ユーザー報告「ネット対戦から感想戦に入ると、前に読み込んだ棋譜が出る」）。
 *
 * 振り返る 1 局の控えは**画面より長生きする**（画面を閉じても残る）ので、
 * 前に一度でも感想戦を使っていると**その 1 局が入ったまま**になる。v1.52 までは
 * 「空のときだけ埋める」形だったため、**前の棋譜が残っていると、いま終わった対局を
 * 一度も見ずにそれを配っていた**（配られるゲスト側も同じものを見る）。
 *
 * **どこから入ったかで決め方が違う**＝終局からなら「いま終わった対局」しかあり得ないが、
 * 感想戦の部屋（S11 で建てた／一覧から入った）では**開くときに決めた 1 局が正**なので、
 * 記憶で上書きしてはならない。だから空かどうかではなく**入口で分ける**。
 */
function ensureReviewTarget(fromGame: boolean): void {
  if (!fromGame && reviewTarget()) return;
  const remembered = loadLastKifu();
  if (remembered) setReviewTarget(remembered, 'game');
}

/**
 * 二人の感想戦を始める。**役はその部屋のホストかどうかで決まる**（打診した側ではない）
 * ＝食い違いの正を先に決めておくため（親 §6.3.6）。
 *
 * `fromGame`＝対局の終わり（S07 の打診・諾否）から始まったか。感想戦の部屋で
 * 客を迎えて始まったときは false（振り返る 1 局は既に決まっている）。
 */
function beginSharedReview(fromGame: boolean): ReviewRole {
  const c = connector();
  const role: ReviewRole = c?.isRoomHost() ? 'host' : 'guest';
  if (role === 'host') ensureReviewTarget(fromGame);
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

/**
 * ★v1.55: 対局の部屋から移る先の、その場限りの合言葉と部屋名（親 v1.49 §6.3.6）。
 *
 * **作るのは部屋のホストだけ**＝建てるのもホストなので、決める側を 1 つにする。
 * **人には見せない**（画面に出さない・ログにも出さない）。
 */
let migrationPass: string | null = null;
/** 相手（ホスト）の打診に載ってきた合言葉。答えるときに使う。 */
let offeredMigration: { pass: string; room: string } | null = null;
let migrationRoom: string | null = null;
/** 移るのを待つ上限（過ぎたらひとりで続ける・親 §9.4.4）。 */
const MIGRATE_TIMEOUT_MS = 12_000;
let migrateTimer: number | null = null;

/** その場限りの合言葉を作る。**人には見せない**ので読みやすさは要らない。 */
function newPass(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * ★v1.55: 移る先の部屋の名前と合言葉を用意する（**ホストだけ**）。
 * 打診／諾否の伝言に載せて渡すので、**往復を増やさない**。
 */
function prepareMigration(): { pass: string; room: string } | null {
  const c = connector();
  if (!c?.isRoomHost()) return null;
  const build = pluginGet<(name: string) => string>('reviewRoom:buildName');
  if (!build) return null;
  // **同じ部屋名**にする（親 §9.4.4）＝人から見て同じ場が続くようにするため。
  const current = pluginGet<() => string>('reviewRoom:currentUserName')?.() ?? '';
  migrationPass = newPass();
  migrationRoom = build(current);
  return { pass: migrationPass, room: migrationRoom };
}

/** 感想戦を相手に申し出る（付録D-12 §7）。返事を待つ間も**閉じ込めない**。 */
export function offerReview(): void {
  useOffersStore.getState().setReviewOfferFrom('me');
  // ★v1.55: **ホストが申し出るときは、ここに合言葉を載せる**（§6.3.6）。
  // ゲストが申し出るときは付かず、ホストが返事に載せてくる。
  const m = prepareMigration();
  connector()?.sendReview({ kind: 'offer', ...(m ? { pass: m.pass, room: m.room } : {}) });
}

/**
 * ★v1.55: 対局の部屋を出て、感想戦の部屋へ移る（親 v1.49 §9.4.4／§6.3.6）。
 *
 * **人がするのは「受ける」を押すことだけ**＝合言葉も部屋の一覧も画面に出さない。
 *
 * なぜ移るのか＝**部屋の用途の印は建てた後に変えられない**ので、対局の印のまま
 * 感想戦を続けると、**片方が抜けた瞬間に対局のつもりの人が入ってくる**。
 *
 * なぜ合言葉なのか＝**部屋を離れると直通の線もその場で閉じる**ので、離れた後に
 * 新しい部屋を知らせる道が無く、離れる前にはその部屋がまだ建っていない。
 * **番号ではなく合言葉で待ち合わせる**（名前だけで見分けない＝同じ名前の部屋が
 * 2 つあっても、合言葉の合う部屋は 1 つしか無い）。
 */
function migrateToReviewRoom(pass: string, room: string): void {
  const asHost = connector()?.isRoomHost() === true;
  useReviewShareStore.setState({ migrating: true });
  // 対局の部屋を出る。**自分から出たと立ててから**出る（事故と取り違えないため）。
  pluginGet<() => void>('reviewRoom:leave')?.();

  if (asHost) {
    const ok = pluginGet<(p: { room: string; pass: string }) => boolean>('reviewRoom:createMigrated')?.({
      room,
      pass,
    });
    if (!ok) {
      failMigration();
      return;
    }
    useReviewShareStore.setState({ ownsRoom: true });
  } else {
    pluginGet<(p: { room: string; pass: string }) => void>('reviewRoom:joinMigrated')?.({ room, pass });
  }

  // **待ち続けない**＝建て損ね・入り損ねのどちらでも、上限を過ぎたらひとりで続ける。
  if (migrateTimer !== null) window.clearTimeout(migrateTimer);
  migrateTimer = window.setTimeout(() => {
    if (useReviewShareStore.getState().migrating) failMigration();
  }, MIGRATE_TIMEOUT_MS);
}

/** 移り終えた（ホスト＝客が来た／ゲスト＝入れた）。 */
export function migrationSettled(): void {
  if (migrateTimer !== null) {
    window.clearTimeout(migrateTimer);
    migrateTimer = null;
  }
  migrationPass = null;
  migrationRoom = null;
  useReviewShareStore.setState({ migrating: false });
}

/**
 * 移れなかった。**感想戦そのものは止めない**（親 §9.4.4＝続けられるものを
 * 打ち切らない）＝ひとりで続け、**移れなかったことは言葉で伝える**。
 */
function failMigration(): void {
  if (migrateTimer !== null) {
    window.clearTimeout(migrateTimer);
    migrateTimer = null;
  }
  migrationPass = null;
  migrationRoom = null;
  useReviewShareStore.setState({
    ...initial,
    migrating: false,
    notice: 'migrateFailed',
  });
}

/** いま待ち合わせている合言葉と部屋名（通信側が一覧を見張るときに使う）。 */
export function pendingMigration(): { pass: string; room: string } | null {
  return migrationPass && migrationRoom ? { pass: migrationPass, room: migrationRoom } : null;
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
  beginSharedReview(false);
  useReviewShareStore.setState({ ownsRoom: true });
  // ★v1.55: 対局から移ってきた場合は、ここが**移り終えた合図**（親 §6.3.6 の手順 4）。
  migrationSettled();
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
  // ★v1.55: 対局から移ってきた場合は、ここが**移り終えた合図**（親 §6.3.6 の手順 5）。
  migrationSettled();
  const role = beginSharedReview(false);
  if (role === 'host') distributeKifu();
  return true;
}

/** 打診を取り下げてひとりで始める（「ひとりで始める」を押したとき）。 */
export function withdrawReviewOffer(): void {
  useOffersStore.getState().setReviewOfferFrom(null);
}

/** 打診に答える（付録D-12 §7 の「受ける」「断る」）。 */
export function answerReviewOffer(accepted: boolean, offered?: { pass?: string; room?: string }): void {
  const carried = offered ?? offeredMigration ?? undefined;
  offeredMigration = null;
  useOffersStore.getState().setReviewOfferFrom(null);
  if (!accepted) {
    connector()?.sendReview({ kind: 'reply', accepted: false });
    return;
  }
  // **先に場を開いてから返事をする**＝返事の直後に届く棋譜を取りこぼさないため。
  const role = beginSharedReview(true);
  // ★v1.55: **ホストが答える側なら、ここで合言葉を作って返事に載せる**（§6.3.6）。
  // ゲストが答える側なら、**打診に載ってきた合言葉**を使う。
  const mine = prepareMigration();
  connector()?.sendReview({
    kind: 'reply',
    accepted: true,
    ...(mine ? { pass: mine.pass, room: mine.room } : {}),
  });
  enterReviewScreen();
  const m = mine ?? (carried?.pass && carried.room ? { pass: carried.pass, room: carried.room } : null);
  if (m) {
    // ★v1.55: **対局の部屋はそのまま使わず、感想戦の部屋へ移る**（親 §9.4.4）。
    // 棋譜を配るのは移り終えてから（ホストは客が来た合図で配る）。
    migrateToReviewRoom(m.pass, m.room);
    return;
  }
  if (role === 'host') distributeKifu();
}

/** 感想戦の画面へ移る。**破棄の契機ではない**ので確認は挟まない（親 §9.4.3）。 */
function enterReviewScreen(): void {
  useRouteStore.getState().setScreen('review');
}

/**
 * ホストが棋譜を配る（親 §6.3.6）。**相手が同じ対局を指していた場合でも必ず送る**
 * ＝入るまでの間にゲスト側の記憶が置き換わったり失われたりしている可能性があるため。
 *
 * ★**v1.54: 棋譜だけでなく「いまの居場所」も一緒に配る**（親 v1.48 §6.3.6）。
 *
 * v1.53 までは常に `ply: 0` で配っていたので、**進んだ部屋に入ったゲストは初期局面から
 * 始まり**、次に誰かが 1 手動かすまで追いつけなかった（2026-08-19 ご報告）。
 * `state` はもともと「何手目にいるか＋分岐の手の並び」を丸ごと運ぶ形なので、
 * **入室の瞬間にも同じものを載せればよい**＝新しい伝言は作らない。
 *
 * 画面がまだ出ていなければ居場所そのものが無いので、そのときだけ初期局面になる。
 */
function distributeKifu(): void {
  const file = reviewTarget();
  if (!file) return;
  const here = localView?.();
  connector()?.sendReview({
    kind: 'state',
    kifu: serializeKifu(file),
    ply: here?.ply ?? 0,
    branch: here?.branch ?? [],
  });
}

/**
 * ★v1.54: **ホストが振り返る 1 局を差し替えた**（S11 の「棋譜を読み込む」・親 §9.4.2）。
 *
 * **差し替えられるのはホストだけ**なので、配り直す側も 1 つに決まる。ひとりのときは
 * 送り先が無いので何も起きない（縮退）。
 */
export function replaceSharedKifu(file: KifuFile): void {
  setReviewTarget(file, 'lobby');
  if (!isSharedReview()) return;
  if (useReviewShareStore.getState().role !== 'host') return;
  connector()?.sendReview({ kind: 'state', kifu: serializeKifu(file), ply: 0, branch: [] });
}

/** いまの居場所を線に乗せる（分岐は手そのものを運ぶ）。 */
/**
 * ★v1.55: ハイライトを相手へ送る（親 v1.49 §9.4.2.2・§6.3.6）。
 *
 * **これだけは新しい伝言**＝盤の組み替えは「1 手」として既存の伝言に乗るが、
 * **印は手ではない**ので乗らない。**受け取った側は盤を組み立て直さない**。
 * ひとりのときは送らない（縮退）。
 */
export function shareReviewMark(square: { row: number; col: number } | null): void {
  if (!isSharedReview()) return;
  connector()?.sendReview({ kind: 'mark', square });
}

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
  // ★v1.55: **移っている最中は「抜けた」と扱わない**（親 §6.3.6）＝この間は
  // 互いに部屋の外に居るので、離脱の知らせと取り違えると毎回「相手が退室しました」
  // が出てしまう。
  if (useReviewShareStore.getState().migrating) return true;
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
      // ★v1.55: **相手がホストなら合言葉が載っている**ので控える（§6.3.6）。
      // **人には見せない**（画面には出さない）。
      offeredMigration = msg.pass && msg.room ? { pass: msg.pass, room: msg.room } : null;
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
        // ★v1.53: ここも**いま終わった対局で決め直す**＝断られた側は打診しかしていない
        //   ので 1 局を決めておらず、前に見た棋譜の控えが残っていればそれが出ていた。
        ensureReviewTarget(true);
        useReviewShareStore.setState({ ...initial, notice: 'declined' });
        enterReviewScreen();
        return;
      }
      const role = beginSharedReview(true);
      enterReviewScreen();
      // ★v1.55: **受けてもらえたら感想戦の部屋へ移る**（親 §9.4.4）。
      // 自分がホストなら打診のときに作った合言葉、ゲストなら返事に載ってきたもの。
      const m = pendingMigration() ?? (msg.pass && msg.room ? { pass: msg.pass, room: msg.room } : null);
      if (m) {
        migrateToReviewRoom(m.pass, m.room);
        return;
      }
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
    case 'mark': {
      if (!isSharedReview()) return;
      // **盤は組み立て直さない**（印は局面の一部ではない）。
      const seq = (useReviewShareStore.getState().mark?.seq ?? 0) + 1;
      useReviewShareStore.setState({
        mark: msg.square ? { ...msg.square, seq } : null,
      });
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
