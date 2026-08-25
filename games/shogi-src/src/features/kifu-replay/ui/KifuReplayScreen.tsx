import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFitHeight } from '../../../core/ui-core/useFitHeight';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useGameStore } from '../../../core/store/game-store';
import { useRouteStore } from '../../../core/store/route-store';
import { requestKifuLoad } from '../../../core/store/kifu-guard';
import { t as _t } from '../../../core/i18n';
import { buildInitialKindMap, displayKindsFor, moveLandingSquare } from '../../../core/engine';
import { useQuantumCycle } from '../../../core/ui-core/quantum-cycle';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import {
  CandidateBox,
  PieceStandView,
  PieceView,
  groupHand,
} from '../../../core/ui-core/GameScreen';
import { seButton } from '../../../core/audio/se-synth';
import { adoptLoadedKifu, listFolderKifu, saveKifuFile } from '../index';
import { canUseFolder, chooseFolder, rememberedFolder, usableFolder, type FsDirHandle } from '../folder';
import { readKifuFile } from '../io';
import { asReplay, replayKifu, resolveCustomRuleForOpen, type CustomRuleRef, type OpenedRule } from '../replay';
import { CustomRulePrompt } from './CustomRulePrompt';
import { setReviewTarget } from '../review';
import { endingLabel } from './ending';
import {
  kifuMemoryState,
  lastKifuIsOwnGame,
  loadLastKifu,
  type KifuMemoryState,
} from '../storage';
import type { KifuFile } from '../types';
import { KifuListModal } from './KifuListModal';
import { kifuLabels } from './labels';

const SPEEDS = [1, 2, 0.5] as const;

/**
 * 棋譜再生画面 (S08)。機能の正典＝画面機能 v0.31 §3 S08・絵柄＝付録D-8 v1.3。
 *
 * **再生＝記録された手を初手から並べ直す**（replay.ts）。局面の絵は棋譜に入っていないので、
 * 何手目を見るときも初期配置から並べ直す。対局とまったく同じ経路を通すので、
 * 「書き出した棋譜が元どおりになるか」がそのまま確かめられる。
 *
 * **★盤は記録から作るだけで、盤から記録を作り直さない**（2026-08-16 ユーザー判断）。
 * 途中まで戻して見ている間、盤にはそこまでの手しか載っていないため。
 *
 * **★再生は破棄の契機ではない**（親 §9.2.3 ②）＝記憶には触らない。触るのは
 * 棋譜の読み込みのときだけで、そこは確認をはさむ。
 */
