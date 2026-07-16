import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import { getBgmVolume, getSfxVolume, setBgmVolume, setSfxVolume } from '../audio/audio-engine';

/**
 * v0.73: 歯車ボタンから開く設定ポップアップ (Darts 準拠)。
 *  v0.78: クレジットボタン + 別モーダルに変更 (CC-BY のみ表示、CC0 は義務なしで割愛)。
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
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setBgmV(getBgmVolume());
      setSfxV(getSfxVolume());
      setCreditsOpen(false); // 開き直したときは初期状態に戻す
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
        {/* v0.80: ボタン → リンク風テキストに変更 */}
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <a
            href="#credits"
            onClick={(e) => { e.preventDefault(); setCreditsOpen(true); }}
            style={{
              fontSize: 11, color: 'var(--text-muted)',
              textDecoration: 'underline', cursor: 'pointer',
            }}
          >
            {t('sound.creditsButton')}
          </a>
        </div>
      </div>
      {creditsOpen && <CreditsModal onClose={() => setCreditsOpen(false)} t={t} />}
    </>
  );
}

/**
 * v0.78: クレジット別モーダル。CC-BY で表示義務のある提供者のみを掲載する
 * (CC0 は法的義務なしのため割愛)。
 */
function CreditsModal({ onClose, t }: { onClose: () => void; t: (k: string) => string }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500 }}
      />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 501, background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 12, padding: '18px 20px', maxWidth: 380, width: '90vw',
          maxHeight: '80vh', overflowY: 'auto', color: 'var(--text)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>
          {t('sound.creditsTitle')}
        </div>
        {/* v0.80: ライセンス別にまとめて列挙 */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 2 }}>CC-BY 4.0:</div>
            <div>
              <a href="https://taira-komori.net/freesounden.html" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>Taira Komori</a>
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 2 }}>CC-BY (Freesound):</div>
            <div>
              <a href="https://freesound.org/s/185846/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LloydEvans09</a>{', '}
              <a href="https://freesound.org/s/658431/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>deathbyfairydust</a>{', '}
              <a href="https://freesound.org/s/270404/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LittleRobotSoundFactory</a>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 14, width: '100%', padding: '8px 12px',
            background: 'var(--orange)', border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {t('sound.creditsClose')}
        </button>
      </div>
    </>
  );
}
