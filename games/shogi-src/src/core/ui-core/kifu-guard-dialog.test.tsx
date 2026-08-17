import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { clear as clearPlugins, register } from '../plugin/registry';
import { useI18nStore } from '../store/i18n-store';
import { requestNewGame, useKifuGuardStore } from '../store/kifu-guard';
import { KifuGuardDialog } from './KifuGuardDialog';

/**
 * 棋譜を捨てる前の確認の見た目（付録D-8 §7.1）。
 *
 * ここで固定したいのは 2 点。
 *   - **緑を使わない**＝「まだ保存されていません」は注意の文言なのに、緑は
 *     「済んでいる・問題ない」を意味する。**文言と色が逆のことを言っていた**
 *   - **押せるボタンを灰色にしない**＝**灰色は「押せない」だけを意味する**
 */

beforeEach(() => {
  clearPlugins();
  useI18nStore.setState({ locale: 'ja' });
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
  register('kifu:state', () => 'unsaved');
});

afterEach(() => {
  clearPlugins();
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
});

describe('棋譜の確認ダイアログの見た目（付録D-8 §7.1）', () => {
  it('★引分（緑）の見た目を借りない＝棋譜専用の色で出す', () => {
    requestNewGame(() => {});
    const { container } = render(<KifuGuardDialog />);
    const panel = container.querySelector('.floating-result');
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains('draw')).toBe(false);
    expect(panel!.classList.contains('kifu')).toBe(true);
  });

  it('★3 つとも押せる見た目にする（やめる・破棄するも灰色のまま出さない）', () => {
    requestNewGame(() => {});
    const { container } = render(<KifuGuardDialog />);
    const btns = [...container.querySelectorAll('.btn')];
    expect(btns.map((b) => b.textContent)).toEqual(['やめる', '破棄する', '保存する']);
    // 副次の 2 つは白文字白枠、主動作の「保存する」はオレンジ地のまま。
    for (const b of btns.filter((x) => x.classList.contains('ghost'))) {
      expect(b.classList.contains('outline')).toBe(true);
    }
    expect(btns.filter((b) => !b.classList.contains('ghost'))).toHaveLength(1);
  });
});
