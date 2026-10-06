import { render, screen } from '@testing-library/react';
import { App } from './App';
import { APP_VERSION } from './version';

describe('段階0の仮の画面', () => {
  it('アプリ名と版番号が出る', () => {
    render(<App />);
    expect(screen.getByRole('heading')).toHaveTextContent('MOMO Mahjong');
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
  });
});
