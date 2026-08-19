import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useGameStore } from '../../../core/store/game-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import {
  buildInitialKindMap,
  displayKindsFor,
  isInCheck,
  moveLandingSquare,
} from '../../../core/engine';
import { useQuantumCycle } from '../../../core/ui-core/quantum-cycle';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import {
  CandidateBox,
  PieceStandView,
  PieceView,
  PromotionModal,
  groupHand,
} from '../../../core/ui-core/GameScreen';
import { seButton, seCapture, seCheck, seMove, seSelect } from '../../../core/audio/se-synth';
import { saveKifuFile } from '../index';
import { chooseFolder, rememberedFolder, type FsDirHandle } from '../folder';
import { asReplay, holdReplayGuard, replayKifu } from '../replay';
import {
  reviewApplyMoves,
  reviewBranchMoves,
  reviewIsOwnGame,
  reviewMySide,
  reviewSelectHand,
  reviewSelectSquare,
  reviewTarget,
  reviewUndoBranch,
} from '../review';
import {
  bindReviewView,
  clearReviewNotice,
  endSharedReview,
  leaveSharedReview,
  replaceSharedKifu,
  shareReviewMark,
  shareReviewMove,
  shareReviewSeek,
  shareReviewUndo,
  useReviewShareStore,
  type ReviewView,
} from '../review-share';
import { get as pluginGet } from '../../../core/plugin/registry';
import type { OnlineGameConnector } from '../../../core/plugin/gameConnector';
import { ChatConsole } from '../../../core/ui-core/ChatConsole';
import { useChatStore } from '../../../core/store/chat-store';
import { endingLabel } from './ending';
import { kifuMemoryState, loadLastKifu } from '../storage';
import { adoptLoadedKifu } from '../index';
import { readKifuFile } from '../io';
import { requestKifuLoad } from '../../../core/store/kifu-guard';
import type { KifuFile } from '../types';
import { kifuLabels } from './labels';

const SPEEDS = [1, 2, 0.5] as const;

/**
 * 感想戦画面 (S11)。機能の正典＝画面機能 v0.37 §3 S11・意味論＝親 v1.42 §9.4・
 * 絵柄＝付録D-12 v1.0・実装参照モック `momo_shogi_S11_mock_v1.html`。
 *
 * **記録された対局を並べ直し、どの局面からでも自由に指せる場**。時計は動かず、
 * 勝敗も無い。**手番の縛りが無く、指せるのは合法手だけ**（盤面編集ではない）。
 *
 * **画面は棋譜再生 (S08) と別だが、中の仕掛けは共有する**（ユーザー判断 2026-08-17）
 * ＝並べ直し (`replayKifu`)・盤の大きさの計算 (`.stage.s08`)・巡回 (`useQuantumCycle`)・
 * 駒と駒台 (GameScreen の部品) をそのまま借りる。**2 か所に作ると片方だけ直る**。
 *
 * **★記録を作らない**（親 §9.4／§9.2.3 ③）＝**画面に居る間ずっと「本物の対局ではない」
 * と名乗り続ける** (`holdReplayGuard`)。操作のたびに名乗る形にすると、分岐で詰ませた
 * 瞬間などに名乗り漏れが起き、その分岐が新しい対局として記憶を上書きする。
 */
