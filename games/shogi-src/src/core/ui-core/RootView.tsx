import { useEffect, type ComponentType } from 'react';
import { get as pluginGet } from '../plugin/registry';
import { useRouteStore } from '../store/route-store';
import { GameScreen } from './GameScreen';
import { OfflineRuleScreen } from './OfflineRuleScreen';
import { AiSetupScreen } from './AiSetupScreen';
import { KifuGuardDialog } from './KifuGuardDialog';
import { SaveNoticeDialog } from './SaveNoticeDialog';
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

  return (
    <>
      {renderScreen(screen, variant)}
      {/* 棋譜を捨てる前の確認 (親 §9.2.3 ②)。**画面のいちばん外側に置く**＝
          どの画面から呼ばれても同じ物が出て、途中の入れ物の重なり順に埋もれない。 */}
      <KifuGuardDialog />
      {/* 「保存しました」の知らせ (親 §9.2.3 ③)。保存の入口は 3 つあるが、
          出るものは 1 つ＝同じことを 3 か所で別々に作らない。 */}
      <SaveNoticeDialog />
    </>
  );
}

function renderScreen(screen: string, variant: 'a' | 'b') {
  if (screen === 'game') {
    return <GameScreen variant={variant} />;
  }
  if (screen === 'offline-rule') {
    return <OfflineRuleScreen variant={variant} />;
  }
  if (screen === 'ai-setup') {
    return <AiSetupScreen />;
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
