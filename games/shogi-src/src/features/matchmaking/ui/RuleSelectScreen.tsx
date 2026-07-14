import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { useMatchmakingStore, type TorusMode, type QuantumDisplayMode } from '../store';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';
import type { GameType } from '../roomNameCodec';
import { MiniBoardPreview } from './MiniBoardPreview';

/** v0.57 S02 ルール選択 (モック S02_v2 追随)。
 *
 *  役割 (v0.57 で純粋なルール選択画面に整理):
 *  - ルール一覧 (本将棋 / はさみ将棋 / カスタム) から 1 つ選ぶ
 *  - モディファイア (トーラス盤 / 量子将棋) を設定
 *  - 選択結果は pendingRoomConfig に書き込むだけ。部屋作成は S04 側で行う
 *
 *  部屋名 / パスワード / 公開 / 持ち時間 は S04 (ロビー) に移動済み。
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
// 軍人将棋・チェスは今回対象外 (モックのユーザー要望による絞り込み)
const RULES: RuleDef[] = [
  { id: 'shogi', nameKey: 's02.ruleHongi.name', descKey: 's02.ruleHongi.desc', torusOK: true, quantumOK: true },
  { id: 'hasami', nameKey: 's02.ruleHasami.name', descKey: 's02.ruleHasami.desc', torusOK: true, quantumOK: false },
  // カスタムは Phase 8 実装予定・現状は disabled でモック追随のみ (見た目のみ)
  { id: 'shogi-custom', nameKey: 's02.ruleCustom.name', descKey: 's02.ruleCustom.desc', torusOK: true, quantumOK: true, disabled: true },
];

export function RuleSelectScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const config = useMatchmakingStore((s) => s.pendingRoomConfig);
  const setConfig = useMatchmakingStore((s) => s.setPendingRoomConfig);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const currentRule = RULES.find((r) => r.id === config.gameType) ?? RULES[0];
  const torusUsable = currentRule.torusOK;
  const quantumUsable = currentRule.quantumOK;

  // ルール変更時、そのルールで非対応のモディファイアを自動的に OFF に落とす。
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

  const onBack = () => setScreen('net-lobby');
  const onCommit = () => setScreen('net-lobby');

  // ── サマリ (右カラム / 携帯: 決定ボタンの下) ──
  const modChips: string[] = [];
  if (config.torusMode === 'cylinder') modChips.push(t('s04.summaryTorusCyl'));
  else if (config.torusMode === 'full') modChips.push(t('s04.summaryTorusFull'));
  if (config.quantum) modChips.push(t('s04.summaryQuantum'));

  // 決定 + サマリ (右カラム上部 / 携帯: 設定パネルの直下)
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
      </div>
    </div>
  );

  // プレビュー (右カラム下部 / 携帯: サマリの下)
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
        <MiniBoardPreview rule={currentRule.id} torusMode={config.torusMode} />
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

        <ScreenBand code="S02" name={t('s02.screenTitle')} />

        <div className="screen-head">
          <h2>{t('s02.screenTitle')}</h2>
        </div>

        <div className="s02-grid">
          {/* ─── 左カラム: 設定 (デスクトップ) / 一番上 (携帯) ─── */}
          <div className="config-col">
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

            <div className="mod-block">
              <div className="section-label">{t('s02.secMods')}</div>

              {/* ── トーラス ── */}
              <div className="mod-group">
                <h3>
                  <span>{t('s02.torus')}</span>
                  <span className="sell">{t('s02.sellBadge')}</span>
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
                  {config.torusMode !== 'none' && (
                    <span className="neta-badge show">{t('s02.netaBadge')}</span>
                  )}
                </div>
                {!torusUsable && <div className="incompat show">{t('s02.torusIncompat')}</div>}
              </div>

              {/* ── 量子将棋 ── */}
              <div className="mod-group quantum">
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

                {/* 量子表示方式サブパネル (量子 ON のとき出現) */}
                {config.quantum && quantumUsable && (
                  <div className="quantum-sub show">
                    <div className="qh">{t('s02.qmTitle')}</div>
                    <div className="fair">
                      <b>{t('s02.qmFairBold')}</b>
                      {t('s02.qmFairRest')}
                    </div>
                    <div className="seg">
                      <button
                        type="button"
                        className={config.quantumDisplayMode === 'cycle' ? 'on' : ''}
                        onClick={() => onSetQm('cycle')}
                      >
                        {t('qmode.cycle')}
                      </button>
                      <button
                        type="button"
                        className={config.quantumDisplayMode === 'stack' ? 'on' : ''}
                        onClick={() => onSetQm('stack')}
                      >
                        {t('qmode.stack')}
                      </button>
                    </div>
                    <div className="qpreview">
                      <div className="qpv">
                        <div className="qpv-cell">
                          <span className="qmk">?</span>
                          <span className="g">歩</span>
                        </div>
                        <div className="qpv-label">{t('s02.qmCycleDesc')}</div>
                      </div>
                      <div className="qpv">
                        <div className="qpv-cell">
                          <span className="qmk">?</span>
                          <span className="stack">
                            <span>歩</span>
                            <span>桂</span>
                            <span>銀</span>
                          </span>
                        </div>
                        <div className="qpv-label">{t('s02.qmStackDesc')}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── 右カラム: 決定 → サマリ → プレビュー (デスクトップ)
                携帯では設定の直下に 決定 → サマリ → プレビュー の順で縦積み ─── */}
          <div className="preview-col">
            {commitCard}
            {previewCard}
          </div>
        </div>
      </div>
    </div>
  );
}
