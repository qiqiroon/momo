import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { useMatchmakingStore, type TorusMode, type QuantumDisplayMode, type TimeControlMode } from '../store';
import type { GameType } from '../roomNameCodec';
import { MiniBoardPreview, QUANTUM_PIECES } from './MiniBoardPreview';

/** v0.58 S02 ルール選択 (レイアウト圧縮 + 時間設定を S04 から移設)。
 *
 *  役割:
 *  - ルール一覧 (本将棋 / はさみ将棋 / カスタム) から 1 つ選ぶ (横 3 列 grid)
 *  - 変則条件 (トーラス盤 / 量子将棋) を設定 (横 2 列 grid)
 *  - 持ち時間モード + 秒数を設定 (v0.58 で S04 から移設)
 *  - 選択結果は pendingRoomConfig に書き込むだけ。部屋作成は S04 側で行う
 *
 *  v0.57 までとの差分:
 *  - 「モディファイア」→「変則条件」に名称変更 (i18n 側)
 *  - ルール/変則条件を縦積み → 横並び grid に圧縮
 *  - 持ち時間設定パネルをこの画面の変則条件の下に追加 (S04 から移動)
 */

interface RuleDef {
  id: GameType;
  nameKey: string;
  descKey: string;
  torusOK: boolean;
  quantumOK: boolean;
  disabled?: boolean;
}

// 現状 selectable な 3 ルール
const RULES: RuleDef[] = [
  { id: 'shogi', nameKey: 's02.ruleHongi.name', descKey: 's02.ruleHongi.desc', torusOK: true, quantumOK: true },
  { id: 'hasami', nameKey: 's02.ruleHasami.name', descKey: 's02.ruleHasami.desc', torusOK: true, quantumOK: false },
  { id: 'shogi-custom', nameKey: 's02.ruleCustom.name', descKey: 's02.ruleCustom.desc', torusOK: true, quantumOK: true, disabled: true },
];

// v0.64: 10 分と 3 秒を追加
const MAIN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '0（秒読みのみ）' },
  { value: 5 * 60, label: '5分' },
  { value: 10 * 60, label: '10分' },
  { value: 15 * 60, label: '15分' },
  { value: 30 * 60, label: '30分' },
  { value: 60 * 60, label: '1時間' },
];
const BYO_OPTIONS: { value: number; label: string }[] = [
  { value: 3, label: '3秒' },
  { value: 5, label: '5秒' },
  { value: 10, label: '10秒' },
  { value: 30, label: '30秒' },
  { value: 60, label: '60秒' },
];

/** サマリ 1 行用: 現在の時間設定を短く表す ("時間フリー" / "秒読み・5分+30秒" 等) */
export function formatTimeSummary(
  time: { mode: TimeControlMode; mainSeconds: number; byoyomiSeconds?: number; incrementSeconds?: number },
  tr: (k: string) => string,
): string {
  const fmt = (s: number) => {
    if (s <= 0) return '0';
    if (s % 60 === 0) return `${s / 60}分`;
    return `${s}秒`;
  };
  const modeLabel =
    time.mode === 'no_limit'
      ? tr('s04.timeFree')
      : time.mode === 'byoyomi'
      ? tr('s04.timeByoyomi')
      : time.mode === 'fischer'
      ? tr('s04.timeIncrement')
      : tr('s04.timeBoth');
  const parts: string[] = [modeLabel];
  if (time.mode !== 'no_limit') {
    parts.push(fmt(time.mainSeconds));
    if (time.mode === 'byoyomi' && time.byoyomiSeconds !== undefined) parts.push(`+${fmt(time.byoyomiSeconds)}`);
    if (time.mode === 'fischer' && time.incrementSeconds !== undefined) parts.push(`+${fmt(time.incrementSeconds)}`);
  }
  return parts.join('・');
}

