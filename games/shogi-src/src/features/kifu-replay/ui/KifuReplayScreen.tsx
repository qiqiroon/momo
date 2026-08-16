import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useGameStore } from '../../../core/store/game-store';
import { useRouteStore } from '../../../core/store/route-store';
import { requestKifuLoad } from '../../../core/store/kifu-guard';
import { t as _t } from '../../../core/i18n';
import { buildInitialKindMap, displayKindsFor } from '../../../core/engine';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { PieceStandView, PieceView, groupHand } from '../../../core/ui-core/GameScreen';
import { seButton } from '../../../core/audio/se-synth';
import { adoptLoadedKifu, saveKifuFile } from '../index';
import { readKifuFile } from '../io';
import { asReplay, replayKifu } from '../replay';
import { kifuMemoryState, loadLastKifu, type KifuMemoryState } from '../storage';
import type { KifuFile } from '../types';
import { KifuListModal } from './KifuListModal';
import { kifuLabels } from './labels';
import { replayOrigin } from './origin';

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
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  const labels = kifuLabels(locale);
  const moveCount = file ? file.moves.length : 0;
  const fromGame = replayOrigin() === 'game';

  // 盤を「いま何手目まで」に合わせる。手が増減したときもここだけで揃う。
  useEffect(() => {
    if (file) replayKifu(file, ply);
  }, [file, ply]);

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

  /** 書き出し。**記録をそのまま書く**（盤から組み立て直さない）。 */
  const save = (target: KifuFile) => {
    setSaving(true);
    void saveKifuFile(target)
      .then((outcome) => {
        setMemoryState(kifuMemoryState());
        // **確かめられた場合だけ断定する**（付録D-8 §8）。取り消しは失敗ではない。
        setToast(t(outcome === 'saved' ? 's08.saved' : 's08.saveCancelled'));
      })
      .finally(() => setSaving(false));
  };

  const subLocale = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  return (
    <div className="stage">
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
            <button
              type="button"
              className="back-btn"
              onClick={() => {
                seButton();
                // 終局パネルから来たなら対局画面へ戻る＝そこに結果が出ている。
                setScreen(fromGame ? 'game' : 'lobby');
              }}
            >
              {t(fromGame ? 's08.backResult' : 's08.backTop')}
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
              }}
            >
              {t('s08.list')}
            </button>
          </div>

          <div className="pinfo opp">
            <span className="nm">{file ? labels.playerName(file, oppSide) : t('player.opp')}</span>
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
                    const piece = position.board[row][col];
                    const kinds = piece ? displayKindsFor(mgf, piece, kindMap) : [];
                    // 直前に**再生した**手の着地マス（付録D-8 §1）。
                    const isLast = lastTo?.row === row && lastTo?.col === col;
                    return (
                      <div key={i} className={`sq${isLast ? ' lastmove' : ''}`}>
                        {piece && (
                          <PieceView piece={piece} kinds={kinds} locale={locale} viewerSide={viewerSide} />
                        )}
                        {piece && kinds.length >= 2 && (
                          <span className={`qmark-b${piece.owner !== viewerSide ? ' gote' : ''}`}>？</span>
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
            />
          </div>

          <div className="pinfo you">
            <span className="nm">{file ? labels.playerName(file, viewerSide) : t('player.you')}</span>
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
}: {
  file: KifuFile | null;
  ply: number;
  onJump: (n: number) => void;
  startLabel: string;
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
        </button>
      ))}
    </div>
  );
}
