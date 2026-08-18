import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useGameStore } from '../../../core/store/game-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import { buildInitialKindMap, displayKindsFor } from '../../../core/engine';
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
import { seButton, seSelect } from '../../../core/audio/se-synth';
import { saveKifuFile } from '../index';
import { chooseFolder, rememberedFolder, type FsDirHandle } from '../folder';
import { asReplay, holdReplayGuard, replayKifu } from '../replay';
import {
  reviewApplyMoves,
  reviewBranchMoves,
  reviewOrigin,
  reviewSelectHand,
  reviewSelectSquare,
  reviewTarget,
  reviewUndoBranch,
} from '../review';
import {
  bindReviewView,
  clearReviewNotice,
  leaveSharedReview,
  reviewRoomCreated,
  shareReviewMove,
  shareReviewSeek,
  shareReviewUndo,
  useReviewShareStore,
  type ReviewView,
} from '../review-share';
import { get as pluginGet } from '../../../core/plugin/registry';
import type { OnlineGameConnector } from '../../../core/plugin/gameConnector';
import type { ReviewRoomBlock, ReviewRoomRequest } from '../../../core/plugin/reviewRoom';
import { ChatConsole } from '../../../core/ui-core/ChatConsole';
import { useChatStore } from '../../../core/store/chat-store';
import { endingLabel } from './ending';
import { kifuMemoryState, loadLastKifu } from '../storage';
import type { KifuFile } from '../types';
import { kifuLabels } from './labels';

const SPEEDS = [1, 2, 0.5] as const;

/**
 * 部屋を建てられるかを通信側に聞く（付録D-12 §8）。
 * **通信機能を積んでいないビルドでは口ごと無い**ので null＝ボタンそのものを出さない。
 */
