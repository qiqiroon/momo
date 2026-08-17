import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { useRouteStore } from '../store/route-store';
import { useI18nStore } from '../store/i18n-store';

/**
 * 終局パネル（画面機能 §3 S07・付録D-3 §4.1）。
 *
 * ここで固定したいのは 2 点。
 *   - **モード選択へ戻る道がある**＝無いと対 AI の終局後は盤を作り直す設定画面を
 *     通るしかなく、棋譜の確認をまたいで戻ることになる（2026-08-16 ユーザー報告）
 *   - **押せるボタンは灰色にしない**＝**灰色は「押せない」だけを意味する**。
 *     押せるのに灰色だと、押せないボタンに見える
 */

function finishedGame(): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  useGameStore.getState().resign('player2');
}

beforeEach(() => {
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
});

describe('終局パネル（付録D-3 §4.1）', () => {
  it('★モード選択へ戻れる（対 AI の終局後に設定画面を通らずに済む）', () => {
    finishedGame();
    render(<App variant="b" />);
    const btn = screen.getByText('モード選択');
    expect(btn).toBeInTheDocument();
  });

  it('★押せるボタンは白文字白枠にする（灰色は「押せない」だけを意味する）', () => {
    finishedGame();
    const { container } = render(<App variant="b" />);
    const panel = container.querySelector('.floating-result');
    expect(panel).not.toBeNull();

    // 副次のボタンはすべて outline を持つ＝灰色のまま出さない。
    const ghosts = panel!.querySelectorAll('.btn.ghost');
    expect(ghosts.length).toBeGreaterThan(0);
    for (const b of ghosts) {
      expect(b.classList.contains('outline')).toBe(true);
    }
    // 主動作（もう一度対局）はオレンジ地のまま＝主従の差は残す。
    const solid = panel!.querySelectorAll('.btn:not(.ghost)');
    expect(solid.length).toBe(1);
  });
});
