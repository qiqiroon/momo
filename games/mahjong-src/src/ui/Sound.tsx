// 音の画面：最初の操作で出す「音楽を再生しますか？」・歯車の設定（BGM と効果音の音量・ミュート・音源クレジット）。
// 作りは MOMO Shogi（MusicPrompt.tsx・SettingsPopup.tsx）と花札にそろえる。

import { useState } from 'react';
import {
  getBgmMuted,
  getBgmVolume,
  getSfxMuted,
  getSfxVolume,
  preloadAllSamples,
  resumeAudio,
  setBgmMuted,
  setBgmVolume,
  setSfxMuted,
  setSfxVolume,
} from '../audio/engine';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** 音量のつまみとミュートの 2 行（確認の窓と歯車で同じものを使う） */
function VolumeRows({ t }: { t: T }) {
  const [bgmV, setBgmV] = useState(getBgmVolume);
  const [sfxV, setSfxV] = useState(getSfxVolume);
  const [bgmM, setBgmM] = useState(getBgmMuted);
  const [sfxM, setSfxM] = useState(getSfxMuted);
  const row = (label: string, v: number, onV: (n: number) => void, m: boolean, onM: (b: boolean) => void, cls: string) => (
    <div className={`vol-row ${cls}`}>
      <span className="vol-label">{label}</span>
      <input type="range" min="0" max="100" value={v} onChange={(e) => onV(Number(e.target.value))} aria-label={label} />
      <span className="vol-value">{v}%</span>
      <label className="vol-mute">
        <input type="checkbox" checked={m} onChange={(e) => onM(e.target.checked)} />
        {t('mute')}
      </label>
    </div>
  );
  return (
    <>
      {row(t('bgmLabel'), bgmV, (n) => (setBgmV(n), setBgmVolume(n)), bgmM, (b) => (setBgmM(b), setBgmMuted(b)), 'vol-bgm')}
      {row(t('sfxLabel'), sfxV, (n) => (setSfxV(n), setSfxVolume(n)), sfxM, (b) => (setSfxM(b), setSfxMuted(b)), 'vol-sfx')}
    </>
  );
}

/** 最初の操作で出す確認。どちらを選んでも音の出口は開ける（再生しない＝ミュート。あとで歯車から外せば鳴る） */
export function SoundPrompt({ t, onDone }: { t: T; onDone: () => void }) {
  const choose = async (play: boolean) => {
    setBgmMuted(!play);
    setSfxMuted(!play);
    await resumeAudio();
    preloadAllSamples();
    onDone();
  };
  return (
    <div className="sound-backdrop" role="dialog" aria-modal="true" aria-label={t('soundPromptTitle')}>
      <div className="sound-panel">
        <h2>{t('soundPromptTitle')}</h2>
        <p>{t('soundPromptBody')}</p>
        <VolumeRows t={t} />
        <div className="sound-actions">
          <button type="button" className="btn-primary sound-yes" onClick={() => void choose(true)}>
            {t('soundYes')}
          </button>
          <button type="button" className="btn-secondary sound-no" onClick={() => void choose(false)}>
            {t('soundNo')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 歯車の設定：音量・ミュート・音源クレジット */
export function SettingsPanel({ t, onClose }: { t: T; onClose: () => void }) {
  const [credits, setCredits] = useState(false);
  return (
    <div className="sound-backdrop" role="dialog" aria-modal="true" aria-label={t('settingsTitle')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sound-panel">
        <h2>{credits ? t('creditsTitle') : t('settingsTitle')}</h2>
        {credits ? (
          <Credits t={t} />
        ) : (
          <>
            <VolumeRows t={t} />
            <a
              href="#credits"
              className="credit-link"
              onClick={(e) => {
                e.preventDefault();
                setCredits(true);
              }}
            >
              {t('creditsButton')}
            </a>
          </>
        )}
        <div className="sound-actions">
          {credits && (
            <button type="button" className="btn-secondary" onClick={() => setCredits(false)}>
              {t('backBtn')}
            </button>
          )}
          <button type="button" className="btn-secondary sound-close" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 音源クレジット（CC BY は作者名・ライセンスへのリンク・改変したことを示す＝利用条件） */
function Credits({ t }: { t: T }) {
  return (
    <div className="credit-body">
      <p>
        <a href="http://notanomori.net/" target="_blank" rel="noopener">
          ノタの森 (Nota no Mori)
        </a>{' '}
        —{' '}
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">
          CC BY 3.0
        </a>
        <br />
        <small>{t('creditsModified')}</small>
      </p>
      <p>
        {t('creditsShared')}:{' '}
        <a href="https://taira-komori.net/freesounden.html" target="_blank" rel="noopener">
          Taira Komori
        </a>{' '}
        (CC BY 4.0) /{' '}
        <a href="https://freesound.org/s/270404/" target="_blank" rel="noopener">
          LittleRobotSoundFactory
        </a>{' '}
        (CC BY) /{' '}
        <a href="https://freesound.org/s/658431/" target="_blank" rel="noopener">
          deathbyfairydust
        </a>{' '}
        (CC BY)
      </p>
      <p>{t('creditsBgm')}</p>
    </div>
  );
}
