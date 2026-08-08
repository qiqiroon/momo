/**
 * 設定パネル（第3分冊 2.10）
 *
 * 共通ヘッダーの歯車ボタンが開くドロップダウン。モーダルではない。
 * **端末ごとの好みだけを扱う**（音・触覚・ルーペの置き場所）。
 * 盤面サイズ・難易度・成績などはタイトルビューに残る（2.6）。
 *
 * ダイアログ（12章）ではないため `D-` 番号を持たない。
 */

import { useEffect, useRef, useState } from 'react';
import { diagnostics } from '../../data/diagnostics';
import { LOUPE_CORNERS, type LoupeCorner, type Settings } from '../../data/types';
import { PALETTE_SCALES } from '../config';
import { t } from '../../i18n/locale';

export interface SettingsPanelProps {
  settings: Settings;
  onChange(patch: Partial<Settings>): void;
  /** 音量の変更操作を終えたときの確認再生（2.10。soundEnabled が真のときのみ） */
  onPreviewSound?(): void;
  onClose(): void;
  /**
   * 大きさを決めている最中か（C-190）
   *
   * 二段構えのときは、ふだん縮めた姿で出ている。**押している最中だけ実物の大きさで見せる**——
   * そうしないと、何を決めているのかが見えない。
   */
  onSizePreview?(active: boolean): void;
  /**
   * 開閉を担うボタン（歯車）。ここへの押下は「パネル外」に数えない。
   * 数えてしまうと、閉じてから開き直しが走り、ボタンで閉じられなくなる。
   */
  anchor?: React.RefObject<HTMLElement | null>;
}

/** 触覚に対応しない環境では項目自体を出さない（設計書 4.14） */
function hapticSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * 取り込み記録の控え（C-168）
 *
 * `?debug=1` のときだけ現れる。**文言は `t()` を通さない。**
 * 猫語や英語に化けると、追跡のための控えとして役に立たなくなるためである。
 */
function DiagnosticsSection(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const report = diagnostics.formatReport();
  const entries = diagnostics.list();
  const failures = entries.filter((e) => e.outcome !== 'ok').length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      // 貼り付け板への書き込みを断られる場合があるため、そのときは本文を出して手で選ばせる
      setShown(true);
    }
  };

  return (
    <div className="settings-diag">
      <div className="settings-diag-head">
        取り込み記録 {entries.length}件{failures > 0 && `（失敗 ${failures}）`}
      </div>
      <div className="settings-diag-actions">
        <button type="button" onClick={copy}>
          {copied ? 'コピーしました' : 'コピー'}
        </button>
        <button type="button" onClick={() => setShown((prev) => !prev)}>
          {shown ? '隠す' : '表示'}
        </button>
      </div>
      {shown && <textarea className="settings-diag-body" readOnly value={report} />}
    </div>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onPreviewSound,
  onClose,
  anchor,
  onSizePreview,
}: SettingsPanelProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  /** いまの倍率が刻みの何番目か。近いものを採る */
  const scaleIndex = (() => {
    let best = 0;
    for (let i = 1; i < PALETTE_SCALES.length; i++) {
      if (Math.abs(PALETTE_SCALES[i] - settings.paletteScale) < Math.abs(PALETTE_SCALES[best] - settings.paletteScale)) best = i;
    }
    return best;
  })();

  const onPreviewStart = (): void => onSizePreview?.(true);
  const onPreviewEnd = (): void => onSizePreview?.(false);

  const stepScale = (direction: 1 | -1): void => {
    const next = Math.min(PALETTE_SCALES.length - 1, Math.max(0, scaleIndex + direction));
    onChange({ paletteScale: PALETTE_SCALES[next] });
  };

  useEffect(() => {
    // パネル外の押下・Esc で閉じる（2.10）
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !panelRef.current) return;
      if (panelRef.current.contains(target)) return;
      if (anchor?.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown as EventListener, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown as EventListener, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, anchor]);

  return (
    <div className="settings-panel" ref={panelRef} role="group" aria-label={t('header.settings.open')}>
      <label className="settings-row">
        <span>{t('settings.sound.enabled')}</span>
        <input
          type="checkbox"
          checked={settings.soundEnabled}
          onChange={(event) => onChange({ soundEnabled: event.target.checked })}
        />
      </label>

      <label className="settings-row">
        <span>{t('settings.sound.volume')}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.soundVolume}
          disabled={!settings.soundEnabled}
          onChange={(event) => onChange({ soundVolume: Number(event.target.value) })}
          // 変更操作を終えた時点で1回だけ試聴する（2.10）
          onPointerUp={() => settings.soundEnabled && onPreviewSound?.()}
          onKeyUp={() => settings.soundEnabled && onPreviewSound?.()}
        />
      </label>

      {hapticSupported() && (
        <label className="settings-row">
          <span>{t('settings.haptic.enabled')}</span>
          <input
            type="checkbox"
            checked={settings.hapticEnabled}
            onChange={(event) => onChange({ hapticEnabled: event.target.checked })}
          />
        </label>
      )}

      {/* ルーペを置く角（C-185）。**盤面を遊んでいなくても選べる**——設定は局に属さない */}
      <label className="settings-row">
        <span>{t('settings.loupe.corner')}</span>
        <select
          value={settings.loupeCorner}
          aria-label={t('settings.loupe.corner')}
          onChange={(event) => onChange({ loupeCorner: event.target.value as LoupeCorner })}
        >
          {LOUPE_CORNERS.map((corner) => (
            <option key={corner} value={corner}>
              {t(`settings.loupe.corner.${corner}`)}
            </option>
          ))}
        </select>
      </label>

      {/* 数字ボタンの大きさ（C-190）。**触れないほど小さくも、はみ出すほど大きくもできる** */}
      <div className="settings-row">
        <span>{t('settings.palette.scale')}</span>
        <span className="settings-stepper">
          <button
            type="button"
            aria-label={t('play.zoom.out')}
            data-testid="palette-smaller"
            disabled={scaleIndex <= 0}
            onPointerDown={onPreviewStart}
            onPointerUp={onPreviewEnd}
            onPointerCancel={onPreviewEnd}
            onPointerLeave={onPreviewEnd}
            onClick={() => stepScale(-1)}
          >
            −
          </button>
          <button
            type="button"
            aria-label={t('play.zoom.in')}
            data-testid="palette-larger"
            disabled={scaleIndex >= PALETTE_SCALES.length - 1}
            onPointerDown={onPreviewStart}
            onPointerUp={onPreviewEnd}
            onPointerCancel={onPreviewEnd}
            onPointerLeave={onPreviewEnd}
            onClick={() => stepScale(1)}
          >
            ＋
          </button>
        </span>
      </div>

      {diagnostics.isDebugMode() && <DiagnosticsSection />}
    </div>
  );
}