function askRoomBlock(): ReviewRoomBlock | null {
  return pluginGet<() => ReviewRoomBlock>('reviewRoom:block')?.() ?? null;
}

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
  const clearSelection = useGameStore((s) => s.clearSelection);

  /**
   * 振り返る 1 局。**入るときに決まっていて、この画面では選び直せない**（親 §9.4.1）。
   * 二人のときだけ、**ホストから配られた棋譜で差し替わる**（親 §6.3.6・入室時の 1 回）。
   */
  const [file, setFile] = useState<KifuFile | null>(() => reviewTarget());
  const [origin] = useState(() => reviewOrigin());
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
  const shared = shareRole !== null;
  /** **棋譜を配っている最中は触れない**（画面機能 §3 S11・付録D-12 §5）。 */
  const waiting = shared && !shareReady;

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
   * 部屋を建てられるか（付録D-12 §8）。**通信側の事情なので聞きに行く**。
   * つなぎ直しや入室で変わるので、通信側の変化を購読して測り直す。
   */
  const [roomBlock, setRoomBlock] = useState<ReviewRoomBlock | null>(() => askRoomBlock());
  useEffect(() => {
    const conn = pluginGet<OnlineGameConnector>('gameConnector');
    if (!conn) return;
    return conn.subscribe(() => setRoomBlock(askRoomBlock()));
  }, []);

  /** 人を呼ぶ＝**棋譜のルール名＋「の感想戦」**で建てる（付録D-12 §8）。 */
  const makeRoom = () => {
    if (!file) return;
    const create = pluginGet<(info: ReviewRoomRequest) => boolean>('reviewRoom:create');
    if (!create) return;
    const ok = create({
      gameType: (file.meta.gameType === 'hasami'
        ? 'hasami'
        : file.meta.gameType === 'shogi-custom'
          ? 'shogi-custom'
          : 'shogi') as ReviewRoomRequest['gameType'],
      torus: file.meta.torus !== 'none',
      quantum: file.meta.quantum,
      roomName: `${labels.ruleName(file)}${t('s11.roomSuffix')}`,
    });
    if (!ok) {
      setRoomBlock(askRoomBlock());
      return;
    }
    reviewRoomCreated();
    setRoomBlock(askRoomBlock());
    setToast(t('s11.roomMade'));
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
    if (target !== file) setFile(target);
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
   * どちら側から見た盤にするか。
   *
   * **二人のときは棋譜の持ち主ではなく自分の側**（親 §6.3.6）＝棋譜はホストのものが
   * 配られるので、そのまま使うとゲストの盤だけ上下が逆になる（棋譜には**書き出した
   * 人から見た向き**が入っている）。ひとりのときは従来どおり棋譜のものを使う。
   */
  const viewerSide: 'player1' | 'player2' =
    (shared ? pluginGet<OnlineGameConnector>('gameConnector')?.getMySide() : null) ??
    file?.meta.viewerSide ??
    'player1';
  const oppSide: 'player1' | 'player2' = viewerSide === 'player1' ? 'player2' : 'player1';
  const flipped = viewerSide === 'player2';

  const kindMap = useMemo(() => buildInitialKindMap(position), [position]);
  const senteHand = groupHand(position.hands.player1, mgf, kindMap);
  const goteHand = groupHand(position.hands.player2, mgf, kindMap);
  const oppHand = viewerSide === 'player1' ? goteHand : senteHand;
  const myHand = viewerSide === 'player1' ? senteHand : goteHand;
  const lastTo = position.history.length > 0 ? position.history[position.history.length - 1].to : null;

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

  /** 盤に触れたときの共通の後始末。**自動再生は止まる**（付録D-12 §5）。 */
  const touchBoard = () => {
    if (playing) setPlaying(false);
  };

  const onSquare = (row: number, col: number) => {
    setHoverSquare(`${row},${col}`);
    // **配り終えるまでは触れない**（画面機能 §3 S11）＝まだ何も並んでいないので、
    // ここで指せると、届いた瞬間に消える手を指すことになる。
    if (waiting) return;
    touchBoard();
    // 持っている駒の元の位置をもう一度押したら持ち直し（対局画面と同じ操作感）。
    if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
      clearSelection();
      return;
    }
    if ((selectedSquare || selectedHandPieceId) && isHint(row, col)) {
      tryMove({ row, col });
      return;
    }
    // **どちらの駒でも掴める**（親 §9.4）。掴めたら選択音を鳴らす。
    if (reviewSelectSquare({ row, col })) seSelect();
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

  const backLabel =
    origin === 'game' ? t('s11.backResult') : origin === 'kifu-replay' ? t('s11.backReplay') : t('s00.modeSelect');
  const goBack = () => {
    seButton();
    setScreen(origin === 'game' ? 'game' : origin === 'kifu-replay' ? 'kifu-replay' : 'lobby');
  };

  const subLocale = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  return (
    // 盤の大きさの計算は棋譜再生と同じもの（付録D-12 §1・付録D-8 v1.6 §5.1）。
    // `s11` は**この画面だけ縦に増える帯**（自由に指せる旨・補助語・保存の注記）を
    // 引くための目印で、計算そのものは 1 か所（styles.css の `.stage.s08`）にしかない。
    <div
      // `has-chat` ＝二人のときだけ出るチャット欄のぶん（v1.50）。**手数リストが盤の下へ
      // 回る狭い窓では縦に積み増しになる**ので、盤の大きさの計算から引く厚みを増やす
      // （付録D-8 §5.1＝置くものを全部引いた残りを割る。引き忘れるとスクロールする）。
      className={`stage s08 s11${shared ? ' has-chat' : ''}`}
      style={
        {
          '--board-cols': mgf.board.width,
          '--board-rows': mgf.board.height,
        } as CSSProperties
      }
    >
      <div className="grid">
        <div className="main-col">
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
              <HeaderCommonRight />
            </div>
          </header>

          {/* ツールバー（付録D-12 §3）。**戻るは入ってきた画面へ**＝部屋の中で始めた
              感想戦は、結果へ戻れないと部屋から出てしまう（S08 とは扱いを分ける）。 */}
          <div className="s08-toolbar">
            <button type="button" className="back-btn" onClick={goBack}>
              {origin === 'lobby' && (
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
              )}
              {backLabel}
            </button>
            {/* 画面名バッジ＝対局画面と見た目が近いので、どちらに居るかを常に出す。 */}
            <span className="screen-badge">{t('s11.title')}</span>
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
            {/* 人を呼ぶ（付録D-12 §8）。**ひとりのときだけ**出す。**建てられないときは
                不活性にして理由を添える**＝灰色は「押せない」しか意味しないので、
                待てば直るのか自分の事情なのかが分からなくなる。 */}
            {!shared && roomBlock !== null && (
              <span className="make-room">
                <button
                  type="button"
                  className="io-btn"
                  disabled={roomBlock !== 'ok' || !file}
                  onClick={() => {
                    seButton();
                    makeRoom();
                  }}
                >
                  {t('s11.makeRoom')}
                </button>
                {roomBlock !== 'ok' && (
                  <span className="why">{t(`s11.makeRoom.${roomBlock}`)}</span>
                )}
              </span>
            )}
          </div>

          <div className="pinfo opp">
            <span className="nm">{file ? labels.playerLabel(file, oppSide) : t('player.opp')}</span>
          </div>

          {/* 盤・駒台は対局画面の部品をそのまま借りる。**時計・手番の縁取りは出さない**
              （勝敗も持ち時間も無いため）が、**移動先ヒントは出す**＝指せる場所を
              確かめる画面なので（付録D-12 §4）。 */}
          <div className="broadcast">
            <PieceStandView
              side="opp"
              pieces={oppHand}
              onClick={(pid) => onHand(oppSide, pid)}
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
          </div>

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
            <div className="free-note">{waiting ? t('s11.receiving') : t('s11.free')}</div>
          </div>

          {/* 保存行（付録D-12 §9）。**出るのは満額の本譜**で、分岐は入らない。 */}
          <div className="io-bar">
            <button type="button" className="io-btn" disabled={waiting || !file || saving} onClick={() => { seButton(); save(); }}>
              {t('result.saveKifu')}
            </button>
            {saved && <span className="saved-tag">✓</span>}
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
            <div className="io-note">{branch > 0 ? t('s11.saveNote') : ''}</div>
          </div>
        </div>

        {/* 手数リスト＝固定 3 行ボックス（付録D-8 §6）。**分岐だけ S11 で足す**。 */}
        <div className="moves-col">
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
          {/* チャット（付録D-12 §2・画面機能 v0.40 §3 S11）。**ひとりのときは出さない**
              ＝相手が居ないので置く意味が無い。中身は対局画面と同じ部品をそのまま借りる。 */}
          {shared && <ChatConsole t={t} />}
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
