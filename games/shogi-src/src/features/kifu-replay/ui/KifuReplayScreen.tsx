import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useGameStore } from '../../../core/store/game-store';
import { useRouteStore } from '../../../core/store/route-store';
import { requestKifuLoad } from '../../../core/store/kifu-guard';
import { t as _t } from '../../../core/i18n';
import { buildInitialKindMap, displayKindsFor } from '../../../core/engine';
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
import { asReplay, replayKifu } from '../replay';
import { endingLabel } from './ending';
import { kifuMemoryState, loadLastKifu, type KifuMemoryState } from '../storage';
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

  // 開いた時点の記憶を受け皿として持つ（S07 から来たときは直前の対局がここに居る）。
  const [remembered, setRemembered] = useState<KifuFile | null>(() => loadLastKifu());
  const [memoryState, setMemoryState] = useState<KifuMemoryState>(() => kifuMemoryState());
  const [file, setFile] = useState<KifuFile | null>(() => loadLastKifu());
  const [ply, setPly] = useState(0);
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
      replayKifu(file, ply);
      return;
    }
    asReplay(() => useGameStore.getState().reset());
  }, [file, ply]);

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

  const viewerSide: 'player1' | 'player2' = file?.meta.viewerSide ?? 'player1';
  const oppSide: 'player1' | 'player2' = viewerSide === 'player1' ? 'player2' : 'player1';
  const flipped = viewerSide === 'player2';

  const kindMap = useMemo(() => buildInitialKindMap(position), [position]);
  const senteHand = groupHand(position.hands.player1, mgf, kindMap);
  const goteHand = groupHand(position.hands.player2, mgf, kindMap);
  const oppHand = viewerSide === 'player1' ? goteHand : senteHand;
  const myHand = viewerSide === 'player1' ? senteHand : goteHand;
  const lastTo = position.history.length > 0 ? position.history[position.history.length - 1].to : null;

  const jump = (n: number) => setPly(Math.max(0, Math.min(moveCount, n)));

  /** 棋譜を選び直す。**記憶には触らない**（再生は破棄の契機ではない）。 */
  const pick = (next: KifuFile) => {
    setPlaying(false);
    setFile(next);
    setPly(0);
    setListOpen(false);
    setToast(t('s08.loaded'));
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

  const subLocale = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  return (
    // v1.42: `s08` を付けて、この画面だけ盤の大きさを窓の高さにも合わせる
    // （付録D-8 §5「ヘッダから再生の操作帯までが 1 画面に収まること」）。
    <div className="stage s08">
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

          <div className="pinfo opp">
            {/* v1.43: **どちらが先手か名前だけでは分からない**（ネット対戦では下が自分とも
                限らない）ので、印と「先手／後手」を名前の前に置く。 */}
            <span className="nm">{file ? labels.playerLabel(file, oppSide) : t('player.opp')}</span>
          </div>

          {/* 盤・駒台は対局画面の部品をそのまま借りる（付録D-8 §1「発明し直さない」）。
              時計・手番の縁取り・行き先ヒントは付けない＝閲覧のための画面なので。 */}
          <div className="broadcast">
            <PieceStandView
              side="opp"
              pieces={oppHand}
              onClick={() => {}}
              selectedId={null}
              activePlayer={false}
              locale={locale}
              label={oppSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl')}
              mode={quantumDisplay}
              tick={cycleTick}
            />
            <div className={`board-with-coords${flipped ? ' flipped' : ''}`}>
              <div className="board-outer">
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
                    const row = flipped ? 8 - Math.floor(i / 9) : Math.floor(i / 9);
                    const col = flipped ? 8 - (i % 9) : i % 9;
                    const visualRow = Math.floor(i / 9);
                    const visualCol = i % 9;
                    const piece = position.board[row][col];
                    const kinds = piece ? displayKindsFor(mgf, piece, kindMap) : [];
                    // 直前に**再生した**手の着地マス（付録D-8 §1）。
                    const isLast = lastTo?.row === row && lastTo?.col === col;
                    const hovered = hoverSquare === `${row},${col}`;
                    return (
                      <div
                        key={i}
                        className={`sq${isLast ? ' lastmove' : ''}`}
                        onMouseEnter={() => setHoverSquare(`${row},${col}`)}
                        onMouseLeave={() =>
                          setHoverSquare((cur) => (cur === `${row},${col}` ? null : cur))
                        }
                        onClick={() => setHoverSquare(`${row},${col}`)}
                      >
                        {piece && (
                          <PieceView
                            piece={piece}
                            kinds={kinds}
                            locale={locale}
                            viewerSide={viewerSide}
                            mode={quantumDisplay}
                            tick={cycleTick}
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
              onClick={() => {}}
              selectedId={null}
              activePlayer={false}
              locale={locale}
              label={viewerSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl')}
              mode={quantumDisplay}
              tick={cycleTick}
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
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'nearest' });
  }, [ply, file]);

  const texts = file?.moveTexts ?? [];
  const count = file?.moves.length ?? 0;

  return (
    <div className="mv-list">
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
