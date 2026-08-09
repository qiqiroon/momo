import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppHeight } from './ui/appHeight';
import './styles.css';

const container = document.getElementById('app');
if (!container) throw new Error('#app が見つかりません');

// **最初の一描き目から実測の高さで組む**（C-207）。土台が現れてから測ると、
// 携帯の横画面では一瞬だけ大きすぎる器で描かれ、そのまま寸法が持ち越されることがある
applyAppHeight(window);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