export function ReviewScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const mgf = useGameStore((s) => s.mgf);
  const position = useGameStore((s) => s.position);
  const quantumDisplay = useGameStore((s) => s.quantumDisplay);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const selectedSquare = useGameStore((s) => s.selectedSquare);
  const selectedHandPieceId = useGameStore((s) => s.selectedHandPieceId);
  const legalDestinations = useGameStore((s) => s.legalDestinations);
  const hintOn = useGameStore((s) => s.hintAlwaysOn);
  const tryMove = useGameStore((s) => s.tryMove);
  const applyFreeMove = useGameStore((s) => s.applyFreeMove);
  const lastAppliedMove = useGameStore((s) => s.lastAppliedMove);
  const clearSelection = useGameStore((s) => s.clearSelection);

  /**
   * 振り返る 1 局。**入るときに決まっていて、この画面では選び直せない**（親 §9.4.1）。
   * 二人のときだけ、**ホストから配られた棋譜で差し替わる**（親 §6.3.6・入室時の 1 回）。
   */
  const [file, setFile] = useState<KifuFile | null>(() => reviewTarget());
  /**
   * ★v1.57: **いま振り返っている 1 局が、自分が指した対局から来たものか**（親 §9.2.5）。
   * **盤の向きがこれで決まる**。画面の中で棋譜を読み込んだら、その場で決め直す。
   */
  const [ownGame, setOwnGame] = useState<boolean>(() => reviewIsOwnGame());
  const [ply, setPly] = useState(0);
  /**
   * 盤を並べ直させる合図。**手数が変わらないまま作り直したいことがある**
   * （末尾で分岐を捨てるとき）ので、手数だけを頼りにしない。
   */
  const [rebuild, setRebuild] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);
  const [folder, setFolder] = useState<FsDirHandle | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(() => isRememberedAndSaved(file));
  const [toast, setToast] = useState<string | null>(null);
  /**
   * ★v1.55: ハイライト（親 v1.49 §9.4.2.2）＝**盤の 1 か所を指し示す印**。
   * 「ここでしょ」と話すためのもので、**常に 1 つ**。**盤が変われば消える**。
   * **自分の印と相手の印を描き分けない**（印は 1 つ＝§9.4.2.2）ので、入れ物も 1 つ。
   */
  const [mark, setMark] = useState<{ row: number; col: number } | null>(null);

  const labels = kifuLabels(locale);
  const moveCount = file ? file.moves.length : 0;
  /** 分岐で指している手数。**盤が持つ手の並びから引く**（別に数えない・review.ts）。 */
  const branch = Math.max(0, moveHistory.length - ply);
  const branchTexts = moveHistory.slice(ply);

  // 二人の感想戦（親 §9.4.4）。ひとりのときは role が null で、以下はすべて縮退する。
  const shareRole = useReviewShareStore((s) => s.role);
  const shareReady = useReviewShareStore((s) => s.ready);
  const oppName = useReviewShareStore((s) => s.opponentName);
  const oppPresent = useReviewShareStore((s) => s.opponentPresent);
  const incoming = useReviewShareStore((s) => s.incoming);
  const notice = useReviewShareStore((s) => s.notice);
  /** 自分が建てた／入った感想戦の部屋に居るか（v1.52 の表示分けに使う）。 */
  const ownsRoom = useReviewShareStore((s) => s.ownsRoom);
  const shared = shareRole !== null;
  /** **棋譜を配っている最中は触れない**（画面機能 §3 S11・付録D-12 §5）。 */
  /**
   * ★v1.55: **移っている最中も盤に触れない**（親 §9.4.4）＝線が切れている間に
   * 指しても相手へ届かない。**待つ理由は 2 つある**（配られるのを待つ／部屋へ移る）
   * ので、**押せない理由も言葉で書き分ける**（灰色は「押せない」しか意味しない）。
   */
  const migrating = useReviewShareStore((s) => s.migrating);
  const waiting = (shared && !shareReady) || migrating;

  /**
   * **画面に居る間ずっと「本物の対局ではない」と名乗る**（親 §9.4.3）。
   * いちばん先に置く＝この後ろの効果が盤に触れる前から囲われているようにする。
   */
  useEffect(() => holdReplayGuard(), []);

  /**
   * ★チャットは**入るたびに空から始める**（画面機能 v0.40 §3 S11・ユーザー判断）。
   *
   * **入口ごとに空にしない**＝入口は 4 通り（終局直後・棋譜再生・モード選択・
   * 一覧から入室）あり、数え上げる形にすると 1 か所の書き忘れで**対局中の会話が
   * 感想戦へ漏れる**。**画面に入ったという事実 1 つで囲う**なら、入口が何通りに
   * 増えても直す場所は無い。
   *
   * **空にするのはここだけ**＝この後で相手が入ってきても、抜けても消さない
   * （話した内容が手元から消えるほうが不都合）。
   */
  useEffect(() => {
    useChatStore.getState().clearChat();
  }, []);

  /**
   * ★v1.54: **振り返る 1 局を、この画面で差し替える**（親 v1.48 §9.4.2）。
   *
   * **開く前に確認を通す**＝読み込みは破棄の契機（親 §9.2.3 ②）なので、未保存の
   * 棋譜があれば「保存する／破棄する／やめる」が先に出る。**書類ピッカーを開いて
   * から尋ねない**（開くと、やめたときの行き先も受け皿の中身も見えなくなる）。
   *
   * **二人のときはホストだけ**（ボタンごと出さない・親 §9.4.1）＝ゲストが差し替えると
   * 配られる 1 局と食い違ったまま、どちらが正かを確かめる材料が無くなる。
   */
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const canLoad = !shared || shareRole === 'host';
  const requestLoad = () => {
    seButton();
    setPlaying(false);
    requestKifuLoad(() => pickerRef.current?.click());
  };
  const onPicked = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    try {
      const next = await readKifuFile(chosen);
      // 読み込めた時点でファイルは存在するので、記憶の印は最初から「保存済み」。
      adoptLoadedKifu(next);
      // **差し替えたら初期局面から**（親 §9.4.1）＝分岐も持ち越さない。
      setFile(next);
      // ★v1.57: **読み込んだ棋譜は自分の対局ではない**＝盤は先手が下（親 §9.2.5）。
      setOwnGame(false);
      setPly(0);
      setRebuild((v) => v + 1);
      setSaved(true);
      // **二人のときは配り直す**＝差し替えられるのはホストだけなので、配る側も 1 つ。
      replaceSharedKifu(next);
      setToast(t('s08.loaded'));
    } catch {
      // 棋譜でないものを選んだ。**いま振り返っている 1 局はそのまま**にして理由だけ出す
      //（画面機能 §3 S11「状態・エラー」＝失敗したら差し替えない）。
      setToast(t('s08.loadFailed'));
    }
  };

  /**
   * ★v1.52: 建てた部屋を畳む（付録D-12 §8）。**画面には残る**＝ひとりの感想戦は
   * 続けられる。**畳んだことを必ず知らせる**＝黙って消えると、出たのかどうかが
   * 分からない（2026-08-18 ご報告）。
   */
  const closeRoom = () => {
    pluginGet<() => void>('reviewRoom:leave')?.();
    endSharedReview();
    setToast(t('s11.roomClosed'));
  };

  /**
   * **入る前の盤を丸ごと控えて、離れるときに戻す**（親 §9.4.3・S08 と同じ仕掛け）。
   * 感想戦は盤を作り直すので、戻さないと呼び出し元（結果・棋譜再生）が指し掛けに見える。
   */
  const boardBeforeRef = useRef(useGameStore.getState());
  useEffect(
    () => () => {
      asReplay(() => useGameStore.setState(boardBeforeRef.current, true));
    },
    [],
  );

  /**
   * 相手から届いた分岐。**並べ直した直後に載せる**ので、盤を作り直す仕掛けの
   * すぐ内側で受け渡す（別の効果に分けると、載せる前に一瞬だけ本譜が見える）。
   */
  const pendingBranchRef = useRef<ReviewView['branch'] | null>(null);
  /** **両者が知っている居場所**。ここと今が違えば、まだ相手に伝えていないということ。 */
  const sharedPointRef = useRef<ReviewView>({ ply: 0, branch: [] });

  // 盤を「本譜を ply 手まで」に並べ直す。**分岐の手はここでは載らない**＝分岐は
  // この後に指し足したぶんなので、並べ直すと消える（＝それが「捨てる」の実体）。
  useEffect(() => {
    if (!file) return;
    replayKifu(file, ply);
    // 二人のときは、相手が指していた分岐をそのまま並べ足す（親 §6.3.6）。
    const pending = pendingBranchRef.current;
    pendingBranchRef.current = null;
    if (pending && pending.length > 0) reviewApplyMoves(pending);
  }, [file, ply, rebuild]);

  /**
   * 相手の居場所を自分の盤へ映す（親 §6.3.6）。**毎回そこから組み立て直す**ので、
   * 届く順や取りこぼしでずれることがない。
   */
  useEffect(() => {
    if (!incoming) return;
    pendingBranchRef.current = incoming.branch;
    // **映した先を「両者が知っている場所」として控える**＝これで下の見張りは
    // 「変わっていない」と見るので、映しただけのものを送り返さない（打ち合いになる）。
    sharedPointRef.current = { ply: incoming.ply, branch: incoming.branch };
    // 配られた棋譜で差し替わることがある（ゲスト側の 1 回目）。
    const target = reviewTarget();
    if (target !== file) {
      setFile(target);
      // ★v1.57: 配られた 1 局の出どころに従って向きを決め直す（親 §9.2.5）＝
      // 1 回目（いま指した対局の続き）なら自分の側、差し替え（ホストが読み込んだ）なら先手が下。
      setOwnGame(reviewIsOwnGame());
    }
    setPlaying(false);
    setPly(incoming.ply);
    setRebuild((v) => v + 1);
  }, [incoming, file]);

  /**
   * ★自分が動いたことを相手へ伝える（親 §6.3.6）。
   *
   * **1 か所で見張る**＝「指した」「送った」「戻した」の出口ごとに送信を書き足すと、
   * どれかを必ず書き忘れる。**居場所が変わったという事実**だけを見て、その差から
   * どの伝言かを決める（手数が動いた＝再生／分岐が伸びた＝指した／縮んだ＝戻した）。
   */
  useEffect(() => {
    const here: ReviewView = { ply, branch: reviewBranchMoves(ply) };
    const before = sharedPointRef.current;
    const changed = before.ply !== here.ply || before.branch.length !== here.branch.length;
    sharedPointRef.current = here;
    if (!shared || !changed) return;
    const base = { ply: before.ply, branchLen: before.branch.length };
    if (before.ply !== here.ply) {
      shareReviewSeek(base, here.ply);
      return;
    }
    if (here.branch.length > before.branch.length) {
      shareReviewMove(base, here);
      return;
    }
    shareReviewUndo(base, here);
  }, [ply, moveHistory.length, shared]);

  /**
   * いま自分が居る場所を、通信側から見えるようにしておく（食い違いの判定に使う）。
   * **画面を離れるときは相手にも伝える**＝黙って居なくなると、相手は共有されて
   * いない操作を続けてしまう。
   */
  useEffect(() => {
    bindReviewView(() => sharedPointRef.current);
    return () => {
      bindReviewView(null);
      leaveSharedReview();
    };
  }, []);

  /** 量子の巡回の時計（付録D-12 §10）。**再生・分岐のいずれでも止めない**。 */
  const [cycleTick, setCycleTick] = useState(0);
  useEffect(() => {
    if (quantumDisplay !== 'cycle') return;
    const id = setInterval(() => setCycleTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [quantumDisplay]);
  const cycle = useQuantumCycle(cycleTick, quantumDisplay === 'cycle');

  // 自動再生。末尾で自分から止まる（付録D-8 §5）。
  const plyRef = useRef(ply);
  plyRef.current = ply;
  useEffect(() => {
    if (!playing || !file) return;
    const id = setInterval(() => {
      const next = plyRef.current + 1;
      if (next > moveCount) {
        setPlaying(false);
        return;
      }
      setPly(next);
      if (next >= moveCount) setPlaying(false);
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, file, moveCount]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  /**
   * 二人のときの一言（付録D-12 §7／§8）。**黙って済ませない**＝断られたことも、
   * 相手が抜けたことも、自分の手が消えたことも、そのまま伝える。
   */
  useEffect(() => {
    if (!notice) return;
    setToast(t(`s11.notice.${notice}`));
    clearReviewNotice();
    // t は locale ごとに作り直されるが、出す文言は notice が決まった時点のもので足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // 指定済みの保存先を控えから読む。**許可は尋ねない**（名前を出すだけなら要らない）。
  useEffect(() => {
    let alive = true;
    void rememberedFolder().then((dir) => {
      if (alive) setFolder(dir);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * ★v1.57: どちら側から見た盤にするか。**棋譜の出どころで決まる**（親 §9.2.5）。
   *
   * - **いま自分が指した対局を続けて振り返るとき**＝**自分の側が手前**。
   *   二人ならそれぞれ自分の側なので、**二人の画面は上下が逆**になる（棋譜には
   *   **書き出した人から見た向き**が入っており、ホストのものが配られるため、
   *   棋譜の向きをそのまま使うと**ゲストの盤だけ上下が逆**になる）。
   * - **外から読み込んだ棋譜**＝**先手が下**（どちらの対局でもないので寄せる先が無い）。
   *
   * **自分の側は控えてあるものを使う**（`reviewMySide`）＝**部屋を移ると先後は消える**
   * ので、その場で聞きに行っても答えが返らない（v1.55〜v1.56 の不具合の原因）。
   * 控えが無いときだけ、いま居る部屋に聞く（部屋を移らない経路のための保険）。
   */
  const viewerSide: 'player1' | 'player2' = !ownGame
    ? 'player1'
    : (shared
        ? (reviewMySide() ?? pluginGet<OnlineGameConnector>('gameConnector')?.getMySide())
        : null) ??
      file?.meta.viewerSide ??
      'player1';
  const oppSide: 'player1' | 'player2' = viewerSide === 'player1' ? 'player2' : 'player1';
  const flipped = viewerSide === 'player2';

  const kindMap = useMemo(() => buildInitialKindMap(position), [position]);
  const senteHand = groupHand(position.hands.player1, mgf, kindMap);
  const goteHand = groupHand(position.hands.player2, mgf, kindMap);
  const oppHand = viewerSide === 'player1' ? goteHand : senteHand;
  const myHand = viewerSide === 'player1' ? senteHand : goteHand;
  const lastTo =
    position.history.length > 0
      ? moveLandingSquare(position.history[position.history.length - 1])
      : null;

  const isHint = (row: number, col: number) => legalDestinations.some((d) => d.row === row && d.col === col);
  const isSelected = (row: number, col: number) =>
    selectedSquare?.row === row && selectedSquare?.col === col;

  /**
   * 手数を選び直す（先頭・末尾・目盛り・手数リスト）。**分岐は捨てる**＝
   * 記録をたどる操作なので、記録に無い局面から続けると並びが壊れる（親 §9.4.2）。
   */
  const jump = (n: number) => {
    const next = Math.max(0, Math.min(moveCount, n));
    setPlaying(false);
    if (next === ply) setRebuild((v) => v + 1);
    setPly(next);
  };

  /**
   * **「次へ」＝分岐を捨てて本譜へ戻したうえで、本譜の次の一手を指す**（親 §9.4.2）。
   * **捨てることを尋ねない**＝分岐は記録ではないので失うものが無い。
   * ただし**黙って捨てない**＝押す前に「本譜へ」と出し、押した後は一言知らせる。
   */
  const stepNext = () => {
    setPlaying(false);
    if (branch > 0) setToast(t('s11.droppedBranch'));
    if (ply >= moveCount) {
      // 末尾では進む先が無いので、分岐を捨てて本譜の末尾へ戻すだけ。
      if (branch > 0) setRebuild((v) => v + 1);
      return;
    }
    setPly(ply + 1);
  };

  /**
   * **「戻す」＝分岐の手があればその 1 手、無ければ本譜を 1 手**（親 §9.4.2）。
   * ボタンは 1 つ＝いま戻したいのは直前に指した手で、それが分岐か本譜かを
   * 人に区別させる理由が無い。
   */
  const stepBack = () => {
    setPlaying(false);
    if (branch > 0) {
      reviewUndoBranch();
      return;
    }
    if (ply > 0) setPly(ply - 1);
  };

  /**
   * ★v1.55: 盤が動いたら音を鳴らす（音響 v0.8 §2.1・ユーザー判断 2026-08-19）。
   *
   * **対局とまったく同じ音**を使う＝**盤が動いたことを音で知る**のは対局と変わらず、
   * 感想戦だけ黙らせる理由が無い。**自分の手でも相手の手でも鳴る**（自他を問わない
   * のは対局と同じ）。**取ったかどうかは駒台の枚数の増減で見る**（対局画面と同じ
   * 見分け方＝2 か所で違う数え方をしない）。
   *
   * **`SE-illegal` は使わない**＝感想戦には**不可操作が無い**（親 §9.4）。
   * **王手の音は鳴らす**が、これは「まずい」ではなく「そうなった」の知らせである
   * （王手を無視して指せるため）。
   */
  const prevHandsRef = useRef({
    p1: position.hands.player1.length,
    p2: position.hands.player2.length,
  });
  useEffect(() => {
    if (!lastAppliedMove) return;
    const curP1 = useGameStore.getState().position.hands.player1.length;
    const curP2 = useGameStore.getState().position.hands.player2.length;
    const wasCapture = curP1 > prevHandsRef.current.p1 || curP2 > prevHandsRef.current.p2;
    prevHandsRef.current = { p1: curP1, p2: curP2 };
    if (wasCapture) seCapture();
    else seMove();
    const pos = useGameStore.getState().position;
    if (isInCheck(useGameStore.getState().mgf, pos, pos.sideToMove)) setTimeout(seCheck, 90);
    // ★v1.55: **盤が変わったら印は消える**（親 §9.4.2.2）＝指し示した局面が変われば、
    // 指し示した意味も失われる。**消えるときは音を鳴らさない**（盤が動いた音が
    // 既に鳴っている）。
    setMark(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAppliedMove]);

  // 相手が付けた印を拾う（自分の印と同じ入れ物へ入れる＝描き分けない）。
  const peerMark = useReviewShareStore((s) => s.mark);
  useEffect(() => {
    if (!peerMark) {
      setMark(null);
      return;
    }
    setMark({ row: peerMark.row, col: peerMark.col });
    // **相手が付けた印でも鳴らす**（音響 v0.8 §2.3）＝相手が指し示したことに
    // 気づけないと用を成さない。
    seSelect();
  }, [peerMark]);

  /** 盤に触れたときの共通の後始末。**自動再生は止まる**（付録D-12 §5）。 */
  const touchBoard = () => {
    if (playing) setPlaying(false);
  };

  /** ★v1.55: 印を付け直す（相手にも伝える）。 */
  const putMark = (sq: { row: number; col: number } | null) => {
    setMark(sq);
    shareReviewMark(sq);
    if (sq) seSelect();
  };

  /**
   * ★v1.55: いま掴んでいる駒（盤／駒台）。自由な操作の的を出す条件でもある。
   * **掴んでいる間だけ的を出す**＝常に置くと画面が狭くなり、押し間違いも増える
   * （付録D-12 v1.4 §14.1）。
   */
  const heldPiece = selectedSquare
    ? position.board[selectedSquare.row][selectedSquare.col]
    : selectedHandPieceId
      ? position.hands.player1.find((p) => p.pieceId === selectedHandPieceId) ??
        position.hands.player2.find((p) => p.pieceId === selectedHandPieceId) ??
        null
      : null;

  /**
   * ★v1.55: 盤を自由に組み替える（親 §9.4.2.1）。
   *
   * **合法かどうかを見ない**。**量子の候補も絞らない**（量子分冊 §Q22＝自由な手は
   * 正体について何も語っていない）。**手として積む**ので「戻す」で 1 つずつ戻せ、
   * 二人のときは**指し手と同じ伝言でそのまま相手へ渡る**（新しい伝言を作らない）。
   */
  const doFree = (dest: import('../../../core/engine').MoveDest, promote?: boolean) => {
    if (!heldPiece) return;
    touchBoard();
    applyFreeMove({
      pieceId: heldPiece.pieceId,
      ...(selectedSquare ? { from: selectedSquare } : {}),
      dest,
      ...(promote !== undefined ? { promote } : {}),
    });
    clearSelection();
  };

  const onSquare = (row: number, col: number) => {
    setHoverSquare(`${row},${col}`);
    // **配り終えるまでは触れない**（画面機能 §3 S11）＝まだ何も並んでいないので、
    // ここで指せると、届いた瞬間に消える手を指すことになる。
    if (waiting) return;
    touchBoard();
    // 持っている駒の元の位置をもう一度押したら持ち直し（対局画面と同じ操作感）。
    // ★v1.55: **駒を持って同じマスへ戻したときも印が付く**（親 §9.4.2.2）＝
    // **駒のあるマスを指し示す手立てがこれしか無い**ため。
    if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
      clearSelection();
      putMark({ row, col });
      return;
    }
    if (selectedSquare || selectedHandPieceId) {
      // **合法な手はこれまでどおり指す**＝成りの確認も量子の候補の絞り込みも走る
      // （合法に指せたことは正体の手掛かりになる）。
      if (isHint(row, col)) {
        tryMove({ row, col });
        return;
      }
      // ★v1.55: **合法でない置き方も通す**（親 §9.4.2.1）＝王手を無視して指す・
      // 盤から盤へ直接移す・ルールを無視して打つ は、どれもここを通る。
      doFree({ kind: 'square', square: { row, col } });
      return;
    }
    // **どちらの駒でも掴める**（親 §9.4）。掴めたら選択音を鳴らす。
    if (reviewSelectSquare({ row, col })) {
      seSelect();
      return;
    }
    // ★v1.55: **何もないマスを触ると、そのマスに印が付く**（親 §9.4.2.2）。
    // 別のマスを触れば印はそちらへ移る（印は常に 1 つ）。
    putMark({ row, col });
  };

  /**
   * ★v1.56: **駒を持って駒台を押したら、その駒台へ移す**（親 §9.4.2.1・
   * 2026-08-19 ユーザーご指示）。v1.55 の「盤に浮く的」は廃止した＝
   * **駒台が目の前にあるのに別の的を押させるのは遠回り**だった。
   *
   * **持っていないときは何も起きない**（駒台の駒を押すのは別の受け口）。
   */
  const onStand = (owner: 'player1' | 'player2') => {
    if (waiting) return;
    if (!heldPiece) return;
    doFree({ kind: 'hand', owner });
  };

  const onHand = (owner: 'player1' | 'player2', pieceId: string) => {
    if (waiting) return;
    touchBoard();
    if (selectedHandPieceId === pieceId) {
      clearSelection();
      return;
    }
    reviewSelectHand(owner, pieceId);
    seSelect();
  };

  /**
   * **書き出すのは記録された本譜だけ**（親 §9.4.2・§9.2.3 ③）。
   * 分岐して指している最中でも満額の本譜が出る＝盤からは組み立てない。
   */
  const save = () => {
    if (!file) return;
    setSaving(true);
    void saveKifuFile(file)
      .then((outcome) => {
        if (outcome === 'saved') {
          setSaved(true);
          void refreshFolder();
          return;
        }
        // やめた・書けなかったは別の言葉にする（やめていない人に「やめました」と言わない）。
        setToast(t(outcome === 'cancelled' ? 's08.saveCancelled' : 's08.saveFailed'));
      })
      .finally(() => setSaving(false));
  };

  /** 書けたあとに保存先を読み直す（名前を出すためだけなので許可は尋ねない）。 */
  const refreshFolder = async () => {
    const dir = await rememberedFolder();
    if (dir) setFolder(dir);
  };

  /** 「別のフォルダを選ぶ」。**やめたときは今のフォルダをそのまま残す**（親 §9.2.3 ④）。 */
  const changeFolder = async () => {
    setFolderBusy(true);
    try {
      const dir = await chooseFolder();
      if (!dir) return;
      setFolder(dir);
    } finally {
      setFolderBusy(false);
    }
  };

  /**
   * ★v1.54: **戻るは、どこから入ってもモード選択の一択**（親 v1.48 §9.4.3・付録D-12 §3）。
   *
   * v1.53 までは入ってきた画面（結果／棋譜再生／モード選択）へ戻していた。**この画面の
   * 中で棋譜を読み込めるようになった**ので、その前提＝「入るときに対象が決まり、画面の
   * 中で選び直せない」が失われた＝**別の棋譜を見ている最中に、無関係な直前の対局の結果
   * へ飛ぶ**ことになる。**S08 が v1.41 で「結果へ」をやめたのとまったく同じ理由**。
   *
   * **部屋からも出る**のは `leaveSharedReview`（画面を離れる後始末）が受け持つ＝
   * 出口ごとに書き足さない。
   */
  const backLabel = t('s00.modeSelect');
  const goBack = () => {
    seButton();
    setScreen('lobby');
  };

  const subLocale = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  return (
    // 盤の大きさの計算は棋譜再生と同じもの（付録D-12 §1・付録D-8 v1.6 §5.1）。
    // `s11` は**この画面だけ縦に増える帯**（自由に指せる旨・補助語・保存の注記）を
    // 引くための目印で、計算そのものは 1 か所（styles.css の `.stage.s08`）にしかない。
    <div
      // ★v1.55: `has-chat` は廃止した＝**チャットと観戦者はひとりのときも置いたまま
      // 灰色にする**ので（付録D-12 v1.4 §2）、**相手が入ってきても置くものの数が
      // 変わらない**。v1.50〜v1.54 は二人になった瞬間に厚みが増え、**盤の大きさが
      // 動いていた**。
      className="stage s08 s11"
      style={
        {
          '--board-cols': mgf.board.width,
          '--board-rows': mgf.board.height,
        } as CSSProperties
      }
    >
      {/* ★v1.57: **ヘッダと操作の行は列の外へ出す**（付録D-12 v1.6 §2／§5）。
          理由は 2 つあり、どちらも実機のご報告から出たもの（2026-08-19）。
          ①**盤の位置が操作の行の伸び縮みで動いていた**＝列の幅は「その中でいちばん
            幅を要るもの」で決まるので、棋譜の情報を載せたこの行が盤より幅を要ると、
            **成り・不成のボタンが出入りするたびに盤が左右に動く**（実測 25px）。
          ②**右の列が盤と同じ高さから始まる**＝この 2 つが左の列に居る間、右の列は
            盤より 159px 上から始まっており、**盤の下側を見ようと画面を送ると
            再生の操作帯が画面の上へ抜けて届かなかった**（実測 308px）。
          列の外へ出すと、**列の幅は盤の側だけで決まり、右の列は盤の高さから始まる**。 */}
      <header className="match-header">
            <CatIcon />
            <div className="title-block">
              <h1>
                <span className="momo">MOMO</span> <span className="shogi">Shogi</span>{' '}
                <span className="ver">{t('app.ver')}</span>
              </h1>
              <div className={`subtitle${subLocale === 'zh' ? ' zh' : ''}`}>{subtitle}</div>
            </div>
            <div className="header-spacer" />
            <div className="header-tools">
              {/* ★v1.55: 戻るはタイトルブロックの右（付録D-12 v1.4 §3・他の画面と同じ
                  位置）。**戻るはどこから入ってもモード選択の一択**（v1.54）。
                  v1.54 までのヘッダ直下のツールバー帯は廃止した。 */}
              <button
                className="reset-btn"
                type="button"
                onClick={goBack}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {backLabel}
              </button>
              <HeaderCommonRight />
            </div>
          </header>

          {/* ★v1.56: 見出しと操作を **1 行にまとめた**（付録D-12 v1.5 §3・
              2026-08-19 ご指摘）＝v1.55 は見出しと操作で 2 段になっており、
              **その 2 段だけで盤の 1 マスの 2 倍の高さ**を使っていた。
              **「感想戦」は小さいオレンジ文字**（囲わない＝枠はボタンに見える）。 */}
          <div className="s11-bar">
            <span className="s11-title">{t('s11.title')}</span>
            {/* **棋譜を読み込む**（親 §9.4.2・二人のときはホストだけ）。 */}
            {canLoad && (
              <button type="button" className="io-btn" onClick={requestLoad}>
                {t('s11.loadKifu')}
              </button>
            )}
            <button
              type="button"
              className="io-btn"
              disabled={waiting || !file || saving}
              onClick={() => {
                seButton();
                save();
              }}
            >
              {t('result.saveKifu')}
            </button>
            {saved && <span className="saved-tag">✓</span>}
            {/* **押す前に分かるようにする**（付録D-12 §9）＝分岐して指している最中でも、
                書き出されるのは満額の本譜。**分岐中だけ出す**ので、ふだんは行を取らない。 */}
            {branch > 0 && <span className="io-note">{t('s11.saveNote')}</span>}
            {folder && (
              <button
                type="button"
                className="dest-btn"
                disabled={folderBusy}
                title={folder.name}
                onClick={() => {
                  seButton();
                  void changeFolder();
                }}
              >
                <span className="ic">📁</span>
                <span className="nm">{folder.name}</span>
              </button>
            )}
            {/* **自分が建てた部屋に居る間は畳む手立てを出す**（付録D-12 §8）。 */}
            {ownsRoom && !shared && (
              <button
                type="button"
                className="io-btn"
                onClick={() => {
                  seButton();
                  closeRoom();
                }}
              >
                {t('s11.closeRoom')}
              </button>
            )}
            {/* ★v1.56: **成り・不成の切り替えはここに出す**（掴んでいる間だけ）。
                v1.55 の「盤に浮く的」は廃止した＝**駒台への移動は駒台を押す**形に
                なり、**消すは無くなった**ので、残るのはこれ 1 つだけになった。 */}
            {selectedSquare && heldPiece && (
              <button
                type="button"
                className="io-btn promote"
                onClick={() =>
                  doFree({ kind: 'square', square: selectedSquare }, !heldPiece.promoted)
                }
              >
                {heldPiece.promoted ? t('s11.free.unpromote') : t('s11.free.promote')}
              </button>
            )}
            <div className="kifu-meta">
              {file ? (
                <>
                  <span className="rn">{labels.ruleName(file)}</span>
                  <span className="mods">
                    {labels.modifiers(file).map((m) => (
                      <span key={m} className="mod-badge">
                        {m}
                      </span>
                    ))}
                  </span>
                  <span className="who">
                    {labels.players(file)} · {labels.date(file)}
                  </span>
                </>
              ) : (
                <span className="who">{t('s11.noKifu')}</span>
              )}
            </div>
            {/* 相手の在室（付録D-12 §3）。**緑は使わない**＝緑は「済んでいる」を表す色。 */}
            {shared && (
              <span className={`peer${oppPresent ? '' : ' gone'}`}>
                {oppPresent ? '●' : '○'} {oppName || t('player.opp')}
                {oppPresent ? '' : ` ${t('s11.peerGone')}`}
              </span>
            )}
            <input
              ref={pickerRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => void onPicked(e.currentTarget)}
            />
          </div>

      <div className="grid">
        <div className="main-col">
          <div className="pinfo opp">
            <span className="nm">{file ? labels.playerLabel(file, oppSide) : t('player.opp')}</span>
            {/* ★v1.55: **王手は出す**（親 §9.4.2.1）。ただし**無視して指せる**ので、
                これは「まずい」ではなく「そうなった」の知らせである。 */}
            {isInCheck(mgf, position, oppSide) && <span className="check-tag">{t('s07.checkTag')}</span>}
          </div>

          {/* 盤・駒台は対局画面の部品をそのまま借りる。**時計・手番の縁取りは出さない**
              （勝敗も持ち時間も無いため）が、**移動先ヒントは出す**＝指せる場所を
              確かめる画面なので（付録D-12 §4）。 */}
          <div className="broadcast">
            <PieceStandView
              side="opp"
              pieces={oppHand}
              onClick={(pid) => onHand(oppSide, pid)}
              onStandClick={() => onStand(oppSide)}
              selectedId={selectedHandPieceId}
              activePlayer
              locale={locale}
              label={oppSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl')}
              mode={quantumDisplay}
              cycle={cycle}
            />
            <div className={`board-with-coords${flipped ? ' flipped' : ''}`}>
              {/* 分岐中は盤の外枠を破線にする＝**いま見ているのが記録された局面では
                  ない**ことを、盤そのもので示す（付録D-12 §4）。 */}
              <div className={`board-outer${branch > 0 ? ' branching' : ''}`}>
                <div className="col-coords">
                  {(flipped ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1]).map((n) => (
                    <span key={n}>{n}</span>
                  ))}
                </div>
                <div className={`row-coords${locale === 'en' ? ' en' : ''}`}>
                  {((): string[] => {
                    const arabic = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
                    const kanji = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
                    const arr = locale === 'en' ? arabic : kanji;
                    return flipped ? [...arr].reverse() : arr;
                  })().map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                <div className="board" aria-label={t('s07.boardAria')}>
                  <div className="stars">
                    {[3, 6].flatMap((cx) =>
                      [3, 6].map((cy) => (
                        <div
                          key={`${cx}-${cy}`}
                          className="star"
                          style={{ left: `${(cx / 9) * 100}%`, top: `${(cy / 9) * 100}%` }}
                        />
                      )),
                    )}
                  </div>
                  {Array.from({ length: 81 }).map((_, i) => {
                    const visualRow = Math.floor(i / 9);
                    const visualCol = i % 9;
                    const row = flipped ? 8 - visualRow : visualRow;
                    const col = flipped ? 8 - visualCol : visualCol;
                    const piece = position.board[row][col];
                    const kinds = piece ? displayKindsFor(mgf, piece, kindMap) : [];
                    const hovered = hoverSquare === `${row},${col}`;
                    const cls = [
                      'sq',
                      isSelected(row, col) ? 'selected' : '',
                      hintOn && isHint(row, col) ? 'hint' : '',
                      lastTo?.row === row && lastTo?.col === col ? 'lastmove' : '',
                      mark?.row === row && mark?.col === col ? 'review-mark' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div
                        key={i}
                        className={cls}
                        onMouseEnter={() => setHoverSquare(`${row},${col}`)}
                        onMouseLeave={() =>
                          setHoverSquare((cur) => (cur === `${row},${col}` ? null : cur))
                        }
                        onClick={() => onSquare(row, col)}
                      >
                        {piece && (
                          <PieceView
                            piece={piece}
                            kinds={kinds}
                            locale={locale}
                            viewerSide={viewerSide}
                            mode={quantumDisplay}
                            cycle={cycle}
                          />
                        )}
                        {piece && kinds.length >= 2 && (
                          <span className={`qmark-b${piece.owner !== viewerSide ? ' gote' : ''}`}>？</span>
                        )}
                        {/* 盤の駒に触れると候補が開く（対局画面・棋譜再生と同じ）。 */}
                        {piece && kinds.length >= 2 && (hovered || isSelected(row, col)) && (
                          <CandidateBox
                            kinds={kinds}
                            locale={locale}
                            onLeft={visualCol >= 6}
                            below={visualRow <= 1}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <PieceStandView
              side="you"
              pieces={myHand}
              onClick={(pid) => onHand(viewerSide, pid)}
              onStandClick={() => onStand(viewerSide)}
              selectedId={selectedHandPieceId}
              activePlayer
              locale={locale}
              label={viewerSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl')}
              mode={quantumDisplay}
              cycle={cycle}
            />
          </div>

          <div className="pinfo you">
            <span className="nm">{file ? labels.playerLabel(file, viewerSide) : t('player.you')}</span>
            {isInCheck(mgf, position, viewerSide) && (
              <span className="check-tag">{t('s07.checkTag')}</span>
            )}
          </div>

        </div>

        {/* ★v1.55: 右カラム（付録D-12 v1.4 §2）＝**上から 操作帯 → チャット →
            観戦者 → 棋譜**。**チャット・観戦者・棋譜の並びは対局画面と同じ**
            （同じものを違う並びにしない）。 */}
        <div className="moves-col">
        {/* 再生の操作帯（付録D-8 §5 の帯をそのまま／補助語だけ S11 で足す）。 */}
        <div className="playbar">
          <div className="btns">
            <div className="pbwrap">
              <button
                type="button"
                className="pb"
                disabled={waiting || (ply === 0 && branch === 0)}
                onClick={() => jump(0)}
              >
                |◀
              </button>
              <span className="pb-sub" />
            </div>
            <div className="pbwrap">
              <button
                type="button"
                className="pb"
                disabled={waiting || (ply === 0 && branch === 0)}
                onClick={stepBack}
              >
                ◀
              </button>
              <span className="pb-sub" />
            </div>
            <div className="pbwrap">
              <button
                type="button"
                className={`pb auto${playing ? ' playing' : ''}`}
                disabled={waiting || !file || moveCount === 0}
                onClick={() => {
                  if (playing) {
                    setPlaying(false);
                    return;
                  }
                  // 分岐したまま自動再生は始めない（記録をたどる操作なので本譜へ戻す）。
                  if (branch > 0) setRebuild((v) => v + 1);
                  if (ply >= moveCount) setPly(0);
                  setPlaying(true);
                }}
              >
                {playing ? `⏸ ${t('s08.stop')}` : `▶ ${t('s08.auto')}`}
              </button>
              <span className="pb-sub" />
            </div>
            <div className="pbwrap">
              <button
                type="button"
                className="pb spd"
                onClick={() => setSpeed((cur) => SPEEDS[(SPEEDS.indexOf(cur as 1) + 1) % SPEEDS.length])}
              >
                {speed === 0.5 ? '0.5×' : `${speed}×`}
              </button>
              <span className="pb-sub" />
            </div>
            <div className="pbwrap">
              <button
                type="button"
                className="pb"
                disabled={waiting || (ply >= moveCount && branch === 0)}
                onClick={stepNext}
              >
                ▶
              </button>
              {/* **押す前に分かるようにする**＝分岐中の「次へ」は本譜へ戻ってから進む。 */}
              <span className="pb-sub">{branch > 0 ? t('s11.toMain') : ''}</span>
            </div>
            <div className="pbwrap">
              <button
                type="button"
                className="pb"
                disabled={waiting || (ply >= moveCount && branch === 0)}
                onClick={() => jump(moveCount)}
              >
                ▶|
              </button>
              <span className="pb-sub" />
            </div>
          </div>
          <div className="track">
            <input
              type="range"
              min={0}
              max={Math.max(moveCount, 1)}
              value={ply}
              disabled={waiting || !file || moveCount === 0}
              onChange={(e) => jump(Number(e.target.value))}
            />
            <span className="plycnt">
              {ply} / {moveCount}
              {branch > 0 ? ` +${branch}` : ''}
            </span>
          </div>
          {/* 配っている最中はその旨を出す（付録D-12 §8）＝押せないのに何も
              書いていないと、壊れているのか待てばよいのかが分からない。 */}
          {/* ★v1.55: **掴んでいる間は「どこへでも置けます」**（付録D-12 v1.4 §14.1）
              ＝移動先ヒントを「ここしか置けません」と読ませないため。 */}
          <div className="free-note">
            {migrating
              ? t('s11.migrating')
              : waiting
                ? t('s11.receiving')
                : heldPiece
                  ? t('s11.free.anywhere')
                  : t('s11.free')}
          </div>
        </div>

          {/* チャット・観戦者は**ひとりのときも置いたまま灰色にする**（対局画面が
              オフライン対戦でそうしているのと同じ）＝**相手が入ってきた拍子に
              並びが変わって盤の大きさが動く**のを防ぐ。 */}
          <div className={`panel${shared ? '' : ' offline-disabled'}`}>
            <div className="panel-label">
              <span>{t('chat.title')}</span>
            </div>
            <ChatConsole t={t} />
          </div>

          <div className={`panel spectators${shared ? '' : ' offline-disabled'}`}>
            <div className="panel-label">
              <span>{t('spec.title')}</span>
            </div>
            <div className="spec-empty">{t('spec.empty')}</div>
          </div>

          <div className="panel">
            <div className="panel-label">
              <span>{t('s08.moves')}</span>
            </div>
            <ReviewMoveList
              file={file}
              ply={ply}
              branchTexts={branchTexts}
              onJump={jump}
              startLabel={t('s08.start')}
              branchLabel={t('s11.branch')}
              ending={endingLabel(file?.meta.result, locale)}
            />
          </div>
        </div>
      </div>

      {/* 成るかどうかの確認。対局画面と同じものを出す（発明し直さない）。 */}
      <PromotionModal locale={locale} t={t} viewerSide={viewerSide} mode={quantumDisplay} cycle={cycle} />

      {toast && <div className="s08-toast">{toast}</div>}
    </div>
  );
}

/**
 * 手数リスト（付録D-12 §6）。**本譜は棋譜再生のまま**で、分岐だけを足す。
 *
 * **分岐は本譜の行の下に 1 段字下げして続け、手数の番号を振らない**
 * ＝分岐は記録ではないので、本譜と同じ体系で数えると保存された棋譜と食い違って見える。
 */
function ReviewMoveList({
  file,
  ply,
  branchTexts,
  onJump,
  startLabel,
  branchLabel,
  ending,
}: {
  file: KifuFile | null;
  ply: number;
  branchTexts: string[];
  onJump: (n: number) => void;
  startLabel: string;
  branchLabel: string;
  ending: string | null;
}) {
  const curRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'nearest' });
  }, [ply, file, branchTexts.length]);

  const texts = file?.moveTexts ?? [];
  const count = file?.moves.length ?? 0;
  const onBranch = branchTexts.length > 0;

  /** 分岐の枝（本譜の分かれ目の直後に置く）。**現在いる行だけ白**にする。 */
  const branchRows = branchTexts.map((text, j) => (
    <div
      key={`br-${j}`}
      ref={j === branchTexts.length - 1 ? curRef : undefined}
      className={`mv br${j === branchTexts.length - 1 ? ' cur' : ''}`}
    >
      <span className="no">└</span>
      <span className="nt">{text}</span>
      {j === 0 && <span className="br-badge">{branchLabel}</span>}
    </div>
  ));

  return (
    <div className="mv-list">
      <div
        ref={ply === 0 && !onBranch ? curRef : undefined}
        className={`mv start${ply === 0 && !onBranch ? ' cur' : ''}`}
        onClick={() => onJump(0)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onJump(0)}
      >
        <span className="no">0</span>
        <span className="nt">{startLabel}</span>
        {ending && count === 0 && <span className="end-badge">{ending}</span>}
      </div>
      {ply === 0 && branchRows}
      {Array.from({ length: count }).map((_, i) => {
        const cur = ply === i + 1 && !onBranch;
        return (
          <div key={i}>
            <div
              ref={cur ? curRef : undefined}
              className={`mv${cur ? ' cur' : ''}`}
              onClick={() => onJump(i + 1)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onJump(i + 1)}
            >
              <span className="no">{i + 1}</span>
              <span className="nt">{texts[i] ?? ''}</span>
              {ending && i === count - 1 && <span className="end-badge">{ending}</span>}
            </div>
            {ply === i + 1 && branchRows}
          </div>
        );
      })}
    </div>
  );
}

/**
 * この 1 局が「記憶していて、かつ保存済み」か（付録D-12 §9 の保存済みの印）。
 *
 * 棋譜には対局そのものの番号が無いので、**書き出した時刻と手数**で見分ける
 * （index.ts の `isRememberedKifu` と同じ見分け方）。
 */
function isRememberedAndSaved(file: KifuFile | null): boolean {
  if (!file) return false;
  const m = loadLastKifu();
  if (!m || m.meta.savedAt !== file.meta.savedAt || m.meta.moveCount !== file.meta.moveCount) {
    return false;
  }
  return kifuMemoryState() === 'saved';
}
