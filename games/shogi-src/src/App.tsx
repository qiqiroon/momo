import { GameScreen } from './core/ui-core/GameScreen';

interface AppProps {
  variant: 'a' | 'b';
}

export function App({ variant }: AppProps) {
  return <GameScreen variant={variant} />;
}
