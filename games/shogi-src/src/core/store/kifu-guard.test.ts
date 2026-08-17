import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clear as clearPlugins, register } from '../plugin/registry';
import { useRouteStore } from './route-store';
import {
  guardCancel,
  guardDiscard,
  guardResetYes,
  guardSave,
  requestNewGame,
  useKifuGuardStore,
} from './kifu-guard';

/**
 * 棋譜を捨てる前の確認（親 v1.36 §9.2.3 ②・画面機能 v0.30 §3 S02／S07）。
 *
 * ここは core なので、棋譜そのものは持たない。記憶の状態と書き出しの結末は
 * features 側が plugin registry で答えるので、検査では**答える側を差し替える**。
 */

type MemoryState = 'empty' | 'unsaved' | 'saved' | 'pending-discard';

interface FakeKifu {
  state: MemoryState;
  /** 中身を実際に消した回数。**確認に答えただけでは 0 のまま**（親 v1.40 §9.2.3 ②）。 */
  discarded: number;
  /** 「捨てる」と答えられて印を付けた回数。 */
  marked: number;
  saveCalls: number;
  /** 書き出しの結末をここで決める（取り消しを再現するため）。 */
  outcome: 'saved' | 'cancelled';
}

function installFakeKifu(state: MemoryState): FakeKifu {
  const fake: FakeKifu = { state, discarded: 0, marked: 0, saveCalls: 0, outcome: 'saved' };
  register('kifu:state', () => fake.state);
  register('kifu:discard', () => {
    fake.discarded += 1;
    fake.state = 'empty';
  });
  register('kifu:markDiscard', () => {
    fake.marked += 1;
    // 保存済みなら印を変えない（ファイルが残っている事実のほうが強い）。
    if (fake.state !== 'saved') fake.state = 'pending-discard';
  });
  register('kifu:save', async () => {
    fake.saveCalls += 1;
    if (fake.outcome === 'saved') fake.state = 'saved';
    return fake.outcome;
  });
  return fake;
}

beforeEach(() => {
  clearPlugins();
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
  useRouteStore.setState({ screen: 'game' });
});

afterEach(() => {
  clearPlugins();
});

describe('棋譜を捨てる前の確認（親 §9.2.3 ②）', () => {
  it('未保存なら尋ねる＝元の操作はまだ行わない', () => {
    installFakeKifu('unsaved');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    expect(ran).toBe(0);
  });

  it('★「破棄する」は印を付けるだけ＝その場では捨てない（親 v1.40 §9.2.3 ②）', () => {
    const fake = installFakeKifu('unsaved');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    guardDiscard();
    // 元の操作は行うが、**中身はまだ残っている**＝引き返しても棋譜は失われない。
    expect(ran).toBe(1);
    expect(fake.marked).toBe(1);
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('pending-discard');
    expect(useKifuGuardStore.getState().stage).toBeNull();
  });

  it('★破棄予定なら二度と尋ねない（本人が既に選んでいる）', () => {
    const fake = installFakeKifu('pending-discard');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(ran).toBe(1);
    expect(fake.discarded).toBe(0);
  });

  it('★「やめる」で引き返せる＝元の操作を行わず、記憶もそのまま（親 v1.37 §9.2.3 ②）', () => {
    const fake = installFakeKifu('unsaved');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    guardCancel();
    expect(ran).toBe(0);
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('unsaved');
    expect(useKifuGuardStore.getState().stage).toBeNull();
  });

  it('★「やめる」を選んだあと、同じ操作をやり直せば再び尋ねる', () => {
    installFakeKifu('unsaved');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    guardCancel();
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    expect(ran).toBe(0);
  });

  it('★保存済みなら尋ねずに進む＝ここでも捨てない（次の対局が始まるまで再生できる）', () => {
    const fake = installFakeKifu('saved');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('saved');
    expect(ran).toBe(1);
  });

  it('記憶が空なら尋ねずに進む', () => {
    installFakeKifu('empty');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(ran).toBe(1);
  });

  it('棋譜の機能を積んでいないビルドでは素通りする', () => {
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(ran).toBe(1);
  });
});

describe('「保存する」を選んだとき（親 §9.2.3 ③）', () => {
  it('★書き出せたら元の操作を続行する＝記憶は残す（印だけ保存済みへ）', async () => {
    const fake = installFakeKifu('unsaved');
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    await guardSave();
    expect(fake.saveCalls).toBe(1);
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('saved');
    expect(ran).toBe(1);
    expect(useKifuGuardStore.getState().stage).toBeNull();
  });

  it('★取り消したら元の操作も行わず、記憶も残したまま確認へ戻る', async () => {
    const fake = installFakeKifu('unsaved');
    fake.outcome = 'cancelled';
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    await guardSave();
    expect(ran).toBe(0);
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('unsaved');
    // 確認は出したまま。取り消したことも画面に出せるようにしておく。
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    expect(useKifuGuardStore.getState().cancelled).toBe(true);
  });

  it('★取り消して戻った先でも「やめる」で引き返せる（閉じ込めない）', async () => {
    const fake = installFakeKifu('unsaved');
    fake.outcome = 'cancelled';
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    await guardSave();
    guardCancel();
    expect(ran).toBe(0);
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('unsaved');
    expect(useKifuGuardStore.getState().stage).toBeNull();
  });

  it('取り消したあと、もう一度保存して進める', async () => {
    const fake = installFakeKifu('unsaved');
    fake.outcome = 'cancelled';
    let ran = 0;
    requestNewGame(() => { ran += 1; });
    await guardSave();
    fake.outcome = 'saved';
    await guardSave();
    expect(ran).toBe(1);
    expect(useKifuGuardStore.getState().stage).toBeNull();
  });
});

