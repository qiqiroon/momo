import type { ComponentType } from 'react';
import { get as pluginGet } from '../plugin/registry';
import { useRouteStore } from '../store/route-store';
import { GameScreen } from './GameScreen';

interface RootViewProps {
  variant: 'a' | 'b';
}

export function RootView({ variant }: RootViewProps) {
  const screen = useRouteStore((s) => s.screen);

  if (screen === 'game') {
    return <GameScreen variant={variant} />;
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
