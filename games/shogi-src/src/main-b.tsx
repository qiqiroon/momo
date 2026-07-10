import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './core/ui-core/styles.css';
import './momo-lang/init';
import './features/cat-lang';
import './features/matchmaking';
import { App } from './App';
import { useRouteStore } from './core/store/route-store';

useRouteStore.getState().setScreen('lobby');

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App variant="b" />
    </StrictMode>,
  );
}
