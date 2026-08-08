/**
 * 盤面が「測り終わる」まで待つ（第14セッションで判明）
 *
 * `findByTestId('board')` が返るのは**盤面の枠が現れた時点**であって、
 * まだ実寸は分かっていない。実寸は `BoardCanvas` の副作用が測って上へ通知するが、
 * これは描画の確定より後に走る。
 *
 * この一拍を待たずに倍率や表示LOD を読むと、**測る前の仮置き（1×1px ＝ 最小倍率）**を掴む。
 * 段階7 以来この待ちが無く、**他の検査と一緒に走ったときだけ偶然通っていた**ため、
 * 走らせるたびに落ちる場所が入れ替わっていた。
 *
 * 盤面を出したあとに何かを確かめる検査は、**必ずこれを挟むこと。**
 */

import { act, fireEvent, screen } from '@testing-library/react';
import { t } from '../i18n/locale';

export async function settleBoard(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 「音を鳴らしますか？」に答えてしまう（⑧ / C-180）
 *
 * この問いかけは**起動した瞬間には出ず、最初のひと押しを横取りして出る。**
 * 置いたままだと、検査の最初のひと押しが毎回これに食われるうえ、
 * 「ほかにダイアログが出ていないこと」を見る検査も軒並み引っかかる。
 *
 * そこで**無害なひと押しを1つ捨てて問いかけを出し、その場で答えてしまう。**
 * 音そのものを見る検査だけが、この問いかけを自分で扱えばよい。
 */
export function answerSoundAsk(play = false): void {
  const label = play ? t('dialog.sound.yes') : t('dialog.sound.no');
  let button = screen.queryByRole('button', { name: label });
  if (button === null) {
    // 横取りの構えを、どこにも効かないひと押しで解く
    fireEvent.click(document.body);
    button = screen.queryByRole('button', { name: label });
  }
  if (button !== null) fireEvent.click(button);
}
