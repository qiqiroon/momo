import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useGameStore } from '../../core/store/game-store';
import { chess } from '../../core/engine/mgf/loader';
import { generateLegalMoves } from '../../core/engine';
import { register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage } from '../../core/plugin/review';
import type { Mgf } from '../../core/engine/mgf/types';
import '../matchmaking/gameConnector';
import './index';
import { loadLastKifu } from './storage';
import { reviewTarget, reviewTargetRule, clearReviewTarget } from './review';
import { answerReviewOffer, endSharedReview, receiveReviewMessage, replaceSharedKifu } from './review-share';
import { serializeKifu } from './io';
import { resolveCustomRuleForOpenAsync } from './replay';
import { CustomRulePrompt } from './ui/CustomRulePrompt';
import type { KifuFile } from './types';

/**
 * ★段B② (ユーザー判断 2026-08-25): **配られた 1 局のカスタムルールの届き方**。
 *
 * - **公式一覧 (`rules/`) にあるルール**＝配る側は定義を添えず、受け取った側が
 *   自分で `rules/` から取ってくる。
 * - **作った本人が配っているルール**＝取りに行く先が無いので、**ホストが定義を添える**。
 * - どちらでも用意できなければ**ファイル選択のパネル**を出す（黙って本将棋で並べない）。
 */

/** 公式一覧に無いルール（＝ホストが配らないと相手は盤を作れない）。 */
const ownRule: Mgf = {
  ...chess,
  metadata: { ...chess.metadata, game_id: 'my-own-rule', game_name: '自作ルール', version: '9.9' },
};

let sent: ReviewMessage[] = [];
const fakeConnector = {
  isOnline: () => true,
  isRoomHost: () => true,
  getOpponentName: () => '花子',
  getMyName: () => '太郎',
  getMySide: () => 'player1',
  getMyChatSide: () => 'player1',
  getActiveRules: () => null,
  subscribe: () => () => {},
  sendReview: (msg: ReviewMessage) => { sent.push(msg); },
} as unknown as OnlineGameConnector;

/** そのルールで 1 局指して、記憶された棋譜を返す（参照＝名前+版だけを持つ）。 */
function gameWith(mgf: Mgf): KifuFile {
  useGameStore.getState().reset({ gameType: 'custom', customMgf: mgf, quantum: false, torusMode: 'none', handicap: null });
  for (let i = 0; i < 4; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') break;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) break;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) break;
  }
  useGameStore.getState().resign('player2');
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  return file;
}

beforeEach(() => {
  sent = [];
  register<OnlineGameConnector>('gameConnector', fakeConnector);
  clearReviewTarget('lobby');
});

