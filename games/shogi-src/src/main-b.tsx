import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './core/ui-core/styles.css';
import './momo-lang/init';
import './features/cat-lang';
import './features/matchmaking';
import './features/quantum';
import { App } from './App';
import { useRouteStore } from './core/store/route-store';
import { useGameStore } from './core/store/game-store';

// v0.90: Phase 5 の DoD 検証用に、dev モードでのみ主要 store を window に露出する。
// ブラウザ検証は「量子 ON で候補集合が付いているか」等の観測が必要になるため、
// ここで一箇所に集約する (本番ビルドでは import.meta.env.DEV=false で除外される)。
if (import.meta.env.DEV) {
  (globalThis as { __momoShogi?: unknown }).__momoShogi = { useGameStore };
}

useRouteStore.getState().setScreen('lobby');

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App variant="b" />
    </StrictMode>,
  );
}
