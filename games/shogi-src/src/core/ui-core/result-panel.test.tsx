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
  it('★モード選択へ戻れる。ただし置き場所は他の戻る導線と同じ並び（v1.43）', () => {
    finishedGame();
    const { container } = render(<App variant="b" />);
    const btn = screen.getByText('モード選択');
    // 終局パネルの中ではなく、対局画面のヘッダの戻る導線の並びに置く
    // （2026-08-17 ユーザー判断＝戻る先を選ぶ操作は同じ場所に集める）。
    expect(container.querySelector('.floating-result')?.contains(btn)).toBe(false);
    expect(btn.closest('.header-tools')).not.toBeNull();
  });

  it('モード選択は対局中でも押せる（終局していなくても戻れる）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    render(<App variant="b" />);
    expect(screen.getByText('モード選択')).toBeInTheDocument();
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
