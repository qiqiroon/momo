/**
 * 対AI設定画面 S03 (Phase 3-2・付録 D-5 v1.2)。
 *
 * トップの「AI 対戦」→ ルール選択 (S02) →**この画面**→ 対局 (S06)。
 *
 * 置くもの (付録 D-5 §2 の縦順):
 *   弱体化注記 (モディファイア ON のときだけ) → 先後 (＋振り駒) → AI 選択 → 開始
 *
 * **持ち時間はここでは選べない** (付録 D-5 v1.2 §7・ユーザー判断 2026-08-14)。
 * ルール選択画面 (S02) の担当で、ここでは要約を見せるだけ。変えたいときは
 * ルールカードの「変更」から S02 へ戻る。
 *
 * **手合い (駒落ち) は Phase 3-3 で追加** (付録 D-5 v1.3 §5・親 §3.12.1)。
 * 落とす側は AI でも自分でも選べ、**駒を落とした側が先手**になるので、
 * 駒落ちのあいだ先後は選べない (§4.3)。選べる駒落ちの種類は**ルール定義が持つ
 * 手合いの一覧**から作る (画面に焼き付けない)。
 */

import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { useRouteStore } from '../store/route-store';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import { CatIcon } from './CatIcon';
import { HeaderCommonRight } from './HeaderCommonRight';
import { RuleSelectionCard } from './RuleSelectionCard';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import { seButton } from '../audio/se-synth';
import { DEFAULT_TIME_CONTROL } from '../engine/time-control';
import { SidePickAi, useFurigoma, type AiSideChoice } from './SidePickAi';
import { listEngines, resolveEngineId, findEngine } from '../ai/engine-registry';
import { aiModeFrom, unsupportedReasonKey } from '../ai/mode';
import { listHandicaps } from '../engine';
import type { HandicapSetting, MgfHandicapType } from '../engine';

