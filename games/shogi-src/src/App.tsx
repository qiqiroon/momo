import { useEffect, useState } from 'react';
import { RootView } from './core/ui-core/RootView';
import { MusicPrompt } from './core/ui-core/MusicPrompt';
import { DebugPanel } from './core/ui-core/DebugPanel';
import { bindVisibility } from './core/audio/visibility';
import { suspendAudio } from './core/audio/audio-engine';

interface AppProps {
  variant: 'a' | 'b';
}

/**
 * v0.72: 音楽再生確認モーダル (Darts 準拠) を最初の pointerdown/keydown で表示する。
 * さらに 1 時間以上アウトフォーカス後の復帰でも再表示する (visibility.ts と連携)。
 */
export function App({ variant }: AppProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [gestureBound, setGestureBound] = useState(false);

  useEffect(() => {
    if (gestureBound) return;
    setGestureBound(true);
    const show = () => {
      setPromptOpen(true);
      document.removeEventListener('pointerdown', show);
      document.removeEventListener('keydown', show);
    };
    document.addEventListener('pointerdown', show, { once: true });
    document.addEventListener('keydown', show, { once: true });

    // 長期停止 (1 時間以上) 復帰時は音を止めたままモーダルを再表示させる
    bindVisibility(() => {
      suspendAudio();
      setPromptOpen(true);
    });
  }, [gestureBound]);

  return (
    <>
      <RootView variant={variant} />
      <MusicPrompt open={promptOpen} onClose={() => setPromptOpen(false)} />
      <DebugPanel />
    </>
  );
}
