import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage } from '../../core/plugin/review';
import {
  reviewSpectatorArrived,
  shareReviewSeek,
  useReviewShareStore,
} from './review-share';

/**
 * ★v1.59 段3: **感想戦の部屋のホスト側**（親 §6.8.6）。
 *
 * ここで固定するのは 3 つ。
 *   - **配るものは「入ってきた人の立場」ではなく「いま自分が居る部屋の用途」で決まる**
 *     ＝感想戦の部屋なら感想戦の土台。対局を丸ごと配る仕掛けをそのまま動かすと、
 *     **観戦者は在りもしない対局を組み立てて盤の画面へ行ってしまう**。
 *   - **配る先は入ってきたその一人**＝既に居る人の画面を作り直さない。
 *   - **観戦者しか居ない部屋でも、盤の動きは線に乗る**＝「二人でやっているか」で
 *     決めていたため、**相手の居ない部屋では観戦者の盤が動かなかった**。
 */

let sent: { msg: ReviewMessage; to?: string }[] = [];

function registerConnector(isRoomHost: boolean) {
  register('gameConnector', {
    isRoomHost: () => isRoomHost,
    sendReview: (msg: ReviewMessage, to?: string) => sent.push({ msg, to }),
    getMySide: () => 'player1' as const,
    getOpponentName: () => '花子',
    isOnline: () => true,
    subscribe: () => () => {},
  } as unknown as OnlineGameConnector);
}

beforeEach(() => {
  sent = [];
  useReviewShareStore.setState({ role: null, ready: true, ownsRoom: false });
});

afterEach(() => {
  register('gameConnector', undefined as never);
  useReviewShareStore.setState({ role: null, ready: true, ownsRoom: false });
});

describe('v1.59 段3: 感想戦の部屋へ観戦者が入ってきたとき', () => {
  it('★感想戦の部屋なら、その一人へ感想戦の土台を配る', () => {
    registerConnector(true);
    useReviewShareStore.setState({ ownsRoom: true });
    expect(reviewSpectatorArrived('v1')).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.kind).toBe('state');
    expect(sent[0].to).toBe('v1');
  });

  it('★対局の部屋なら引き受けない＝呼んだ側が今までどおり対局を配る（縮退互換）', () => {
    registerConnector(true);
    expect(reviewSpectatorArrived('v1')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('★建てた側でなければ配らない（配り手を 1 人に絞る）', () => {
    registerConnector(false);
    useReviewShareStore.setState({ ownsRoom: true });
    // 感想戦の部屋の出来事ではあるので引き受ける（**黙って別のものを配らない**）。
    expect(reviewSpectatorArrived('v1')).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('★★対局相手が居なくても盤の動きは線に乗る（観戦者しか居ない部屋で盤が止まっていた）', () => {
    registerConnector(true);
    // 役は「対局相手と二人でやっているか」の印。**観戦者はここに数えられていない**。
    useReviewShareStore.setState({ role: null, ownsRoom: true });
    shareReviewSeek({ ply: 0, branchLen: 0 }, 5);
    expect(sent).toHaveLength(1);
    expect(sent[0].msg).toMatchObject({ kind: 'seek', ply: 5 });
  });

  it('感想戦の部屋に居ないときは何も送らない（ひとりの感想戦＝縮退）', () => {
    registerConnector(true);
    shareReviewSeek({ ply: 0, branchLen: 0 }, 5);
    expect(sent).toHaveLength(0);
  });
});
