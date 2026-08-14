import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './core/ui-core/styles.css';
import './momo-lang/init';
import './features/cat-lang';
import './features/matchmaking';
import './features/quantum';
import './features/torus';
import './adapters/selfmade-alphabeta';
import './adapters/mcts-adapter';
import { App } from './App';
import { register as pluginRegister } from './core/plugin/registry';
import { useRouteStore } from './core/store/route-store';
import { useGameStore } from './core/store/game-store';
import { useDebugStore } from './core/store/debug-store';

// Phase 3: AI に考えさせる別スレッドの作り方は「どの機能を積むか」を知っている
// 組み立て側 (ここ) が決める。思考ルーチン側は registry からこれを受け取るだけなので、
// トーラスや量子を知らずに済む。別スレッドを作れない環境では登録が使われないまま
// 同じスレッドで考える (答えは同じ)。
pluginRegister('ai:workerFactory', () =>
  new Worker(new URL('./ai-worker-b.ts', import.meta.url), { type: 'module' }),
);

// v0.90: Phase 5 の DoD 検証用に、dev モードでのみ主要 store を window に露出する。
// ブラウザ検証は「量子 ON で候補集合が付いているか」等の観測が必要になるため、
// ここで一箇所に集約する (本番ビルドでは import.meta.env.DEV=false で除外される)。
if (import.meta.env.DEV) {
  (globalThis as { __momoShogi?: unknown }).__momoShogi = { useGameStore, useDebugStore };
}

// v0.91: URL に ?debug=1 が付いていればデバッグモードを有効化。
// これで歯車内に「デバッグパネル」リンクが出現し、盤 PieceID 表示や
// 駒クリックログが使えるようになる。付いていなければ全機能非表示。
if (new URLSearchParams(window.location.search).get('debug') === '1') {
  useDebugStore.getState().enable();
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
