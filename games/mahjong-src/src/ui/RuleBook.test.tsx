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

  it('中国式の番の一覧は数え方で切り替わり、ルールで付かない番は「付きません」', () => {
    const { unmount } = render(<RuleBook t={t} lang="ja" rules={rulesOfCnSet('sichuan')} onClose={() => {}} />);
    expect(screen.getByText('根')).toBeInTheDocument();
    expect(screen.queryByText('平糊')).toBeNull();
    unmount();
    const hk = rulesOfCnSet('hk');
    if (hk.family !== 'cn') throw new Error('中国式のはず');
    render(<RuleBook t={t} lang="ja" rules={{ family: 'cn', values: { ...hk.values, tenhou: 'off' } }} onClose={() => {}} />);
    const row = screen.getByText('天糊・地糊').closest('.rb-row')!;
    expect(row).toHaveClass('off');
    expect(row).toHaveTextContent('いまのルールでは付きません');
    expect(screen.getByText('平糊').closest('.rb-row')).not.toHaveClass('off');
  });

  it('国標は 88 番から順に並び、花牌は「1枚ごと」。花牌なしのルールでは付かない', () => {
    const mcr = rulesOfCnSet('mcr');
    if (mcr.family !== 'cn') throw new Error('中国式のはず');
    const { container } = render(<RuleBook t={t} lang="ja" rules={{ family: 'cn', values: { ...mcr.values, flower: 'off' } }} onClose={() => {}} />);
    const secs = [...container.querySelectorAll('.rb-sec')].map((x) => x.textContent);
    expect(secs[0]).toBe('88番');
    expect(secs[secs.length - 1]).toBe('1番');
    expect(container.querySelectorAll('.rb-row')).toHaveLength(75);
    const flower = screen.getByText('花牌').closest('.rb-row')!;
    expect(flower).toHaveClass('off');
  });

  it('いまのルール（Q9=A）：設定画面と同じまとまりで畳んで出し、セットから変えた項目はオレンジ（基にしたセットは一番近いセット）', () => {
    if (GENERAL_RULES.family !== 'jp') throw new Error('日本式のはず');
    const { container } = render(<RuleBook t={t} lang="ja" rules={{ family: 'jp', values: { ...GENERAL_RULES.values, aka: 'off' } }} first="rules" onClose={() => {}} />);
    expect(screen.getByText('現在のルール：カスタムルール')).toBeInTheDocument();
    expect(container.querySelector('.rb-body')).toHaveTextContent('カスタムルール（「一般ルール」から変更）');
    // 最初は畳む。ドラ・役のまとまりを開くと、変えた赤ドラがオレンジ（changed）
    expect(container.querySelectorAll('.rb-body .set-row')).toHaveLength(0);
    fireEvent.click(screen.getByText(/ドラ・役/));
    const aka = [...container.querySelectorAll('.rb-body .set-row')].find((r) => r.textContent?.startsWith('赤ドラ'))!;
    expect(aka).toHaveClass('changed');
    expect(aka).toHaveTextContent('なし');
    // ルールブックの中には「ルールブック」のボタンやセットのボタンを出さない
    expect(container.querySelector('.rb-body .rb-open')).toBeNull();
    expect(container.querySelector('.rb-body .sets')).toBeNull();
  });

  it('いまのルール：中国式も出る', () => {
    render(<RuleBook t={t} lang="ja" rules={rulesOfCnSet('hk')} first="rules" onClose={() => {}} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent(t('set_hk'));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('変更 0');
  });

  it('ほかの日本式のセットはその名前', () => {
    render(<RuleBook t={t} lang="ja" rules={rulesOfSet('tenhou')} first="howto" onClose={() => {}} />);
    expect(screen.getByText(`現在のルール：${t('set_tenhou')}`)).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tab', 'howto');
  });
});
