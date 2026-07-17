import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import {
  getBgmVolume,
  getSfxVolume,
  setBgmVolume,
  setSfxVolume,
  resumeAudio,
  preloadAllSamples,
  playRandomBgm,
} from '../audio/audio-engine';
import { seButton } from '../audio/se-synth';
import { useRouteStore } from '../store/route-store';
import { LangSelect } from './LangSelect';

/**
 * v0.72: 音楽再生確認モーダル (Darts v2.20 準拠)。
 *
 * 起動直後 + 1 時間以上アウトフォーカス後の復帰時に表示する。
 * ユーザーがどちらかを選ぶまで閉じない (背景クリックでは閉じない)。
 * - 「再生する」: AudioContext を resume して閉じる
 * - 「再生しない」: BGM/SE 音量を 0 まで滑らかに下げて閉じる
 * どちらの選択も localStorage に永続化される。
 *
 * open/close 状態は親コンポーネント (App) から制御。
 */
interface MusicPromptProps {
  open: boolean;
  onClose: () => void;
}

export function MusicPrompt({ open, onClose }: MusicPromptProps) {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const [bgmV, setBgmV] = useState<number>(getBgmVolume());
  const [sfxV, setSfxV] = useState<number>(getSfxVolume());

  // モーダルが開くたびに現在の永続化値と同期
  useEffect(() => {
    if (open) {
      setBgmV(getBgmVolume());
      setSfxV(getSfxVolume());
    }
  }, [open]);

  if (!open) return null;

  const onBgm = (v: number) => {
    setBgmV(v);
    setBgmVolume(v);
  };
  const onSfx = (v: number) => {
    setSfxV(v);
    setSfxVolume(v);
  };

  const onYes = async () => {
    await resumeAudio();
    // v0.75: 音源サンプル (駒音等) を事前ロードしておく
    preloadAllSamples();
    seButton();
    // v0.77: 現在の画面に応じた BGM を開始 (RootView の useEffect は
    // ctx が resume されていない段階では発火していないため、ここで手動キック)
    const screen = useRouteStore.getState().screen;
    const pool: 'lobby' | 'game' = screen === 'game' ? 'game' : 'lobby';
    void playRandomBgm(pool);
    onClose();
  };
  const onNo = () => {
    // 500ms かけて 0 まで下げてから閉じる
    const t0 = performance.now();
    const startB = bgmV;
    const startS = sfxV;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 500);
      const b = Math.round(startB * (1 - k));
      const s = Math.round(startS * (1 - k));
      setBgmV(b); setBgmVolume(b);
      setSfxV(s); setSfxVolume(s);
      if (k < 1) requestAnimationFrame(step);
      else setTimeout(onClose, 200);
    };
    requestAnimationFrame(step);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 500,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) { /* 背景クリックでは閉じない */ } }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 14, padding: '20px 22px', maxWidth: 360, width: '90%',
          color: 'var(--text)', textAlign: 'center', position: 'relative',
        }}
      >
        {/* v0.86: モーダル内でも言語切替できるように右上に LangSelect を配置。
            .stage の z-index 1 スタッキング下に header の LangSelect が閉じ込められ
            モーダル (z-index 500) より下に潜ってしまうため、モーダル自身に持たせる。 */}
        <div style={{ position: 'absolute', top: 10, right: 10 }}>
          <LangSelect includeCat={true} />
        </div>
        <div style={{ fontSize: 14, marginBottom: 14, lineHeight: 1.5, paddingRight: 60 }}>
          {t('sound.promptTitle')}
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
          <span style={{ minWidth: 68, textAlign: 'left', color: 'var(--text-muted)' }}>{t('sound.bgmLabel')}</span>
          <input type="range" min="0" max="100" value={bgmV} onChange={(e) => onBgm(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--orange)' }} />
          <span style={{ minWidth: 40, textAlign: 'right' }}>{bgmV}%</span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, marginBottom: 16 }}>
          <span style={{ minWidth: 68, textAlign: 'left', color: 'var(--text-muted)' }}>{t('sound.sfxLabel')}</span>
          <input type="range" min="0" max="100" value={sfxV} onChange={(e) => onSfx(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--orange)' }} />
          <span style={{ minWidth: 40, textAlign: 'right' }}>{sfxV}%</span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onYes}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontFamily: "'Fredoka One', cursive", fontSize: 15, cursor: 'pointer' }}
          >
            {t('sound.yes')}
          </button>
          <button
            type="button"
            onClick={onNo}
            className="reset-btn"
            style={{ padding: '10px 18px', fontSize: 14 }}
          >
            {t('sound.no')}
          </button>
        </div>
      </div>
    </div>
  );
}
