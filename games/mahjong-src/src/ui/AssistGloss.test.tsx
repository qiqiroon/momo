// アシストモード 段階5：役名からルールブックへ・用語の説明（設計 アシストモード v0.01 §4.2・§8）
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GENERAL_RULES } from '../engine/rules';
import { rulesOfCnSet } from '../engine/ruleSets';
import { translate } from '../i18n/strings';
import { yakuDescOf } from '../rulebook/desc';
import { RuleBook } from './RuleBook';
import { Gloss, useTip } from './Assist';

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('ja', k, v);

describe('役の説明の文（ルールブックと同じ文）', () => {
  it('日本式・四川・香港・国標の役の id から条件の文が取れる。無い id は null', () => {
    expect(yakuDescOf(GENERAL_RULES, 'pinfu', 'ja')).toBeTruthy();
    expect(yakuDescOf(rulesOfCnSet('sichuan'), 'qingyise', 'ja')).toBeTruthy();
    expect(yakuDescOf(rulesOfCnSet('hk'), 'hunyise', 'ja')).toBeTruthy();
    expect(yakuDescOf(rulesOfCnSet('mcr'), 'qinglong', 'ja')).toBeTruthy();
    expect(yakuDescOf(GENERAL_RULES, 'nonexistent', 'ja')).toBeNull();
  });
});

describe('役名からルールブックへ', () => {
  it('focus を渡すと役のタブで開き、その役の行を光らせる', async () => {
    vi.useFakeTimers();
    render(<RuleBook t={t} lang="ja" rules={GENERAL_RULES} first="rules" focus={{ id: 'pinfu', n: 1 }} onClose={() => {}} />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    const row = document.querySelector('.rb-row.rb-focus');
    expect(row?.getAttribute('data-ids')?.split(' ')).toContain('pinfu');
    expect(document.querySelector('.rb-body')?.getAttribute('data-tab')).toBe('yaku');
    vi.useRealTimers();
  });
});

function Probe() {
  const { api, box } = useTip();
  return (
    <>
      <Gloss tip={api} text={() => '局の数です'}>
        <span>東1局</span>
      </Gloss>
      {box}
    </>
  );
}

describe('用語の説明', () => {
  it('マウスを合わせると出て、離すと消える', () => {
    render(<Probe />);
    const g = screen.getByText('東1局').parentElement!;
    fireEvent.pointerEnter(g, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('局の数です');
    fireEvent.pointerLeave(g, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('指は長押しのあいだだけ出て、離したあとの押した扱いは止める', () => {
    vi.useFakeTimers();
    render(<Probe />);
    const g = screen.getByText('東1局').parentElement!;
    fireEvent.pointerDown(g, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('局の数です');
    fireEvent.pointerUp(g, { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(g.dataset.lp).toBe('1');
    fireEvent.click(g);
    expect(g.dataset.lp).toBeUndefined();
    vi.useRealTimers();
  });
});