describe('対局画面のリセットだけ二段（画面機能 §3 S07）', () => {
  it('一段目は記憶が空でも必ず出る（誤操作の代償が大きいため）', () => {
    installFakeKifu('empty');
    let ran = 0;
    requestNewGame(() => { ran += 1; }, { twoStep: true });
    expect(useKifuGuardStore.getState().stage).toBe('reset');
    expect(ran).toBe(0);
  });

  it('一段目で「やめる」を選ぶと何も起きない', () => {
    const fake = installFakeKifu('unsaved');
    let ran = 0;
    requestNewGame(() => { ran += 1; }, { twoStep: true });
    guardCancel();
    expect(ran).toBe(0);
    expect(fake.discarded).toBe(0);
    expect(useKifuGuardStore.getState().stage).toBeNull();
  });

  it('一段目で「はい」→ 未保存なら二段目へ進む', () => {
    installFakeKifu('unsaved');
    requestNewGame(() => {}, { twoStep: true });
    // 一段目を飛ばしていないこと（飛ばすと二段の意味が消える）。
    expect(useKifuGuardStore.getState().stage).toBe('reset');
    guardResetYes();
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
  });

  it('一段目で「はい」→ 保存済みなら二段目は出さずに実行する', () => {
    const fake = installFakeKifu('saved');
    let ran = 0;
    requestNewGame(() => { ran += 1; }, { twoStep: true });
    // 保存済みでも一段目は出る（棋譜とは別に、リセットそのものを確かめる段）。
    expect(useKifuGuardStore.getState().stage).toBe('reset');
    expect(ran).toBe(0);
    guardResetYes();
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(fake.discarded).toBe(0); // 捨てるのは盤が作り直された瞬間（v1.42）
    expect(ran).toBe(1);
  });
});

describe('画面を移る仕組みの側で確認する（親 §9.2.3 ②）', () => {
  const setScreen = () => useRouteStore.getState().setScreen;

  it.each(['rule-select', 'ai-setup', 'room', 'offline-rule'] as const)(
    '%s へ入るときは尋ねる（画面はまだ移らない）',
    (screen) => {
      installFakeKifu('unsaved');
      setScreen()(screen);
      expect(useKifuGuardStore.getState().stage).toBe('kifu');
      expect(useRouteStore.getState().screen).toBe('game');
      guardDiscard();
      expect(useRouteStore.getState().screen).toBe(screen);
    },
  );

  it('★オフライン対人の設定画面も対象（v1.35 で漏れていた画面）', () => {
    const fake = installFakeKifu('unsaved');
    setScreen()('offline-rule');
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    guardDiscard();
    expect(fake.marked).toBe(1);
    expect(useRouteStore.getState().screen).toBe('offline-rule');
  });

  it('★対 AI の終局後に設定画面を通っても、棋譜はまだ残っている（v1.41 の欠陥）', () => {
    // 対 AI はモード選択へ直接戻る導線が無く、必ず対AI設定画面を通る。
    // v1.41 は確認に答えた瞬間に捨てていたため、**まだ何も始まっていないのに**
    // 棋譜だけが先に消え、そのまま棋譜再生へ入っても何も無かった。
    const fake = installFakeKifu('unsaved');
    setScreen()('ai-setup');
    guardDiscard();
    expect(useRouteStore.getState().screen).toBe('ai-setup');
    expect(fake.discarded).toBe(0); // 中身は残っている＝読み込み直さずに再生できる
    // ここから引き返して棋譜再生へ入っても、記憶は空になっていない。
    setScreen()('kifu-replay');
    expect(fake.discarded).toBe(0);
  });

  it('★確認で「やめる」を選んだら画面も移らない（元の場所に留まる）', () => {
    const fake = installFakeKifu('unsaved');
    setScreen()('rule-select');
    guardCancel();
    expect(useRouteStore.getState().screen).toBe('game');
    expect(fake.discarded).toBe(0);
    expect(fake.state).toBe('unsaved');
  });

  it('対局画面やメニューへ移るときは尋ねない（盤を作り直す画面ではない）', () => {
    installFakeKifu('unsaved');
    setScreen()('lobby');
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(useRouteStore.getState().screen).toBe('lobby');
    setScreen()('game');
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(useRouteStore.getState().screen).toBe('game');
  });

  it('★相手の操作で盤が作り直される経路には割り込まない（相手を待たせるため）', () => {
    installFakeKifu('unsaved');
    setScreen()('room', { skipKifuGuard: true });
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(useRouteStore.getState().screen).toBe('room');
  });

  it('確認を通ったあと、続けて設定画面を渡り歩いても二度は尋ねない', () => {
    installFakeKifu('unsaved');
    setScreen()('ai-setup');
    guardDiscard();
    setScreen()('rule-select');
    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(useRouteStore.getState().screen).toBe('rule-select');
  });
});
