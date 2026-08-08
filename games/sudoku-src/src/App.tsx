/**
 * アプリの入口。
 *
 * 段階5 の確認用 仮画面は、段階6 で本物の画面（`ui/components/AppShell`）へ置き換えた。
 * 計測用の入口（`window.__sudokuHarness`）も、その際に廃止した。
 */

import { AppShell } from './ui/components/AppShell';

export function App(): React.ReactElement {
  return <AppShell />;
}
