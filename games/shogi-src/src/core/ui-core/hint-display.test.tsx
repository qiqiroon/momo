import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { clearUiSettings } from '../store/ui-settings';
// 量子の初期化は features 側が自己登録する。読み込まないと未確定駒が生まれず、
// 予告そのものが出ない場面になってしまう (＝何も見張っていない検査になる)。
import '../../features/quantum';

/**
 * v1.24: 移動先ヒントの切替が消すものの範囲 (ユーザー判断 2026-08-13)。
 *
 * オフにすると、行き先マスのオレンジだけでなく
 * 「その行き先なら駒がこれに決まる」という予告 (spec §4.3) も一緒に消える。
 * どちらも「そこへ動いたらどうなるか」を先に教える手助けなので、片方だけ残ると中途半端になる。
 *
 * **消えるのは表示だけ**で、指せる場所も確定の結果も変わらない。ここも一緒に固定する。
 */
function selectQuantumPiece() {
  // 量子の初期配置で 7 七 (board[6][2]) を選ぶと、桂馬跳び先などに予告が出る
  // (core/engine/foretell.test.ts と同じ場面)。
  useGameStore.getState().reset({ quantum: true, quantumDisplay: 'cycle' });
  useGameStore.getState().selectSquare({ row: 6, col: 2 });
}

describe('移動先ヒントと確定予告', () => {
  beforeEach(() => {
    clearUiSettings();
    useGameStore.getState().setHintAlwaysOn(true);
  });
  afterEach(() => {
    clearUiSettings();
    useGameStore.getState().setHintAlwaysOn(true);
    useGameStore.getState().reset({ quantum: false });
  });

  it('ヒントが ON なら、オレンジのマスと確定予告の両方が出る', () => {
    selectQuantumPiece();
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.sq.hint').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.foretell').length).toBeGreaterThan(0);
  });

  it('ヒントを OFF にすると、オレンジも確定予告も消える', () => {
    selectQuantumPiece();
    useGameStore.getState().setHintAlwaysOn(false);
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.sq.hint').length).toBe(0);
    expect(container.querySelectorAll('.foretell').length).toBe(0);
  });

  it('OFF でも指せる場所そのものは変わらない (見た目だけの設定)', () => {
    selectQuantumPiece();
    const withHint = useGameStore.getState().legalDestinations.length;
    useGameStore.getState().setHintAlwaysOn(false);
    expect(useGameStore.getState().legalDestinations.length).toBe(withHint);
    expect(withHint).toBeGreaterThan(0);
  });
});
