import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import { getBgmVolume, getSfxVolume, setBgmVolume, setSfxVolume } from '../audio/audio-engine';
import { useDebugStore } from '../store/debug-store';

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
        <DebugPanelLink onOpen={onClose} />
      </div>
      {creditsOpen && <CreditsModal onClose={() => setCreditsOpen(false)} t={t} />}
    </>
  );
}

/**
 * v0.91: `?debug=1` が付いている時だけ現れる「デバッグパネル」リンク。
 * クリックすると SettingsPopup を閉じて DebugPanel を開く。
 */
function DebugPanelLink({ onOpen }: { onOpen: () => void }) {
  const enabled = useDebugStore((s) => s.enabled);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  if (!enabled) return null;
  return (
    <div style={{ marginTop: 8, textAlign: 'right' }}>
      <a
        href="#debug"
        onClick={(e) => { e.preventDefault(); setPanelOpen(true); onOpen(); }}
        style={{
          fontSize: 11, color: 'var(--orange)',
          textDecoration: 'underline', cursor: 'pointer',
        }}
      >
        デバッグパネル
      </a>
    </div>
  );
}

/**
 * v0.78: クレジット別モーダル。CC-BY で表示義務のある提供者のみを掲載する
 * (CC0 は法的義務なしのため割愛)。
 * v0.81: タイトルを削除、ライセンス別を横並び (太字なし・改行なし)、閉じるボタンを地味に。
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
          borderRadius: 10, padding: '14px 16px', maxWidth: 380, width: '90vw',
          maxHeight: '80vh', overflowY: 'auto', color: 'var(--text)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          CC-BY 4.0:{' '}
          <a href="https://taira-komori.net/freesounden.html" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>Taira Komori</a>
          {' / '}
          CC-BY (Freesound):{' '}
          <a href="https://freesound.org/s/185846/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LloydEvans09</a>{', '}
          <a href="https://freesound.org/s/658431/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>deathbyfairydust</a>{', '}
          <a href="https://freesound.org/s/270404/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LittleRobotSoundFactory</a>
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '4px 12px',
              background: 'transparent', border: '1px solid var(--border-strong)',
              borderRadius: 6, color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
            }}
          >
            {t('sound.creditsClose')}
          </button>
        </div>
      </div>
    </>
  );
}
