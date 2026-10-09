// 対局の演出の検査：リーチは「流れる帯」→「中央の大きな文字」の 2 段、ほかは中央だけ。勝利はくす玉
import { act, render } from '@testing-library/react';
import { translate, type MessageKey } from '../i18n/strings';
import { Effects } from './Effects';

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('ja', k, v);

describe('対局の演出', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('リーチは手牌の高さで「リーチ」が流れ、1 秒後に中央へ大きく出て、消える', () => {
    render(<Effects t={t} banner={{ kind: 'riichi', seat: 1, key: 1 }} kusudama={false} />);
    expect(document.querySelector('.fx-slide')).toHaveTextContent('リーチ');
    expect(document.querySelector('.fx-flash')).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(document.querySelector('.fx-slide')).toBeNull();
    expect(document.querySelector('.fx-flash.fx-riichi')).toHaveTextContent('リーチ');
    act(() => vi.advanceTimersByTime(1700));
    expect(document.querySelector('.fx-flash')).toBeNull();
  });

  it('親決め：サイコロ 2 つが転がり、0.9 秒で止まって目と起家を出し、配る前に消える', () => {
    render(<Effects t={t} banner={{ kind: 'dice', dice: [3, 4], seat: 2, key: 1 }} kusudama={false} />);
    expect(document.querySelector('.fx-dice-faces.rolling')).toHaveTextContent('⚂⚃');
    expect(document.querySelector('.fx-dice-result')).toBeNull();
    act(() => vi.advanceTimersByTime(900));
    expect(document.querySelector('.fx-dice-faces.rolling')).toBeNull();
    expect(document.querySelector('.fx-dice-result')).toHaveTextContent('CPU 2が起家です');
    act(() => vi.advanceTimersByTime(1200));
    expect(document.querySelector('.fx-dice')).toBeNull();
  });

  it('ロン・振り込み・勝利は中央に出る。勝利はくす玉', () => {
    const { rerender } = render(<Effects t={t} banner={{ kind: 'ron', key: 1 }} kusudama={false} />);
    expect(document.querySelector('.fx-flash.fx-ron')).toHaveTextContent('ロン！');
    rerender(<Effects t={t} banner={{ kind: 'dealIn', key: 2 }} kusudama={false} />);
    expect(document.querySelector('.fx-flash.fx-dealIn')).toHaveTextContent('振り込み');
    rerender(<Effects t={t} banner={{ kind: 'win', key: 3 }} kusudama />);
    expect(document.querySelector('.fx-flash.fx-win')).toHaveTextContent('勝利！');
    expect(document.querySelectorAll('.fx-confetti span')).toHaveLength(64);
  });
});