export function KifuReplayScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const mgf = useGameStore((s) => s.mgf);
  const position = useGameStore((s) => s.position);
  /** 未確定駒の見せ方（巡回／重ね）。S08 は購読するだけで切替 UI は持たない。 */
  const quantumDisplay = useGameStore((s) => s.quantumDisplay);

  /**
   * ★段2b: **開いた瞬間に出す 1 局も、選び直したときと同じ取り戻しを通す**（§9.2.6）。
   *
   * ここを通していなかったので、**記憶している 1 局のカスタムルールが取り戻せないとき、
   * パネルも出さずに黙って本将棋へ化けていた**（2026-08-25 実測）＝段2a が消したはずの
   * 症状が、この入口にだけ残っていた。**取り戻しを必要とする入口を数え上げるのではなく、
   * 棋譜を出す前に必ず通る形**にして塞ぐ（[[reference_guard_where_forgetting_is_cheap]]）。
   *
   * 取り戻せないときは**盤に出さない**（`file` を持たせない）＝出してしまうと、パネルを
   * やめたときに**間違ったルールで並んだ盤が残る**。棋譜そのものは一覧に残るので、
   * 選び直せば同じパネルがもう一度出る。
   *
   * **1 回だけ読む**＝記憶は読むたびに別の入れ物になるので、受け皿・盤・待ちの 3 つが
   * 同じ 1 局を指すように、ここで読んだものを配る（向きの判定が同一性を見ている）。
   */
  const [initial] = useState<{
    remembered: KifuFile | null;
    file: KifuFile | null;
    rule: OpenedRule;
    pending: { next: KifuFile; ref: CustomRuleRef } | null;
  }>(() => {
    const first = loadLastKifu();
    if (!first) return { remembered: null, file: null, rule: {}, pending: null };
    const r = resolveCustomRuleForOpen(first);
    if (r.kind === 'needsFile') {
      return { remembered: first, file: null, rule: {}, pending: { next: first, ref: r.ref } };
    }
    return {
      remembered: first,
      file: first,
      rule: { mgf: r.kind === 'resolved' ? r.mgf : undefined },
      pending: null,
    };
  });

  // 開いた時点の記憶を受け皿として持つ（S07 から来たときは直前の対局がここに居る）。
  const [remembered, setRemembered] = useState<KifuFile | null>(initial.remembered);
  const [memoryState, setMemoryState] = useState<KifuMemoryState>(() => kifuMemoryState());
  const [file, setFile] = useState<KifuFile | null>(initial.file);
  /**
   * ★v1.57: **いま出している 1 局が、自分が指した対局から来たものか**（親 §9.2.5）。
   * **盤の向きがこれで決まる**。最初に出るのは記憶している 1 局なので、その出どころを継ぐ。
   */
  const [ownGame, setOwnGame] = useState<boolean>(() => lastKifuIsOwnGame());
  /**
   * ★v1.58: **見ている人が上下を入れ替えたか**（親 §9.2.5.1・**S11 と同じ規定**
   * ＝2 つの画面で違う理屈を持たない）。**画面に持たせる**＝画面より長生きさせない。
   */
  const [flipView, setFlipView] = useState(false);
  /**
   * ★v1.58: **向きが決まり直したら、入れ替えは解ける**（親 §9.2.5.1）。
   * **解く場所を数え上げない**＝棋譜が差し替わる入口は複数ある（一覧・フォルダ・
   * 書類ピッカー）ので、**向きを決めている材料そのものを見張る**。
   */
  useEffect(() => setFlipView(false), [file, ownGame]);
  const [ply, setPly] = useState(0);
  /**
   * ★段2: **開く工程で用意したルール**（§9.2.6）。ファイル選択で読んだ定義など、
   * 同期の取り戻しでは引けないものをここに載せ、並べ直しに渡す。
   * ★段2c: **「食い違ったまま進める」かどうかも同じ入れ物で運ぶ**＝定義と一緒にしか
   * 決まらないので、片方だけ書き換わることが起きない。
   */
  const [openedRule, setOpenedRule] = useState<OpenedRule>(initial.rule);
  /**
   * ★段2: **定義が取り戻せず、ファイル選択を待っている棋譜**（§9.2.6 ②）。null 以外の
   * 間はパネルを出し、選べたら開く・やめたら開かない。
   */
  const [pendingRule, setPendingRule] = useState<{ next: KifuFile; ref: CustomRuleRef } | null>(
    initial.pending,
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [listOpen, setListOpen] = useState(false);
  /** この画面で読み込んだぶん。画面を離れると空に戻る（ファイル自体は端末に残る）。 */
  const [loaded, setLoaded] = useState<KifuFile[]>([]);
  /**
   * 指定してある保存先フォルダ（親 §9.2.3 ④）。**名前を出すだけなら許可は要らない**ので、
   * 画面に入った時点で控えだけ読む＝勝手に許可を尋ねない。
   */
  const [folder, setFolder] = useState<FsDirHandle | null>(null);
  /** そのフォルダの中の棋譜。一覧を開いたときに読む（索引は持たない・§9.2.1）。 */
  const [folderFiles, setFolderFiles] = useState<KifuFile[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** 候補ボックスを出しているマス（駒UI §4.5・盤の駒も駒台と同じに開く）。 */
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  const labels = kifuLabels(locale);
  const moveCount = file ? file.moves.length : 0;

  // 盤を「いま何手目まで」に合わせる。手が増減したときもここだけで揃う。
  //
  // **v1.42: 棋譜が無いときは初期配置に戻す**（付録D-8 §3.1）。盤は対局画面と同じ物を
  // 使っているので、何も並べ直さないと**直前の対局の終局図がそのまま残る**＝再生して
  // いないのに終局図が出ていると、その棋譜を開いていると誤読する。
  // **「再生」と名乗って触る**ので、記憶には触れないし、破棄も走らない。
  useEffect(() => {
    if (file) {
      // ★段2: 開く工程で用意したルール (openedRule) を渡す (§9.2.6)。組み込みルールと
      // 公式一覧にあるチェスは空のままでも replayKifu の中で取り戻せる。
      replayKifu(file, ply, openedRule);
      return;
    }
    asReplay(() => useGameStore.getState().reset());
  }, [file, ply, openedRule]);

  /**
   * 量子の巡回表示の時計（付録D-8 §10.1）。
   *
   * **再生の状態に関わらず動き続ける**＝巡回は「この駒はまだ決まっていない」ことを
   * 示す表示であって、再生が進んでいるかどうかとは関係がない。止めると確定した駒と
   * 見分けが付かなくなる（v1.41 は時計そのものが無く、最初から止まって見えていた）。
   */
  const [cycleTick, setCycleTick] = useState(0);
  useEffect(() => {
    if (quantumDisplay !== 'cycle') return;
    const id = setInterval(() => setCycleTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [quantumDisplay]);
  // v1.45: 「いま出している字の次」へ送る（付録D-1 §5.6.2・駒UI §4.2）。
  // v1.44 までは「候補の何番目か」で選んでいたため、**候補が減った拍子に前と同じ字**を
  // 指すことがあり、その駒だけ止まって見えた。自動再生は 1 秒ごとに手が進んで候補が
  // 減るので、巡回の切り替えと同じ間隔でこれが起きていた（2026-08-17 ユーザー報告）。
  const cycle = useQuantumCycle(cycleTick, quantumDisplay === 'cycle');

  /**
   * **入る前の盤を丸ごと控えておき、離れるときに戻す**。
   *
   * 再生は盤を作り直すので、そのまま出ていくと対局画面が指し掛けに見える。
   * 「最後まで並べ直す」だけでは足りない＝**投了や時間切れは手ではないので棋譜に無く**、
   * 並べ直しても終局に戻らない（結果の画面が出ず、対 AI では相手が指し始めてしまう）。
   *
   * 戻すときは「本物の対局ではない」と名乗る。名乗らないと、終局へ戻ったことを
   * 新しい終局と取り違えて、**盤から作り直した棋譜が記憶を上書きする**。
   */
  const boardBeforeRef = useRef(useGameStore.getState());
  useEffect(
    () => () => {
      asReplay(() => useGameStore.setState(boardBeforeRef.current, true));
    },
    [],
  );

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

  // 指定済みのフォルダを控えから読む。**許可は尋ねない**（名前を出すだけなら要らない）。
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
   * フォルダの中身を読み直す。**索引を持たないので毎回読む**（親 §9.2.1）。
   *
   * `ask` で尋ねてよい範囲を分ける＝**一覧を開いただけでフォルダを選ばせない**
   * （押していないのに選ぶ画面が出るのは、書類ピッカーを勝手に開くのと同じ驚き）。
   */
  const refreshFolder = async (ask: 'silent' | 'permission') => {
    if (!canUseFolder()) return;
    setFolderBusy(true);
    try {
      const dir = await usableFolder(ask);
      if (!dir) return;
      setFolder(dir);
      setFolderFiles(await listFolderKifu(dir));
    } finally {
      setFolderBusy(false);
    }
  };

  /** 「別のフォルダを選ぶ」。**やめたときは今のフォルダをそのまま残す**（親 §9.2.3 ④）。 */
  const changeFolder = async () => {
    setFolderBusy(true);
    try {
      const dir = await chooseFolder();
      if (!dir) return;
      setFolder(dir);
      setFolderFiles(await listFolderKifu(dir));
    } finally {
      setFolderBusy(false);
    }
  };

  /**
   * ★v1.57: どちら側から見た盤にするか。**棋譜の出どころで決まる**（親 §9.2.5）。
   *
   * - **いま自分が指した対局**（記憶している 1 局）＝**自分の側が手前**。
   * - **外から読み込んだ棋譜**（一覧・フォルダ・書類ピッカー）＝**先手が下**。
   *
   * v1.56 までは棋譜が持つ向きをそのまま使っていたが、そこに入っているのは
   * **書き出した人から見た向き**なので、**他人の棋譜を読み込むと、自分が指しても
   * いない対局が後手から見た盤で出る**ことがあった。**読み込んだ棋譜には「自分」が
   * 居ない**ので、将棋の既定の向きに倒す。**感想戦 (S11) とまったく同じ規定**。
   */
  const defaultSide: 'player1' | 'player2' = ownGame
    ? (file?.meta.viewerSide ?? 'player1')
    : 'player1';
  /**
   * ★v1.58: **見ている人が入れ替えたぶんを重ねる**（親 §9.2.5.1・**S11 と同じ**）。
   * 上で決まるのは**既定の向き**であり、**既定が常に望みどおりとは限らない**ので、
   * **人が自分で直せる出口を 1 つ置く**。
   */
  const viewerSide: 'player1' | 'player2' = flipView
    ? defaultSide === 'player1'
      ? 'player2'
      : 'player1'
    : defaultSide;
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

  const jump = (n: number) => setPly(Math.max(0, Math.min(moveCount, n)));

  /** 取り戻しが済んだ棋譜を実際に開く。**記憶には触らない**（再生は破棄の契機ではない）。 */
  const applyOpen = (next: KifuFile, rule: OpenedRule) => {
    setPlaying(false);
    setOpenedRule(rule);
    setFile(next);
    // ★v1.57: **記憶している 1 局を選び直したときだけ「自分の対局」**（親 §9.2.5）。
    // 一覧・フォルダ・書類ピッカーから来たものは外の棋譜なので、盤は先手が下。
    setOwnGame(next === remembered && lastKifuIsOwnGame());
    setPly(0);
    setListOpen(false);
    setToast(t('s08.loaded'));
  };

  /**
   * 棋譜を選び直す。**開く前にカスタムルールの定義を取り戻す**（§9.2.6）。
   * 公式・手元で取り戻せればそのまま開き、無ければファイル選択のパネルを出す（段2）。
   */
  const pick = (next: KifuFile) => {
    const r = resolveCustomRuleForOpen(next);
    if (r.kind === 'needsFile') {
      setListOpen(false);
      setPendingRule({ next, ref: r.ref });
      return;
    }
    applyOpen(next, { mgf: r.kind === 'resolved' ? r.mgf : undefined });
  };

  /**
   * 書類ピッカーを開く。**開く前に確認を通す**（親 §9.2.3 ②・画面機能 §3 S08）。
   * 未保存の棋譜があれば「保存する／破棄する／やめる」が先に出る。
   */
  const requestPicker = () => {
    requestKifuLoad(() => {
      setRemembered(null);
      setMemoryState('empty');
      pickerRef.current?.click();
    });
  };

  const onPicked = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    try {
      const next = await readKifuFile(chosen);
      // 読み込めた時点でファイルは存在するので、記憶の印は最初から「保存済み」。
      adoptLoadedKifu(next);
      setRemembered(next);
      setMemoryState(kifuMemoryState());
      setLoaded((cur) => [next, ...cur]);
      pick(next);
    } catch {
      // 棋譜でないものを選んでも画面は壊さない（io.ts が読む前に弾いている）。
      setToast(t('s08.loadFailed'));
    }
  };

  /**
   * 書き出し。**記録をそのまま書く**（盤から組み立て直さない）。
   *
   * フォルダを扱える環境では、ここが**フォルダを 1 度だけ選んでもらう場所**になる
   * （親 §9.2.3 ④）。選ぶのをやめられたら**何も書かない**＝ダウンロードへは落とさない。
   */
  const save = (target: KifuFile) => {
    setSaving(true);
    void saveKifuFile(target)
      .then(async (outcome) => {
        setMemoryState(kifuMemoryState());
        // **v1.42: 保存できたときはここで何も出さない**＝本人が閉じるまで残る知らせを
        // 書き出し側が出す（付録D-8 §8・自動で消える表示だと見逃す）。
        // **やめた・書けなかったは自動で消えてよい**＝何も起きていないことは画面から
        // 読み取れる。**その 2 つは別の言葉にする**（やめていない人に「やめました」と
        // 言わない＝確かめられた場合だけ断定する）。
        if (outcome !== 'saved') {
          setToast(t(outcome === 'cancelled' ? 's08.saveCancelled' : 's08.saveFailed'));
        }
        // 初回はここでフォルダが決まる。書けたぶんを一覧へ映すため読み直す。
        if (outcome === 'saved') await refreshFolder('silent');
      })
      .finally(() => setSaving(false));
  };

  // ★v1.60: 盤以外に置くものの高さを毎回測って CSS へ返す（付録D-8 v1.10 §5.1）。
  const fitRef = useRef<HTMLDivElement>(null);
  useFitHeight(fitRef);

  const subLocale = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  return (
    // v1.42: `s08` を付けて、この画面だけ盤の大きさを窓の高さにも合わせる
    // （付録D-8 §5「ヘッダから再生の操作帯までが 1 画面に収まること」）。
    // v1.44: **盤の縦横をルール定義から流す**（付録D-1 §4.2.1）＝マスの大きさ・
    // 駒台の高さ・盤のグリッドがこの値から決まる。**9 を書かない**ので、
    // 将来 9x9 以外の盤ができても計算がそのまま追随する。
    <div
      ref={fitRef}
      className="stage s08"
      style={
        {
          '--board-cols': mgf.board.width,
          '--board-rows': mgf.board.height,
        } as CSSProperties
      }
    >
      {/* ★v1.58: **見出しと操作の行は列の外へ出す**（付録D-8 v1.7 §2・ユーザー判断
          2026-08-20）＝**S11 で v1.57 に入れたのとまったく同じ直し**。

          列の幅は「その中でいちばん幅を要るもの」で決まるので、**棋譜の情報を載せた
          この行が盤より幅を要ると、列の幅を決めるのが盤ではなくこの行**になる。
          実測（本番ビルド・1 マス 35px）＝**窓幅 960px で横に 39px はみ出す**
          （v1.57 以前も 900px で 23px はみ出していた＝**前からある不具合**）。

          列の外へ出すと**列の幅は盤の側だけで決まり**、あわせて**右の列（手数リスト）が
          盤と同じ高さから始まる**（S11 と同じ形）。 */}
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

      {/* ツールバー：戻る＋棋譜の素性＋棋譜一覧（付録D-8 §3）。
          **一覧ボタンを押しただけでは書類ピッカーを開かない**。 */}
      <div className="s08-toolbar">
        {/* v1.42: **どこから来ても行き先は同じ**（付録D-8 §3・画面機能 §3 S08）。
            v1.41 は終局パネルから来たとき「結果へ」で対局画面へ戻していたが、
            **別の棋譜を見ている最中に押すと、いま見ている棋譜と無関係な
            直前の対局の結果**が出ていた＝画面に出ているものと押した先が食い違う。
            表示も他画面と同じ「家アイコン＋モード選択」に揃える。 */}
        <button
          type="button"
          className="back-btn"
          onClick={() => {
            seButton();
            setScreen('lobby');
          }}
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
          {t('s00.modeSelect')}
        </button>
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
            <span className="who">{t('s08.noKifu')}</span>
          )}
        </div>
        {/* ★v1.58: **盤を反転**（親 §9.2.5.1・付録D-8 v1.7 §3）。
            **棋譜が無いときも押せる**＝初期配置でも向きは意味を持つ。 */}
        <button
          type="button"
          className={`io-btn${flipView ? ' on' : ''}`}
          aria-pressed={flipView}
          onClick={() => {
            seButton();
            setFlipView((v) => !v);
          }}
        >
          {t('replay.flipBoard')}
        </button>
        {/* v1.46: **この棋譜で感想戦**（画面機能 v0.37 §3 S08・意味論＝親 §9.4）。
            **いま開いている棋譜**で S11 へ入る＝選び直させない。**棋譜が無いときは
            押せない**（感想戦は振り返る 1 局が決まっていることが前提）。
            **記憶には触らない**ので確認は出ない。 */}
        <button
          type="button"
          className="io-btn"
          disabled={!file}
          onClick={() => {
            seButton();
            setPlaying(false);
            if (file) {
              // ★v1.57: 出どころも一緒に渡す（親 §9.2.5）＝盤の向きは
              // 感想戦でも同じ規定で決まるので、ここで決め直させない。
              setReviewTarget(file, 'kifu-replay', ownGame);
              setScreen('review');
            }
          }}
        >
          {t('s08.review')}
        </button>
        <button
          type="button"
          className="pick-btn"
          onClick={() => {
            seButton();
            setPlaying(false);
            setListOpen(true);
            // フォルダを指定してあれば、その中身を一覧に出す（画面機能 §3 S08）。
            // **許可までしか尋ねない**＝ここでフォルダを選ばせはしない。
            void refreshFolder('permission');
          }}
        >
          {t('s08.list')}
        </button>
      </div>

      <div className="grid">
        <div className="main-col">

          <div className="pinfo opp">
            {/* v1.43: **どちらが先手か名前だけでは分からない**（ネット対戦では下が自分とも
                限らない）ので、印と「先手／後手」を名前の前に置く。 */}
            <span className="nm">{file ? labels.playerLabel(file, oppSide) : t('player.opp')}</span>
          </div>

          {/* 盤・駒台は対局画面の部品をそのまま借りる（付録D-8 §1「発明し直さない」）。
              時計・手番の縁取り・行き先ヒントは付けない＝閲覧のための画面なので。 */}
          <div className="broadcast">
            <PieceStandView
              mgf={mgf}
              side="opp"
              pieces={oppHand}
              onClick={() => {}}
              selectedId={null}
              activePlayer={false}
              locale={locale}
              label={oppSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl')}
              mode={quantumDisplay}
              cycle={cycle}
            />
            <div className={`board-with-coords${flipped ? ' flipped' : ''}`}>
              <div className="board-outer">
                <div className="col-coords">
                  {((): string[] => {
                    const W = position.width;
                    const labels =
                      mgf.board.coordinate === 'chess'
                        ? Array.from({ length: W }, (_, c) => String.fromCharCode(97 + c))
                        : Array.from({ length: W }, (_, c) => String(W - c));
                    return flipped ? [...labels].reverse() : labels;
                  })().map((s, i) => (
                    <span key={i}>{s}</span>
                  ))}
                </div>
                <div className={`row-coords${locale === 'en' ? ' en' : ''}`}>
                  {((): string[] => {
                    const H = position.height;
                    const kanji = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
                    const labels =
                      mgf.board.coordinate === 'chess'
                        ? Array.from({ length: H }, (_, r) => String(H - r))
                        : Array.from({ length: H }, (_, r) =>
                            locale === 'en' ? String(r + 1) : kanji[r] ?? String(r + 1),
                          );
                    return flipped ? [...labels].reverse() : labels;
                  })().map((s, i) => (
                    <span key={i}>{s}</span>
                  ))}
                </div>
                <div className="board" aria-label={t('s07.boardAria')}>
                  {mgf.board.coordinate !== 'chess' && (
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
                  )}
                  {Array.from({ length: position.width * position.height }).map((_, i) => {
                    const visualRow = Math.floor(i / position.width);
                    const visualCol = i % position.width;
                    const row = flipped ? position.height - 1 - visualRow : visualRow;
                    const col = flipped ? position.width - 1 - visualCol : visualCol;
                    const piece = position.board[row][col];
                    const kinds = piece ? displayKindsFor(mgf, piece, kindMap) : [];
                    // 直前に**再生した**手の着地マス（付録D-8 §1）。
                    const isLast = lastTo?.row === row && lastTo?.col === col;
                    const hovered = hoverSquare === `${row},${col}`;
                    const edge = `${visualCol === position.width - 1 ? ' edge-r' : ''}${visualRow === position.height - 1 ? ' edge-b' : ''}`;
                    return (
                      <div
                        key={i}
                        className={`sq${isLast ? ' lastmove' : ''}${edge}`}
                        onMouseEnter={() => setHoverSquare(`${row},${col}`)}
                        onMouseLeave={() =>
                          setHoverSquare((cur) => (cur === `${row},${col}` ? null : cur))
                        }
                        onClick={() => setHoverSquare(`${row},${col}`)}
                      >
                        {piece && (
                          <PieceView
                            mgf={mgf}
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
                        {/* v1.42: **盤の駒でも駒台の駒でも同じに開く**（駒UI v0.11 §4.5）。
                            v1.41 は駒台にだけこの仕組みがあり、盤の駒に乗せても何も出なかった。
                            候補は両者に等しく見えている公開情報なので、読める駒を限定しない。 */}
                        {piece && kinds.length >= 2 && hovered && (
                          <CandidateBox
                            mgf={mgf}
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
              mgf={mgf}
              side="you"
              pieces={myHand}
              onClick={() => {}}
              selectedId={null}
              activePlayer={false}
              locale={locale}
              label={viewerSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl')}
              mode={quantumDisplay}
              cycle={cycle}
            />
          </div>

          <div className="pinfo you">
            <span className="nm">{file ? labels.playerLabel(file, viewerSide) : t('player.you')}</span>
          </div>

          {/* 再生コントロール帯（付録D-8 §5）。棋譜が無いときは全部押せない。 */}
          <div className="playbar">
            <div className="btns">
              <button type="button" className="pb" disabled={ply === 0} onClick={() => jump(0)}>
                |◀
              </button>
              <button type="button" className="pb" disabled={ply === 0} onClick={() => jump(ply - 1)}>
                ◀
              </button>
              <button
                type="button"
                className={`pb auto${playing ? ' playing' : ''}`}
                disabled={!file || moveCount === 0}
                onClick={() => {
                  if (playing) {
                    setPlaying(false);
                    return;
                  }
                  // 末尾から始めたら先頭へ巻き戻す（付録D-8 §5）。
                  if (ply >= moveCount) setPly(0);
                  setPlaying(true);
                }}
              >
                {playing ? `⏸ ${t('s08.stop')}` : `▶ ${t('s08.auto')}`}
              </button>
              <button
                type="button"
                className="pb spd"
                onClick={() => setSpeed((cur) => SPEEDS[(SPEEDS.indexOf(cur as 1) + 1) % SPEEDS.length])}
              >
                {speed === 0.5 ? '0.5×' : `${speed}×`}
              </button>
              <button
                type="button"
                className="pb"
                disabled={ply >= moveCount}
                onClick={() => jump(ply + 1)}
              >
                ▶
              </button>
              <button
                type="button"
                className="pb"
                disabled={ply >= moveCount}
                onClick={() => jump(moveCount)}
              >
                ▶|
              </button>
            </div>
            <div className="track">
              <input
                type="range"
                min={0}
                max={Math.max(moveCount, 1)}
                value={ply}
                disabled={!file || moveCount === 0}
                onChange={(e) => {
                  setPlaying(false);
                  jump(Number(e.target.value));
                }}
              />
              <span className="plycnt">
                {ply} / {moveCount}
              </span>
            </div>
          </div>

          {/* 書き出し（付録D-8 §8）。今版は独自JSON だけ＝他形式は未実装なので置かない。 */}
          <div className="io-bar">
            <button
              type="button"
              className="io-btn"
              disabled={!file || saving}
              onClick={() => {
                seButton();
                if (file) save(file);
              }}
            >
              {t('result.saveKifu')}
            </button>
            {/* 保存先（付録D-8 v1.3 §8）。**指定なしのときは何も出さない**
                ＝環境の制約を説明文で見せない。押すと選び直せる（§9.2.3 ④）。 */}
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
          </div>
        </div>

        {/* 手数リスト＝固定 3 行ボックス（付録D-8 §6）。行を押すとその局面へ飛ぶ。 */}
        <div className="moves-col">
          <div className="panel">
            <div className="panel-label">
              <span>{t('s08.moves')}</span>
            </div>
            <MoveList
              file={file}
              ply={ply}
              onJump={(n) => {
                setPlaying(false);
                jump(n);
              }}
              startLabel={t('s08.start')}
              ending={endingLabel(file?.meta.result, locale)}
            />
          </div>
        </div>
      </div>

      {listOpen && (
        <KifuListModal
          locale={locale}
          remembered={remembered}
          rememberedState={memoryState}
          loaded={loaded}
          folderName={folder ? folder.name : null}
          folderFiles={folderFiles}
          folderBusy={folderBusy}
          onChangeFolder={() => void changeFolder()}
          onPick={pick}
          onRequestLoad={requestPicker}
          onSave={save}
          saving={saving}
          onClose={() => setListOpen(false)}
        />
      )}

      {/* 書類ピッカー。**押されるまで開かない**（画面機能 §3 S08）。 */}
      <input
        ref={pickerRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => void onPicked(e.currentTarget)}
      />

      {/* ★段2: カスタムルールの定義が取り戻せないとき、ファイルを選んでもらう（§9.2.6 ②）。 */}
      {pendingRule && (
        <CustomRulePrompt
          locale={locale}
          kifuRef={pendingRule.ref}
          onChoose={(mgf, mismatched) => {
            const next = pendingRule.next;
            setPendingRule(null);
            // ★段2c: **食い違ったまま「そのまま進める」を選んだら、違反を無視して並べる**
            // （§9.2.6 ④）。一致していれば従来どおり（指せない手が出たら止まる）。
            applyOpen(next, { mgf, ignoreViolations: mismatched });
          }}
          onCancel={() => setPendingRule(null)}
        />
      )}

      {toast && <div className="s08-toast">{toast}</div>}
    </div>
  );
}

/**
 * 手数リスト。**高さを変えない**ので、現在の手が自動で見える位置に入るようにする
 * （付録D-8 §6）。表記は棋譜に記録された文字をそのまま出す＝再生のたびに作り直さない。
 */
function MoveList({
  file,
  ply,
  onJump,
  startLabel,
  ending,
}: {
  file: KifuFile | null;
  ply: number;
  onJump: (n: number) => void;
  startLabel: string;
  /**
   * 終局の一言（付録D-8 §6・親 §9.2.4）。**最後の手と同じ行に添える**＝
   * 終局は手ではないので行を増やさない（増やすと手数と「n / N」が食い違う）。
   * 終局の記録を持たない古い棋譜では null。
   */
  ending: string | null;
}) {
  const curRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * ★v1.62 (2026-08-22 実機のご報告): **動かすのは手数リストの箱の中だけ**。
   * `scrollIntoView` は**入れ子の外側もページごと巻き取る**ので、**携帯（縦長）では
   * ページが下へスクロールして盤が画面から消える**。**S11 と同じ直しをここにも入れる**
   * （**同じ仕掛けを 2 か所で違う形にしない**）。
   */
  useEffect(() => {
    const cur = curRef.current;
    const box = listRef.current;
    if (!cur || !box) return;
    const top = cur.offsetTop - box.offsetTop;
    const bottom = top + cur.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [ply, file]);

  const texts = file?.moveTexts ?? [];
  const count = file?.moves.length ?? 0;

  return (
    <div className="mv-list" ref={listRef}>
      <button
        type="button"
        ref={ply === 0 ? curRef : undefined}
        className={`mv start${ply === 0 ? ' cur' : ''}`}
        onClick={() => onJump(0)}
      >
        <span className="no">0</span>
        <span className="nt">{startLabel}</span>
        {/* 手が 1 つも無い棋譜（開始直後の投了など）は、ここが唯一の行になる。 */}
        {ending && count === 0 && <span className="end-badge">{ending}</span>}
      </button>
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          type="button"
          ref={ply === i + 1 ? curRef : undefined}
          className={`mv${ply === i + 1 ? ' cur' : ''}`}
          onClick={() => onJump(i + 1)}
        >
          <span className="no">{i + 1}</span>
          <span className="nt">{texts[i] ?? ''}</span>
          {ending && i === count - 1 && <span className="end-badge">{ending}</span>}
        </button>
      ))}
    </div>
  );
}
