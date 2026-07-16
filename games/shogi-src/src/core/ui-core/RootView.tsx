import { useEffect, type ComponentType } from 'react';
import { get as pluginGet } from '../plugin/registry';
import { useRouteStore } from '../store/route-store';
import { GameScreen } from './GameScreen';
import { OfflineRuleScreen } from './OfflineRuleScreen';
import { playRandomBgm, stopBgm, isAudioRunning } from '../audio/audio-engine';

interface RootViewProps {
  variant: 'a' | 'b';
}

/**
 * v0.77: 画面に応じて BGM プールを切り替える。
 * - game (S07) = 対局中プール
 * - endgame = BGM 停止 (勝敗音の邪魔をしない)
 * - それ以外 (S00〜S06 等) = ロビープール
 * AudioContext が resume されていない (音楽再生確認モーダルで「はい」を押していない)
 * 段階では何もしない。resume 後は同じ pool を返しても playRandomBgm 側で
 * 「既に鳴っていれば何もしない」ので安全。
 */
function useScreenBgm(screen: string): void {
  useEffect(() => {
    if (!isAudioRunning()) return;
    if (screen === 'endgame') { stopBgm(); return; }
    const pool: 'lobby' | 'game' = screen === 'game' ? 'game' : 'lobby';
    void playRandomBgm(pool);
  }, [screen]);
}

export function RootView({ variant }: RootViewProps) {
  const screen = useRouteStore((s) => s.screen);
  useScreenBgm(screen);

  if (screen === 'game') {
    return <GameScreen variant={variant} />;
  }
  if (screen === 'offline-rule') {
    return <OfflineRuleScreen variant={variant} />;
  }

  // features 由来の画面は plugin registry から解決 (A ビルドには存在しない)
  const key = `screen:${screen}`;
  const Comp = pluginGet<ComponentType<{ variant?: 'a' | 'b' }>>(key);
  if (Comp) {
    return <Comp variant={variant} />;
  }

  // Fallback: features 未登録 (A ビルド) → GameScreen に戻す
  return <GameScreen variant={variant} />;
}
