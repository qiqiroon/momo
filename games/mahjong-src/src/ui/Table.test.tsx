// 卓の画面の検査（段階2）：ドラ表示牌と、ツモアガリの役・点数の表示。
// 局面は自動対局の打ち手で実際に回した出来事の列から作る（画面用に作った局面ではない）。
import { render, screen } from '@testing-library/react';
import { benchCpu } from '../cpu/bench';
import { viewFor } from '../engine/state';
import { playOne } from '../selfplay/run';
import { GENERAL_RULES } from '../engine/rules';
import { Table } from './Table';

/** ツモアガリで終わる局を種を替えながら探す（検査用の打ち手は 1 割ほどアガる） */
function wonLog() {
  for (let i = 0; i < 200; i++) {
    const r = playOne(`table-${i}`, GENERAL_RULES, benchCpu);
    if (r.ending === 'tsumo' && !r.failure) return r.log;
  }
  throw new Error('ツモアガリの局が見つからない');
}

describe('卓の画面（段階2）', () => {
  it('ツモアガリの結果に、役・翻・符・支払い・合計が出る（日本語）', () => {
    const view = viewFor(wonLog(), 0);
    if (view.result?.type !== 'tsumo') throw new Error('ツモアガリのはず');
    const score = view.result.score;
    render(<Table view={view} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('門前清自摸和')).toBeInTheDocument(); // 鳴きの無い段階2のツモには必ず付く
    expect(screen.getByText(`合計 ${score.total}点`)).toBeInTheDocument();
    expect(document.querySelector('.score-level')!.textContent).toMatch(/翻|役満/);
    expect(document.querySelector('.score-pay')!.textContent).toMatch(/点/);
    // アガリ牌は手牌の右に離して印を付ける
    expect(document.querySelectorAll('.result-hand .win-tile')).toHaveLength(1);
    // ドラ表示牌が出ている
    expect(document.querySelector('.dora-ind')).not.toBeNull();
  });

  it('英語・中国語でも役の名前と合計が出る', () => {
    const view = viewFor(wonLog(), 0);
    if (view.result?.type !== 'tsumo') throw new Error('ツモアガリのはず');
    const { unmount } = render(<Table view={view} legal={[]} lang="en" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('Menzen Tsumo')).toBeInTheDocument();
    expect(screen.getByText(`Total ${view.result.score.total}`)).toBeInTheDocument();
    unmount();
    render(<Table view={view} legal={[]} lang="zh" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('门前清自摸和')).toBeInTheDocument();
    expect(screen.getByText(`合计 ${view.result.score.total}点`)).toBeInTheDocument();
  });
});
