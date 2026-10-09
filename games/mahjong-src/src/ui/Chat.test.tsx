// チャット欄の検査（いまは場所と文字を打つ所だけ＝打った文字が自分の画面に出る）
import { fireEvent, render, screen } from '@testing-library/react';
import { translate, type MessageKey } from '../i18n/strings';
import { Chat } from './Chat';

const t = (k: MessageKey) => translate('ja', k);

describe('チャット欄', () => {
  it('打って送ると自分の名前つきで欄に出て、打つ所は空に戻る。空のままでは何も出ない', () => {
    render(<Chat t={t} you="あなた" />);
    const box = screen.getByPlaceholderText('メッセージ') as HTMLInputElement;
    fireEvent.click(screen.getByText('送信'));
    expect(document.querySelectorAll('.chat-log p')).toHaveLength(0);
    fireEvent.change(box, { target: { value: 'よろしく' } });
    fireEvent.click(screen.getByText('送信'));
    expect(document.querySelector('.chat-log')).toHaveTextContent('あなた: よろしく');
    expect(box.value).toBe('');
  });
});
