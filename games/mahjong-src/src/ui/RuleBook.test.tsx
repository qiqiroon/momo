// ルールブックの窓（2026-10-14 第17・手順1 骨組み）：タブ 3 つ・最初のタブ・ルールの名前・閉じる。
import { fireEvent, render, screen } from '@testing-library/react';
import { GENERAL_RULES } from '../engine/rules';
import { rulesOfCnSet, rulesOfSet } from '../engine/ruleSets';
import { translate, type MessageKey } from '../i18n/strings';
import { RuleBook } from './RuleBook';

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('ja', k, v);

describe('ルールブックの窓', () => {
  it('日本式：役の一覧のタブで開き、ルールの名前を出す。タブを押すと切り替わり、閉じるで閉じる', () => {
    let closed = false;
    render(<RuleBook t={t} lang="ja" rules={GENERAL_RULES} onClose={() => (closed = true)} />);
    expect(screen.getByText('現在のルール：一般ルール')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '役の一覧' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'いまのルール' }));
    expect(screen.getByRole('tab', { name: 'いまのルール' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tab', 'rules');
    fireEvent.click(screen.getByText('閉じる'));
    expect(closed).toBe(true);
  });

  it('中国式は「番の一覧」。セットから変えた値はカスタムルール', () => {
    const r = rulesOfCnSet('sichuan');
    const { unmount } = render(<RuleBook t={t} lang="ja" rules={r} onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: '番の一覧' })).toBeInTheDocument();
    expect(screen.getByText(`現在のルール：${t('set_sichuan')}`)).toBeInTheDocument();
    unmount();
    if (r.family !== 'cn') throw new Error('中国式のはず');
    render(<RuleBook t={t} lang="ja" rules={{ family: 'cn', values: { ...r.values, huan3: r.values.huan3 === 'on' ? 'off' : 'on' } }} onClose={() => {}} />);
    expect(screen.getByText('現在のルール：カスタムルール')).toBeInTheDocument();
  });

  it('ほかの日本式のセットはその名前', () => {
    render(<RuleBook t={t} lang="ja" rules={rulesOfSet('tenhou')} first="howto" onClose={() => {}} />);
    expect(screen.getByText(`現在のルール：${t('set_tenhou')}`)).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tab', 'howto');
  });
});
