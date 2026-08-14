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
 * **手合い (駒落ち) はここでは選べない** (付録 D-5 v1.4 §5・ユーザー判断 2026-08-14)。
 * 手合いはルールの一部として**ルール選択画面 (S02)** で決める。ここでは要約を見せるだけで、
 * **駒を落とした側が先手**になるため、駒落ちのあいだ先後は**自動で選ばれた状態のまま固定**
 * される (§4.3)。
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
import { AI_LEVELS } from '../ai/types';
import { aiModeFrom, unsupportedReasonKey } from '../ai/mode';
import { handicapSettingFor } from '../engine';

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
  // 強さ (親 §7.5)。AI 選択とは直交する別の軸なので、モードが変わっても選び直さない。
  const level = useAiStore((s) => s.level);
  const setLevel = useAiStore((s) => s.setLevel);

  // モードが変わったら選び直す。いま選んでいるものが新しいモードにも対応していれば
  // その選択を尊重して残す (親 §7.1.1)。
  useEffect(() => {
    const resolved = resolveEngineId(engineId, mode);
    if (resolved !== engineId) setEngineId(resolved);
  }, [mode, engineId, setEngineId]);

  const selected = (engineId ? findEngine(engineId) : undefined) ?? choices.find((c) => c.supported)?.descriptor;

  // 手合い (駒落ち) は S02 で決まっている。ここでは先後を固定するのに使うだけ (付録 D-5 v1.4 §4.3)。
  const handicap = pendingRules?.handicap ?? null;

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
    handicap ? handicap.giver === 'self'
    : sideChoice === 'sente' ? true
    : sideChoice === 'gote' ? false
    : sideChoice === 'random' && draw && !spinning ? draw.youAreSente
    : null;
  /** 先後カードに出す選択。駒落ち中は自動で決まった側を見せる (平手に戻すと元の選択が復帰)。 */
  const shownSideChoice: AiSideChoice | null =
    handicap ? (handicap.giver === 'self' ? 'sente' : 'gote') : sideChoice;
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
    const handicapSetting = handicapSettingFor(handicap);
    useAiStore.getState().startVsAi({
      aiSide: youAreSente ? 'player2' : 'player1',
      engineId: selected?.id,
      level,
      mode,
    });
    conn?.commitPendingToActive();
    const gs = useGameStore.getState();
    gs.setTimeControl(pendingTc);
    gs.reset({
      // Phase 6: 遊ぶルール (本将棋 / はさみ将棋)。渡さないと前の対局のルールが残る。
      gameType: pendingRules?.gameType ?? 'shogi',
      handicap: handicapSetting,
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
            handicap={handicap}
            handicapSeatKeys={{ self: 's02.hcSeatYou', opponent: 's02.hcSeatAi' }}
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
          disabled={!!handicap}
          disabledNote={t('s03.sideLocked')}
        />

        {/* 手合いのカードは v1.33 で撤去した (ルール選択画面 S02 へ移設・付録 D-5 v1.4 §5)。
            ここに残るのは、手合いから決まった先後を固定して見せることだけ (§4.3)。
            手合いそのものはルールカードの要約に出る。 */}

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

        {/* 強さ (付録 D-5 v1.5 §6.7)。**AI 選択とは別の軸**で、どの AI にも同じ 3 段階が効く。
            段の名前は MOMO Works 共通の呼び名なので 3 言語とも英語表記のまま (訳さない)。
            対応・非対応の分岐は無い＝常に 3 つとも選べる。 */}
        <div className="s03-ai-block">
          <div className="s03-ai-label">{t('s03.lblLevel')}</div>
          <div className="seg">
            {AI_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                className={level === lv ? 'on' : ''}
                onClick={() => { seButton(); setLevel(lv); }}
              >
                {lv}
              </button>
            ))}
          </div>
          <div className="s03-ai-mobile-note">{t(`s03.level.${level}`)}</div>
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