afterEach(() => {
  endSharedReview();
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('配る側: 公式は添えない・自作は添える', () => {
  it('公式一覧のルールなら定義を添えない（受け取った側が自分で取れる）', () => {
    const file = gameWith(chess);
    answerReviewOffer(true);
    sent = [];
    replaceSharedKifu(file);

    const state = sent.find((m) => m.kind === 'state') as { rule?: Mgf } | undefined;
    expect(state).toBeTruthy();
    expect(state?.rule).toBeUndefined();
  });

  it('公式一覧に無いルールなら定義を添える（取りに行く先が無い）', () => {
    const file = gameWith(ownRule);
    answerReviewOffer(true);
    sent = [];
    replaceSharedKifu(file);

    const state = sent.find((m) => m.kind === 'state') as { rule?: Mgf } | undefined;
    expect(state?.rule?.metadata.game_id).toBe('my-own-rule');
  });

  it('手元にその定義が無ければ添えない（無いものは配れない）', () => {
    const file = gameWith(ownRule);
    // ★**別のカスタムルールへ移して**、手元にその定義が無い状態を作る。
    // 本将棋へ戻すだけでは足りない＝**読み込んだ定義は次の読み込みまで手元に残る**
    // （対局中の「リセット」で同じルールのまま指し直せるように控えてある）。
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none', handicap: null });
    answerReviewOffer(true);
    sent = [];
    replaceSharedKifu(file);

    const state = sent.find((m) => m.kind === 'state') as { rule?: Mgf } | undefined;
    expect(state?.rule).toBeUndefined();
  });
});

describe('受け取る側: 配られた定義は 1 局と一緒に据わる', () => {
  it('添えられた定義がその 1 局の定義になる', () => {
    const file = gameWith(ownRule);
    answerReviewOffer(true);
    receiveReviewMessage({ kind: 'state', kifu: serializeKifu(file), rule: ownRule, ply: 0, branch: [] });

    expect(reviewTarget()).toBeTruthy();
    expect(reviewTargetRule()?.metadata.game_id).toBe('my-own-rule');
  });

  it('次の 1 局が定義なしで配られたら、前の定義は残らない', () => {
    // ★**「空なら入れる」形にすると 2 回目から前の値が出る**。初回は必ず通るので
    // 検査を 1 回で終えると気づけない。
    const own = gameWith(ownRule);
    const official = gameWith(chess);
    answerReviewOffer(true);
    receiveReviewMessage({ kind: 'state', kifu: serializeKifu(own), rule: ownRule, ply: 0, branch: [] });
    receiveReviewMessage({ kind: 'state', kifu: serializeKifu(official), ply: 0, branch: [] });

    expect(reviewTargetRule()).toBeNull();
  });
});

describe('公式一覧からのダウンロード', () => {
  function installFetch(available: boolean, mgf: Mgf) {
    (globalThis as { fetch?: unknown }).fetch = ((url: string) => {
      if (!available) return Promise.resolve({ ok: false, status: 404 });
      if (String(url).endsWith('index.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rules: [{ id: mgf.metadata.game_id, file: 'x.json', name: 'x' }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mgf) });
    }) as unknown as typeof fetch;
  }

  it('焼き込みに無いルールでも、一覧に載っていれば取ってきて解決する', async () => {
    const file = gameWith(ownRule);
    // 別のカスタムルールへ移す＝手元では取り戻せない状態にする（上と同じ理由）。
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none', handicap: null });
    installFetch(true, ownRule);

    const r = await resolveCustomRuleForOpenAsync(file);
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.mgf.metadata.game_id).toBe('my-own-rule');
  });

  it('取ってこられなければファイル選択が要るまま', async () => {
    const file = gameWith(ownRule);
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none', handicap: null });
    installFetch(false, ownRule);

    const r = await resolveCustomRuleForOpenAsync(file);
    expect(r.kind).toBe('needsFile');
  });
});

describe('ファイル選択のパネル: 配られた 1 局では「そのまま進める」を出さない', () => {
  const kifuRef = { id: 'my-own-rule', name: '自作ルール', version: '9.9' };

  /**
   * **食い違う定義を選ばせる**ところまで実際に通す。
   *
   * ★ここを通さないと**3 択そのものが出ていない**ので、押しどころの数を数えても
   * 「出す／出さない」の切り替えを測ったことにならない（食い違う前はどちらも同じ形）。
   */
  async function pickMismatchingFile(container: HTMLElement): Promise<void> {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // ★中身を読むのに使われるのは `text()` だけ。**この環境の File には無い**ので、
    // 読み口だけを持つものを置く（実物の File を作っても中身が読めず、
    // **「定義として読めない」側へ落ちて食い違いに到達しない**）。
    const fake = { text: () => Promise.resolve(JSON.stringify(chess)) };
    Object.defineProperty(input, 'files', { value: [fake], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('.rulefile-actions button')).map((b) => b.textContent);

  it('自分で開いた 1 局なら、食い違うと 3 択（そのまま進める入り）', async () => {
    const { container } = render(
      <CustomRulePrompt locale="ja" kifuRef={kifuRef} onChoose={() => {}} onCancel={() => {}} />,
    );
    await pickMismatchingFile(container);
    const labels = buttons(container);
    expect(labels.length).toBe(3);
    expect(labels.some((l) => l?.includes('進める'))).toBe(true);
  });

  it('配られた 1 局なら、食い違っても「そのまま進める」が出ない（2 択）', async () => {
    const { container } = render(
      <CustomRulePrompt locale="ja" kifuRef={kifuRef} allowProceed={false} onChoose={() => {}} onCancel={() => {}} />,
    );
    await pickMismatchingFile(container);
    const labels = buttons(container);
    expect(labels.length).toBe(2);
    expect(labels.some((l) => l?.includes('進める'))).toBe(false);
  });
});
