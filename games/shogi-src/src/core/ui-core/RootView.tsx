import { useEffect, type ComponentType } from 'react';
import { get as pluginGet } from '../plugin/registry';
import { useRouteStore } from '../store/route-store';
import { useWakeLock } from './useWakeLock';
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
 *
 * ★v1.55 (音響 v0.8 §4・ユーザー判断 2026-08-19): **盤を並べる画面でも対局中の曲**
 * ＝**感想戦 (S11) と棋譜再生 (S08)** を追加した。**画面に居る間ずっと**であり、
 * **自動再生の入り切りでは変えない**（止めるたびに曲が入れ替わると、盤を見ながら
 * 話している場が毎回切れる）。音響 v0.3 の「S08 は呼び出し元の BGM を継承する」は
 * 撤回＝S08 は当時オーバーレイに近いものとして書かれていたが、**実装では独立した
 * 画面で盤を並べる**ので、継承の前提そのものが失われている。
 * **感想戦ロビー (S12) はロビーの曲のまま**（人を待つ画面であるため）。
 */
const BGM_GAME_SCREENS = new Set(['game', 'review', 'kifu-replay']);

function useScreenBgm(screen: string): void {
  useEffect(() => {
    if (!isAudioRunning()) return;
    if (screen === 'endgame') { stopBgm(); return; }
    const pool: 'lobby' | 'game' = BGM_GAME_SCREENS.has(screen) ? 'game' : 'lobby';
    void playRandomBgm(pool);
  }, [screen]);
}

export function RootView({ variant }: RootViewProps) {
  const screen = useRouteStore((s) => s.screen);
  useScreenBgm(screen);
  // ★v1.55: 盤を眺めている間は画面を消させない（2026-08-21 実機のご要望）。
  // **画面のいちばん外側に 1 か所だけ置く**＝画面ごとに書き足すと、新しい画面で
  // 必ず書き忘れる（観戦者のための例外も作らない＝観戦者が居るのはここに入っている画面）。
  useWakeLock(screen);

  return (
    <>
      {renderScreen(screen, variant)}
      {/* 棋譜を捨てる前の確認 (親 §9.2.3 ②)。**画面のいちばん外側に置く**＝
          どの画面から呼ばれても同じ物が出て、途中の入れ物の重なり順に埋もれない。 */}
      <KifuGuardDialog />
      {/* 「保存しました」の知らせ (親 §9.2.3 ③)。保存の入口は 3 つあるが、
          出るものは 1 つ＝同じことを 3 か所で別々に作らない。 */}
      <SaveNoticeDialog />
      {/* ★v1.59 (段3・親 §6.8.6): 観戦者に出す「感想戦へ移りますか」「対局が終わりました」。
          **画面のいちばん外側に 1 か所**＝観戦者が居る画面は 1 つではないので、
          画面ごとに置くと新しい画面で必ず書き忘れる。A ビルドには口ごと無い。 */}
      <SpectateOverlay />
    </>
  );
}

/** 通信機能を積んでいないビルドでは口ごと無い＝何も出ない（縮退）。 */
function SpectateOverlay() {
  const Comp = pluginGet<ComponentType>('overlay:spectate');
  return Comp ? <Comp /> : null;
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
