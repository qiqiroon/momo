// 鳴ける牌の欄の「自動で鳴く｜鳴かない」（訂正26101113 Q3=B）：切り替えは欄の見出しの右。鳴かないのあいだは牌の一覧を出さない
import { fireEvent, render, screen } from '@testing-library/react';
import { translate, type MessageKey } from '../i18n/strings';
import type { OnlineTable } from '../online/table';
import { CallStrip } from './CallStrip';

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('ja', k, v);

function fakeTable(phase: string) {
  const tb = {
    mySeat: 0,
    dealing: false,
    noCalls: false,
    view: { phase, rules: undefined },
    presets: new Map(),
    callables: () => [{ kind: 0, ron: false, pon: true, kan: false, chi: [] }],
    setNoCalls(on: boolean) {
      tb.noCalls = on;
    },
    setPreset() {},
  };
  return tb;
}

describe('鳴ける牌の欄の切り替え', () => {
  it('自動で鳴く：牌の一覧が出る。鳴かないを押すと一覧が消えて説明だけ・端末に覚える', () => {
    const tb = fakeTable('draw');
    const { rerender } = render(<CallStrip t={t} table={tb as unknown as OnlineTable} />);
    expect(screen.getByRole('button', { name: '自動で鳴く' })).toHaveClass('on');
    expect(document.querySelectorAll('.ps-tile')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '鳴かない' }));
    expect(tb.noCalls).toBe(true);
    expect(localStorage.getItem('momo-mahjong.online.noCalls')).toBe('1');
    rerender(<CallStrip t={t} table={tb as unknown as OnlineTable} />);
    expect(screen.getByRole('button', { name: '鳴かない' })).toHaveClass('on');
    expect(document.querySelectorAll('.ps-tile')).toHaveLength(0);
    expect(screen.getByText(/ロンできるときは止まります/)).toBeInTheDocument();
    localStorage.removeItem('momo-mahjong.online.noCalls');
  });

  it('局と局の間も切り替えは出す（牌の一覧は出さない）', () => {
    render(<CallStrip t={t} table={fakeTable('ended') as unknown as OnlineTable} />);
    expect(screen.getByRole('button', { name: '鳴かない' })).toBeInTheDocument();
    expect(document.querySelectorAll('.ps-tile')).toHaveLength(0);
  });
});
