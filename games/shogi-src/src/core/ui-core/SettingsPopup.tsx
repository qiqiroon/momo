import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import { getBgmVolume, getSfxVolume, setBgmVolume, setSfxVolume } from '../audio/audio-engine';

/**
 * v0.73: 歯車ボタンから開く設定ポップアップ (Darts 準拠)。
 *  現状は BGM/効果音の音量スライダのみ。将来項目が増えたらここに追加する。
 */
interface SettingsPopupProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPopup({ open, onClose }: SettingsPopupProps) {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const [bgmV, setBgmV] = useState<number>(getBgmVolume());
  const [sfxV, setSfxV] = useState<number>(getSfxVolume());

  useEffect(() => {
    if (open) {
      setBgmV(getBgmVolume());
      setSfxV(getSfxVolume());
    }
  }, [open]);

  if (!open) return null;

  const onBgm = (v: number) => { setBgmV(v); setBgmVolume(v); };
  const onSfx = (v: number) => { setSfxV(v); setSfxVolume(v); };

  return (
    <>
      {/* クリック透過の外側キャプチャ (背景タップで閉じる) */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 400 }}
      />
      {/* ポップアップ本体 (歯車の下に固定) */}
      <div
        style={{
          position: 'fixed', top: 46, right: 12, zIndex: 401,
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 10, padding: '12px 14px', minWidth: 240, color: 'var(--text)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 10 }}>
          {t('sound.settingsTitle')}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
          <span style={{ minWidth: 64, color: 'var(--text-muted)' }}>{t('sound.bgmLabel')}</span>
          <input type="range" min="0" max="100" value={bgmV} onChange={(e) => onBgm(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--orange)' }} />
          <span style={{ minWidth: 36, textAlign: 'right' }}>{bgmV}%</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ minWidth: 64, color: 'var(--text-muted)' }}>{t('sound.sfxLabel')}</span>
          <input type="range" min="0" max="100" value={sfxV} onChange={(e) => onSfx(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--orange)' }} />
          <span style={{ minWidth: 36, textAlign: 'right' }}>{sfxV}%</span>
        </label>
        {/* v0.75/v0.77: 素材クレジット表記 (CC-BY 系は必須) */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border-strong)', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          <div>{t('sound.credit')}:</div>
          <div>・{' '}
            <a href="https://taira-komori.net/freesounden.html" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>Taira Komori</a>
            {' '}(CC-BY 4.0)
          </div>
          <div>・Freesound (CC-BY):{' '}
            <a href="https://freesound.org/s/185846/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LloydEvans09</a>{', '}
            <a href="https://freesound.org/s/658431/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>deathbyfairydust</a>{', '}
            <a href="https://freesound.org/s/270404/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LittleRobotSoundFactory</a>
          </div>
          <div>・Freesound (CC0):{' '}
            <a href="https://freesound.org/s/320181/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>dland</a>{', '}
            <a href="https://freesound.org/s/721502/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>BaggoNotes</a>{', '}
            <a href="https://freesound.org/s/817568/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>SilverDubloons</a>
          </div>
        </div>
      </div>
    </>
  );
}