export function AiSetupScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? _t('app.sub', 'zh') : _t('app.sub', 'en');

  const conn = pluginGet<OnlineGameConnector>('gameConnector');
  const pendingRules = conn?.getPendingRules() ?? null;
  const pendingTc = conn?.getPendingTimeControl() ?? DEFAULT_TIME_CONTROL;

  // 親 §7.1.1: どの AI をどの順で並べるかは「モード」で決まる。
  const mode = aiModeFrom(pendingRules);
  const choices = listEngines(mode);
  const engineId = useAiStore((s) => s.engineId);
  const setEngineId = useAiStore((s) => s.setEngineId);

  // モードが変わったら選び直す。いま選んでいるものが新しいモードにも対応していれば
  // その選択を尊重して残す (親 §7.1.1)。
  useEffect(() => {
    const resolved = resolveEngineId(engineId, mode);
    if (resolved !== engineId) setEngineId(resolved);
  }, [mode, engineId, setEngineId]);

  const selected = (engineId ? findEngine(engineId) : undefined) ?? choices.find((c) => c.supported)?.descriptor;

  // 手合い (駒落ち)。選べる種類はルール定義が持つ一覧から取る (親 §3.12.1)。
  const mgf = useGameStore((s) => s.mgf);
  const handicaps = listHandicaps(mgf);
  const handicapAvailable = handicaps.length > 0;
  const [handicapOn, setHandicapOn] = useState(false);
  /** 駒を落とす側。既定は AI (子ども・初心者が勝ちやすくする向き・付録 D-5 §5)。 */
  const [handicapGiver, setHandicapGiver] = useState<'ai' | 'you'>('ai');
  const [handicapTypeId, setHandicapTypeId] = useState<string>(
    () => handicaps.find((h) => h.id === 'ni')?.id ?? handicaps[0]?.id ?? '',
  );
  // 駒落ちに対応しないルールへ変わったら平手へ戻す (付録 D-5 §5)
  useEffect(() => {
    if (!handicapAvailable && handicapOn) setHandicapOn(false);
  }, [handicapAvailable, handicapOn]);
  const handicapName = (h: MgfHandicapType) => {
    const key = `hc.${h.id}`;
    const label = t(key);
    return label === key ? (h.name ?? h.id) : label;
  };

  // 先後。ネット対戦の部屋 (S05) から持ってきたものをそのまま使う。
  const [sideChoice, setSideChoice] = useState<AiSideChoice | null>(null);
  const { draw, spinning, roll } = useFurigoma(sideChoice);
  const onPickSide = (choice: AiSideChoice) => {
    setSideChoice(choice);
    if (choice === 'random') roll(); // 押し直すと振り直す
  };
  /**
   * あなたが先手か。おまかせは振り駒の結果に従う。決まっていなければ null。
   * **駒落ちのときは手合いから決まる**＝駒を落とした側が先手 (親 §3.12.1)。
   */
  const youAreSente: boolean | null =
    handicapOn ? handicapGiver === 'you'
    : sideChoice === 'sente' ? true
    : sideChoice === 'gote' ? false
    : sideChoice === 'random' && draw && !spinning ? draw.youAreSente
    : null;
  /** 先後カードに出す選択。駒落ち中は自動で決まった側を見せる (平手に戻すと元の選択が復帰)。 */
  const shownSideChoice: AiSideChoice | null =
    handicapOn ? (handicapGiver === 'you' ? 'sente' : 'gote') : sideChoice;
  const startDisabled = youAreSente === null || !selected;

  const onBack = () => {
    seButton();
    useRouteStore.getState().setRuleSelectReturn('ai-setup');
    setScreen('rule-select');
  };
  const onHome = () => { seButton(); setScreen('lobby'); };

  const onStart = () => {
    if (startDisabled) return;
    seButton();
    // 上手 (駒を落とした側) は先手なので player1。どちらの人間/AI がそれを持つかは
    // aiSide 側で表される (親 §3.12.1)。
    const handicap: HandicapSetting | null =
      handicapOn && handicapTypeId ? { typeId: handicapTypeId, giver: 'player1' } : null;
    useAiStore.getState().startVsAi({
      aiSide: youAreSente ? 'player2' : 'player1',
      engineId: selected?.id,
      mode,
    });
    conn?.commitPendingToActive();
    const gs = useGameStore.getState();
    gs.setTimeControl(pendingTc);
    gs.reset({
      handicap,
      quantum: pendingRules?.quantum ?? false,
      quantumDisplay: pendingRules?.quantumDisplayMode ?? 'cycle',
      torusMode: pendingRules?.torusMode ?? 'none',
    });
    setScreen('game');
  };

  const modifiersOn = mode === 'torus' || mode === 'quantum';

  return (
    <div className="stage">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
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
            <button className="reset-btn" type="button" onClick={onHome} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('s00.modeSelect')}
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        {/* 画面見出し帯 (付録 D-5 §2)。戻るはルール選択 (S02) へ。 */}
        <div className="s03-head">
          <button className="reset-btn" type="button" onClick={onBack}>← {t('s03.back')}</button>
          <div className="s03-title">{t('s03.title')}</div>
          <div className="s03-step">{t('s03.step')}</div>
        </div>

        {/* ルール表示＋変更導線 (付録 D-5 §3)。持ち時間の要約もここに出る。 */}
        <div style={{ marginTop: 12 }}>
          <RuleSelectionCard
            gameType={pendingRules?.gameType ?? 'shogi'}
            torusMode={pendingRules?.torusMode ?? 'none'}
            quantum={pendingRules?.quantum ?? false}
            timeControl={pendingTc}
            onEditRule={onBack}
          />
        </div>

        {/* 弱体化注記 (付録 D-5 §3)。モディファイアが 1 つでも ON のときだけ。 */}
        {modifiersOn && <div className="s03-weak-note">⚠ {t('s03.weakNote')}</div>}

        <div className="ai-opponent-note">{t('s01.vsAi')}</div>

        <SidePickAi
          t={t}
          choice={shownSideChoice}
          onChoice={onPickSide}
          draw={draw}
          spinning={spinning}
          onBeforeChoice={seButton}
          disabled={handicapOn}
          disabledNote={t('s03.sideLocked')}
        />

        {/* 手合い (付録 D-5 v1.3 §5)。駒落ちなら「落とす側」と「落とす駒」も選ぶ。 */}
        <div className="s03-handicap">
          <div className="section-label">{t('s03.lblHandicap')}</div>
          <div className="seg">
            <button
              type="button"
              className={!handicapOn ? 'on' : ''}
              onClick={() => { seButton(); setHandicapOn(false); }}
            >
              {t('s03.hcEven')}
            </button>
            <button
              type="button"
              className={handicapOn ? 'on' : ''}
              disabled={!handicapAvailable}
              onClick={() => { seButton(); setHandicapOn(true); }}
            >
              {t('s03.hcDrop')}
            </button>
          </div>
          {!handicapAvailable && <div className="s03-handicap-gate">⚠ {t('s03.hcUnsupported')}</div>}
          {handicapOn && (
            <>
              <div className="seg" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={handicapGiver === 'ai' ? 'on' : ''}
                  onClick={() => { seButton(); setHandicapGiver('ai'); }}
                >
                  {t('s03.hcGiverAi')}
                </button>
                <button
                  type="button"
                  className={handicapGiver === 'you' ? 'on' : ''}
                  onClick={() => { seButton(); setHandicapGiver('you'); }}
                >
                  {t('s03.hcGiverYou')}
                </button>
              </div>
              <label className="s03-ai-label" htmlFor="s03-hc-select" style={{ marginTop: 10 }}>
                {t('s03.hcLblType')}
              </label>
              <select
                id="s03-hc-select"
                className="s03-ai-select"
                value={handicapTypeId}
                onChange={(e) => { seButton(); setHandicapTypeId(e.target.value); }}
              >
                {handicaps.map((h) => (
                  <option key={h.id} value={h.id}>{handicapName(h)}</option>
                ))}
              </select>
              <div className="s03-handicap-note">{t('s03.hcNote')}</div>
            </>
          )}
        </div>

        {/* AI 選択 (付録 D-5 §6)。積まれているものを、このモードでの順位で並べる。 */}
        <div className="s03-ai-block">
          <label className="s03-ai-label" htmlFor="s03-ai-select">{t('s03.lblAi')}</label>
          {choices.length === 0 ? (
            <div className="s03-ai-desc">{t('s03.noEngine')}</div>
          ) : (
            <>
              <select
                id="s03-ai-select"
                className="s03-ai-select"
                value={selected?.id ?? ''}
                onChange={(e) => { seButton(); setEngineId(e.target.value); }}
              >
                {choices.map(({ descriptor, supported }) => (
                  <option key={descriptor.id} value={descriptor.id} disabled={!supported}>
                    {t(descriptor.labelKey)}
                    {supported ? '' : `（${t(unsupportedReasonKey(mode))}）`}
                  </option>
                ))}
              </select>
              {selected && (
                <div className="s03-ai-desc">
                  <div className="s03-ai-desc-name">{t(selected.labelKey)}</div>
                  <div>{t(selected.descKey)}</div>
                </div>
              )}
              <div className="s03-ai-mobile-note">{t('s03.mobileNote')}</div>
            </>
          )}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button
            className="act taunt"
            type="button"
            onClick={onStart}
            disabled={startDisabled}
            style={{ minWidth: 180, ...(startDisabled ? { opacity: 0.32, cursor: 'not-allowed' } : {}) }}
          >
            {t('s01.startGame')}
          </button>
        </div>
      </div>
    </div>
  );
}
