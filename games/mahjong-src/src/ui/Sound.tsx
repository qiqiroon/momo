// 音の画面：最初の操作で出す「音楽を再生しますか？」・歯車の設定（BGM と効果音の音量・ミュート・クレジット）。
// 作りは MOMO Shogi（MusicPrompt.tsx・SettingsPopup.tsx）と花札にそろえる。

import { useRef, useState } from 'react';
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
import { APP_VERSION } from '../version';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** 音量のつまみとミュートの 2 行（確認の窓と歯車で同じものを使う）。onMuteTouched＝ミュートを手で切り替えたとき */
function VolumeRows({ t, onMuteTouched }: { t: T; onMuteTouched?: (kind: 'bgm' | 'sfx') => void }) {
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
      {row(t('bgmLabel'), bgmV, (n) => (setBgmV(n), setBgmVolume(n)), bgmM, (b) => (setBgmM(b), setBgmMuted(b), onMuteTouched?.('bgm')), 'vol-bgm')}
      {row(t('sfxLabel'), sfxV, (n) => (setSfxV(n), setSfxVolume(n)), sfxM, (b) => (setSfxM(b), setSfxMuted(b), onMuteTouched?.('sfx')), 'vol-sfx')}
    </>
  );
}

/** 最初の操作で出す確認。どちらを選んでも音の出口は開ける（再生しない＝ミュート。あとで歯車から外せば鳴る） */
export function SoundPrompt({ t, onDone }: { t: T; onDone: () => void }) {
  // この窓で手で切り替えたミュートは「再生する」でも外さない。触っていない分は外してよい（訂正26101113）
  const touched = useRef({ bgm: false, sfx: false });
  const choose = async (play: boolean) => {
    if (!play || !touched.current.bgm) setBgmMuted(!play);
    if (!play || !touched.current.sfx) setSfxMuted(!play);
    await resumeAudio();
    preloadAllSamples();
    onDone();
  };
  return (
    <div className="sound-backdrop" role="dialog" aria-modal="true" aria-label={t('soundPromptTitle')}>
      <div className="sound-panel">
        <h2>{t('soundPromptTitle')}</h2>
        <p>{t('soundPromptBody')}</p>
        <VolumeRows t={t} onMuteTouched={(k) => (touched.current[k] = true)} />
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

/** 歯車の設定：音量・ミュート・クレジット */
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

/** クレジット（Cosmos と同じ並び）。猫語のときも系統言語で出す。
 *  音は音源の台帳と同じ内容（CC BY は作者名・ライセンスへのリンク・改変したことを示す＝利用条件） */
function Credits({ t }: { t: T }) {
  return (
    <div className="credit-body">
      <h3>{t('creditsApp')}</h3>
      <p>
        MOMO Mahjong {APP_VERSION}
        <br />
        MOMO Works
      </p>
      <h3>Special Thanks</h3>
      <p>Satomi</p>
      <h3>{t('creditsTiles')}</h3>
      <p>
        lietxia「mahjong_graphic」 —{' '}
        <a href="https://github.com/lietxia/mahjong_graphic" target="_blank" rel="noopener">
          github.com/lietxia/mahjong_graphic
        </a>
      </p>
      <h3>BGM</h3>
      <p>{t('creditsBgm')}</p>
      <h3>{t('creditsSe')}</h3>
      <p>
        ノタの森 (Nota no Mori) —{' '}
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">
          CC BY 3.0
        </a>{' '}
        —{' '}
        <a href="http://notanomori.net/" target="_blank" rel="noopener">
          notanomori.net
        </a>
        <br />
        <small>{t('creditsModified')}</small>
        <br />
        Taira Komori「temple_bell1」 — CC BY 4.0 —{' '}
        <a href="https://taira-komori.net/freesounden.html" target="_blank" rel="noopener">
          taira-komori.net
        </a>
        <br />
        LittleRobotSoundFactory「Achievement Orchestral (uplifting)」(Freesound) — CC BY —{' '}
        <a href="https://freesound.org/s/270404/" target="_blank" rel="noopener">
          freesound.org/s/270404
        </a>
        <br />
        <a href="https://soundeffect-lab.info/" target="_blank" rel="noopener">
          soundeffect-lab.info
        </a>
      </p>
    </div>
  );
}
