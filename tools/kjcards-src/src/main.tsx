import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/store'; // momo-lang を本体より先に初期化
import { App } from './App';
import './styles.css';
import '@xyflow/react/dist/style.css';

const el = document.getElementById('app');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
