import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRouteStore } from '../store/route-store';
import * as audio from '../audio/audio-engine';
import { RootView } from './RootView';

/**
 * ★v1.55: 画面ごとの BGM（音響仕様 v0.8 §4・ユーザー判断 2026-08-19）。
 *
 * ここで固定したいのは、**耳でしか気づけないこと**。
 *   - **盤を並べる画面（感想戦 S11・棋譜再生 S08）は対局中の曲**
 *   - **感想戦ロビー（S12）はロビーの曲**（人を待つ画面であるため）
 *   - **終局は無音**（勝敗音の邪魔をしない）
 *
 * v0.3 の「S08 は呼び出し元の BGM を継承する」は撤回された＝S08 は当時オーバーレイに
 * 近いものとして書かれていたが、**実装では独立した画面で盤を並べる**ので、継承の
 * 前提そのものが失われている。
 */

let played: string[] = [];
let stopped = 0;

beforeEach(() => {
  played = [];
  stopped = 0;
  vi.spyOn(audio, 'isAudioRunning').mockReturnValue(true);
  vi.spyOn(audio, 'playRandomBgm').mockImplementation(async (pool: 'lobby' | 'game') => {
    played.push(pool);
  });
  vi.spyOn(audio, 'stopBgm').mockImplementation(() => {
    stopped += 1;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function onScreen(screen: string): void {
  useRouteStore.setState({ screen: screen as never });
  render(<RootView variant="b" />);
}

describe('★v1.55 盤を並べる画面では対局中の曲（音響 v0.8 §4）', () => {
  it('★感想戦（S11）は対局中の曲（v1.54 まではロビーの曲だった）', () => {
    onScreen('review');
    expect(played).toContain('game');
  });

  it('★棋譜再生（S08）も対局中の曲（v0.3 の「呼び出し元を継ぐ」は撤回）', () => {
    onScreen('kifu-replay');
    expect(played).toContain('game');
  });

  it('感想戦ロビー（S12）はロビーの曲（人を待つ画面であるため）', () => {
    onScreen('review-lobby');
    expect(played).toContain('lobby');
    expect(played).not.toContain('game');
  });

  it('対局（S06）は対局中の曲・終局は無音（従来どおり）', () => {
    onScreen('endgame');
    expect(stopped).toBe(1);
    expect(played).toHaveLength(0);
  });
});
