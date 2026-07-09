import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './core/ui-core/styles.css';
import { App } from './App';

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App variant="a" />
    </StrictMode>,
  );
}
