import { useEffect, useState } from 'react';
import { RootView } from './core/ui-core/RootView';
import { MusicPrompt } from './core/ui-core/MusicPrompt';
import { DebugPanel } from './core/ui-core/DebugPanel';
import { bindVisibility } from './core/audio/visibility';
import { suspendAudio } from './core/audio/audio-engine';
import { armAudioAsk, finishAudioAsk, rearmAudioAsk } from './core/audio/first-gesture';

interface AppProps {
  variant: 'a' | 'b';
}

/**
 * v0.72: 音楽再生確認モーダル (Darts 準拠) を最初の操作で表示する。
 * さらに 1 時間以上アウトフォーカス後の復帰でも再表示する (visibility.ts と連携)。
 *
 * ★v2.01: 最初の**クリック**を止めて預かり、窓で選んだあとに起こす (first-gesture.ts)。
 * 1 時間以上離れて戻ったときも、すぐ窓を出さずに**次の操作**で尋ねる (同じ仕組み)。
 */
export function App({ variant }: AppProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [gestureBound, setGestureBound] = useState(false);

  useEffect(() => {
    if (gestureBound) return;
    setGestureBound(true);
    armAudioAsk(() => setPromptOpen(true));

    // 長期停止 (1 時間以上) 復帰時は音を止めたまま、次の操作でもう一度尋ねる
    bindVisibility(() => {
      suspendAudio();
      rearmAudioAsk();
    });
  }, [gestureBound]);

  return (
    <>
      <RootView variant={variant} />
      <MusicPrompt
        open={promptOpen}
        onClose={() => {
          setPromptOpen(false);
          finishAudioAsk();
        }}
      />
      <DebugPanel />
    </>
  );
}
