// 最初の「音楽を再生しますか？」：この窓で手で付けたミュートは「再生する」でも外さない（訂正26101113）
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getBgmMuted, getSfxMuted, setBgmMuted, setSfxMuted } from '../audio/engine';
import { translate, type MessageKey } from '../i18n/strings';
import { SoundPrompt } from './Sound';

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('ja', k, v);

describe('音の確認の窓', () => {
  it('BGM のミュートを手で付けてから「再生する」：BGM はミュートのまま、触っていない効果音は鳴る', async () => {
    setBgmMuted(false);
    setSfxMuted(true);
    const done = vi.fn();
    render(<SoundPrompt t={t} onDone={done} />);
    fireEvent.click(document.querySelector('.vol-bgm input[type=checkbox]')!);
    fireEvent.click(screen.getByText('再生する'));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(getBgmMuted()).toBe(true);
    expect(getSfxMuted()).toBe(false);
  });

  it('手で付けて外したミュートも、その値のまま。「再生しない」は両方ミュート', async () => {
    setBgmMuted(true);
    setSfxMuted(false);
    const done = vi.fn();
    render(<SoundPrompt t={t} onDone={done} />);
    fireEvent.click(document.querySelector('.vol-sfx input[type=checkbox]')!);
    fireEvent.click(screen.getByText('再生しない'));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(getBgmMuted()).toBe(true);
    expect(getSfxMuted()).toBe(true);
  });
});
