import { RootView } from './core/ui-core/RootView';

interface AppProps {
  variant: 'a' | 'b';
}

export function App({ variant }: AppProps) {
  return <RootView variant={variant} />;
}