export function RuleSelectScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const config = useMatchmakingStore((s) => s.pendingRoomConfig);
  const setConfig = useMatchmakingStore((s) => s.setPendingRoomConfig);

  // v0.63: 量子「巡回」プレビューの現在表示駒 (1 秒ごとに強い順→弱い順に切替)
  const [cycleIdx, setCycleIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCycleIdx((i) => (i + 1) % QUANTUM_PIECES.length), 1000);
    return () => clearInterval(id);
  }, []);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const currentRule = RULES.find((r) => r.id === config.gameType) ?? RULES[0];
  const torusUsable = currentRule.torusOK;
  const quantumUsable = currentRule.quantumOK;

  const onSelectRule = (rid: GameType) => {
    const def = RULES.find((r) => r.id === rid);
    if (!def || def.disabled) return;
    const patch: Parameters<typeof setConfig>[0] = { gameType: rid };
    if (!def.torusOK && config.torusMode !== 'none') {
      patch.torusMode = 'none';
      patch.torus = false;
    }
    if (!def.quantumOK && config.quantum) {
      patch.quantum = false;
    }
    setConfig(patch);
  };

  const onSetTorus = (mode: TorusMode) => {
    if (!torusUsable) return;
    setConfig({ torusMode: mode, torus: mode !== 'none' });
  };
  const onSetQuantum = (on: boolean) => {
    if (!quantumUsable) return;
    setConfig({ quantum: on });
  };
  const onSetQm = (m: QuantumDisplayMode) => setConfig({ quantumDisplayMode: m });

  // v0.64: 時計あり (byoyomi/fischer/sudden_death) のデフォルトを 10 分 + 30 秒に統一
  const setTimeMode = (m: TimeControlMode) => {
    const cur = config.timeControl;
    setConfig({
      timeControl: {
        mode: m,
        mainSeconds: m === 'no_limit' ? 0 : cur.mainSeconds || 600,
        byoyomiSeconds: m === 'byoyomi' ? cur.byoyomiSeconds ?? 30 : undefined,
        incrementSeconds: m === 'fischer' ? cur.incrementSeconds ?? 30 : undefined,
      },
    });
  };

  // v0.69: 戻る先は route.ruleSelectReturn を参照 (S04 経由=net-lobby / S01 経由=offline-rule)
  const returnDest = useRouteStore((s) => s.ruleSelectReturn);
  const onBack = () => setScreen(returnDest);
  const onCommit = () => setScreen(returnDest);

  const modChips: string[] = [];
  if (config.torusMode === 'cylinder') modChips.push(t('s04.summaryTorusCyl'));
  else if (config.torusMode === 'full') modChips.push(t('s04.summaryTorusFull'));
  if (config.quantum) modChips.push(t('s04.summaryQuantum'));

  const timeSummary = formatTimeSummary(config.timeControl, t);

  const commitCard = (
    <div className="commit-card">
      <button className="go-btn" type="button" onClick={onCommit}>
        {t('s02.commitGo')}
      </button>
      <div className="go-sub">{t('s02.commitGoBack')}</div>
      <div className="commit-summary" style={{ marginTop: 12, marginBottom: 0 }}>
        <b>{t('s02.commitSumRule')}</b>: {t(currentRule.nameKey)}
        <br />
        <b>{t('s02.commitSumMods')}</b>:{' '}
        {modChips.length === 0 ? (
          t('s02.commitSumNone')
        ) : (
          modChips.map((c, i) => (
            <span key={i} className="mod-chip">
              {c}
            </span>
          ))
        )}
        <br />
        <b>{t('s02.commitSumTime')}</b>: {timeSummary}
      </div>
    </div>
  );

  const previewCard = (
    <div className="preview-card">
      <div className="pv-title">{t('s02.pvTitle')}</div>
      <div className="pv-topo">
        {config.torusMode === 'none'
          ? t('s02.pvTopoPlane')
          : config.torusMode === 'cylinder'
          ? t('s02.pvTopoCyl')
          : t('s02.pvTopoFull')}
      </div>
      <div className="pv-board-wrap">
        <MiniBoardPreview
          rule={currentRule.id}
          torusMode={config.torusMode}
          quantum={config.quantum && quantumUsable}
          quantumDisplayMode={config.quantumDisplayMode}
        />
      </div>
      {config.torusMode !== 'none' && (
        <div style={{ textAlign: 'center' }}>
          <span className="wrap-tag">
            {config.torusMode === 'cylinder' ? t('s02.wrapCyl') : t('s02.wrapFull')}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="stage">
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
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
            <button className="reset-btn" type="button" onClick={onBack}>
              {t('s02.commitGoBack')}
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        <div className="screen-head">
          <h2>{t('s02.screenTitle')}</h2>
        </div>

        <div className="s02-grid">
          <div className="config-col">
            {/* ルール横 3 列 */}
            <div className="section-label">{t('s02.secRules')}</div>
            <div className="rule-list">
              {RULES.map((r) => {
                const selected = r.id === config.gameType;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`rule-card${selected ? ' selected' : ''}${r.disabled ? ' disabled' : ''}`}
                    onClick={() => onSelectRule(r.id)}
                    disabled={r.disabled}
                  >
                    <div className="rc-name">{t(r.nameKey)}</div>
                    <div className="rc-desc">{t(r.descKey)}</div>
                    {selected && (
                      <div className="rc-check" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 変則条件 横 2 列 */}
            <div className="mod-block">
              <div className="section-label">{t('s02.secMods')}</div>
              <div className="mod-grid">
                <div className={`mod-group${config.torusMode !== 'none' && torusUsable ? ' active' : ''}`}>
                  <h3>
                    <span>{t('s02.torus')}</span>
                  </h3>
                  <div className="mod-note">{t('s02.torusNote')}</div>
                  <div className="seg">
                    <button
                      type="button"
                      className={config.torusMode === 'none' ? 'on' : ''}
                      onClick={() => onSetTorus('none')}
                      disabled={!torusUsable}
                    >
                      {t('s02.torusOff')}
                    </button>
                    <button
                      type="button"
                      className={config.torusMode === 'cylinder' ? 'on' : ''}
                      onClick={() => onSetTorus('cylinder')}
                      disabled={!torusUsable}
                    >
                      {t('s02.torusCyl')}
                    </button>
                    <button
                      type="button"
                      className={config.torusMode === 'full' ? 'on' : ''}
                      onClick={() => onSetTorus('full')}
                      disabled={!torusUsable}
                    >
                      {t('s02.torusFull')}
                    </button>
                    {/* v0.64: 実験・ネタバッジは完全トーラスのみ。円筒は将棋ルールとして
                        現実的に成立するモード扱いなのでバッジ不要 (ユーザー指摘) */}
                    {config.torusMode === 'full' && (
                      <span className="neta-badge show">{t('s02.netaBadge')}</span>
                    )}
                  </div>
                  {!torusUsable && <div className="incompat show">{t('s02.torusIncompat')}</div>}
                </div>

                <div className={`mod-group${config.quantum && quantumUsable ? ' active' : ''}`}>
                  <h3>
                    <span>{t('s02.quantum')}</span>
                  </h3>
                  <div className="mod-note">{t('s02.quantumNote')}</div>
                  <div className="seg">
                    <button
                      type="button"
                      className={!config.quantum ? 'on' : ''}
                      onClick={() => onSetQuantum(false)}
                      disabled={!quantumUsable}
                    >
                      {t('s02.quantumOff')}
                    </button>
                    <button
                      type="button"
                      className={config.quantum ? 'on' : ''}
                      onClick={() => onSetQuantum(true)}
                      disabled={!quantumUsable}
                    >
                      {t('s02.quantumOn')}
                    </button>
                  </div>
                  {!quantumUsable && <div className="incompat show">{t('s02.quantumIncompat')}</div>}

                  {config.quantum && quantumUsable && (
                    <div className="quantum-sub show">
                      <div className="qh">{t('s02.qmTitle')}</div>
                      <div className="fair">
                        <b>{t('s02.qmFairBold')}</b>
                        {t('s02.qmFairRest')}
                      </div>
                      {/* v0.63: 巡回/重ねをスイッチではなくパネル選択に。パネル自体が選択ボタン。
                          巡回は 1 秒ごとに強い駒→弱い駒へ、重ねは 8 種類を全て重ねる。 */}
                      <div className="qpreview">
                        <button
                          type="button"
                          className={`qpv${config.quantumDisplayMode === 'cycle' ? ' selected' : ''}`}
                          onClick={() => onSetQm('cycle')}
                        >
                          <div className="qpv-head">{t('qmode.cycle')}</div>
                          {/* v0.65: qpv-cell-wrap で ? を clip 外に配置 */}
                          <div className="qpv-cell-wrap">
                            <div className="qpv-cell">
                              <span className="g">{QUANTUM_PIECES[cycleIdx]}</span>
                            </div>
                            <span className="qmk">?</span>
                          </div>
                          <div className="qpv-label">{t('s02.qmCycleDesc')}</div>
                        </button>
                        <button
                          type="button"
                          className={`qpv${config.quantumDisplayMode === 'stack' ? ' selected' : ''}`}
                          onClick={() => onSetQm('stack')}
                        >
                          <div className="qpv-head">{t('qmode.stack')}</div>
                          <div className="qpv-cell-wrap">
                            <div className="qpv-cell">
                              <span className="stack">
                                {QUANTUM_PIECES.map((p) => (
                                  <span key={p}>{p}</span>
                                ))}
                              </span>
                            </div>
                            <span className="qmk">?</span>
                          </div>
                          <div className="qpv-label">{t('s02.qmStackDesc')}</div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 持ち時間パネル (v0.58: S04 から移設・v0.63: ラベルを外に + active 枠 + モード説明) */}
            <div className="time-block">
              <div className="section-label">{t('s04.lblTime')}</div>
              <div className={`time-panel${config.timeControl.mode !== 'no_limit' ? ' active' : ''}`}>
              <div className="tp-modes">
                <button
                  type="button"
                  className="act"
                  onClick={() => setTimeMode('no_limit')}
                  style={config.timeControl.mode === 'no_limit' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                >
                  {t('s04.timeFree')}
                </button>
                <button
                  type="button"
                  className="act"
                  onClick={() => setTimeMode('byoyomi')}
                  style={config.timeControl.mode === 'byoyomi' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                >
                  {t('s04.timeByoyomi')}
                </button>
                <button
                  type="button"
                  className="act"
                  onClick={() => setTimeMode('fischer')}
                  style={config.timeControl.mode === 'fischer' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                >
                  {t('s04.timeIncrement')}
                </button>
                <button
                  type="button"
                  className="act"
                  onClick={() => setTimeMode('sudden_death')}
                  style={config.timeControl.mode === 'sudden_death' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                >
                  {t('s04.timeBoth')}
                </button>
              </div>

              {config.timeControl.mode !== 'no_limit' && (
                <div className="tp-sub">
                  <div className="tp-sub-label">{t('s04.mainSec')}</div>
                  <div className="tp-sub-opts">
                    {MAIN_OPTIONS.filter((o) => o.value > 0 || config.timeControl.mode === 'byoyomi').map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className="act"
                        onClick={() => setConfig({ timeControl: { ...config.timeControl, mainSeconds: o.value } })}
                        style={config.timeControl.mainSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {config.timeControl.mode === 'byoyomi' && (
                <div className="tp-sub">
                  <div className="tp-sub-label">{t('s04.byoyomiSec')}</div>
                  <div className="tp-sub-opts">
                    {BYO_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className="act"
                        onClick={() => setConfig({ timeControl: { ...config.timeControl, byoyomiSeconds: o.value } })}
                        style={config.timeControl.byoyomiSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {config.timeControl.mode === 'fischer' && (
                <div className="tp-sub">
                  <div className="tp-sub-label">{t('s04.incrementSec')}</div>
                  <div className="tp-sub-opts">
                    {/* v0.65: fischer で 0 秒は加算方式として意味が無いので除外 */}
                    {BYO_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className="act"
                        onClick={() => setConfig({ timeControl: { ...config.timeControl, incrementSeconds: o.value } })}
                        style={config.timeControl.incrementSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* v0.63: 選択中モードの説明文を最下段に */}
              <div className="tp-desc">
                {config.timeControl.mode === 'no_limit' && t('s04.timeFreeDesc')}
                {config.timeControl.mode === 'byoyomi' && t('s04.timeByoyomiDesc')}
                {config.timeControl.mode === 'fischer' && t('s04.timeIncrementDesc')}
                {config.timeControl.mode === 'sudden_death' && t('s04.timeBothDesc')}
              </div>
              </div>
            </div>
          </div>

          <div className="preview-col">
            {commitCard}
            {previewCard}
          </div>
        </div>
      </div>
    </div>
  );
}
