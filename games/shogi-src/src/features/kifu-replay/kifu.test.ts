import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { clear as clearPlugins } from '../../core/plugin/registry';
import { generateLegalMoves, positionHash } from '../../core/engine';
import '../quantum';
import '../torus';
import { buildKifuFile, kifuFileName, parseKifu, replayKifu, serializeKifu } from './index';
import { clearLastKifu, loadLastKifu } from './storage';
import type { KifuFile } from './types';

/**
 * 決まった順で「それらしい手」を選ぶ。乱数を使うと落ちたときに再現できないので、
 * 手数から決まる値で選ぶ (毎回まったく同じ棋譜になる)。
 */
function playMoves(count: number): void {
  for (let i = 0; i < count; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') return;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) return;
    const move = legal[(i * 7 + 3) % legal.length];
    if (!useGameStore.getState().replayRecordedMove(move)) return;
  }
}

describe('棋譜ファイル — 書き出して読み直すと同じ局面に戻る', () => {
  beforeEach(() => {
    clearLastKifu();
    useAiStore.setState({ enabled: false });
  });

  it('本将棋: 40 手指した対局を書き出して読み直すと、最後の局面が一致する', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(40);
    useGameStore.getState().resign('player2');
    const before = positionHash(useGameStore.getState().position);
    const moveCount = useGameStore.getState().position.history.length;
    expect(moveCount).toBe(40);

    // 実際にファイルへ書く経路と同じ形にしてから読み直す (文字列を通す)
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(file.meta.result.status).toBe('resigned_p2');
    expect(file.meta.result.winner).toBe('player1');
    expect(file.meta.moveCount).toBe(moveCount);

    const r = replayKifu(file);
    expect(r.applied).toBe(r.recorded);
    expect(positionHash(useGameStore.getState().position)).toBe(before);
  });

  it('完全トーラス × 量子: 24 手指した対局でも、候補集合込みで局面が一致する', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: true, torusMode: 'full', handicap: null });
    playMoves(24);
    const before = positionHash(useGameStore.getState().position);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(file.meta.quantum).toBe(true);
    expect(file.meta.torus).toBe('full');

    const r = replayKifu(file);
    expect(r.applied).toBe(r.recorded);
    // positionHash は候補集合も含めて数えるので、量子の収縮まで一致していないと合わない
    expect(positionHash(useGameStore.getState().position)).toBe(before);
  });

  it('はさみ将棋: ルールが違っても書き出し→読み直しで一致する', () => {
    useGameStore.getState().reset({ gameType: 'hasami', quantum: false, torusMode: 'none', handicap: null });
    playMoves(20);
    const before = positionHash(useGameStore.getState().position);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(file.meta.gameType).toBe('hasami');
    const r = replayKifu(file);
    expect(r.applied).toBe(r.recorded);
    expect(positionHash(useGameStore.getState().position)).toBe(before);
  });

  it('駒落ち: 落とした側も再現される (平手と違う局面から始まる)', () => {
    useGameStore.getState().reset({
      gameType: 'shogi', quantum: false, torusMode: 'none',
      handicap: { typeId: 'kaku', giver: 'player1' },
    });
    const startHash = positionHash(useGameStore.getState().position);
    playMoves(10);
    const before = positionHash(useGameStore.getState().position);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(file.meta.handicap).toEqual({ typeId: 'kaku', giver: 'player1' });

    // 平手で始めてしまうと最初から局面が違うので、そこを取り違えていないことも見る
    useGameStore.getState().reset({ handicap: null });
    expect(positionHash(useGameStore.getState().position)).not.toBe(startHash);

    const r = replayKifu(file);
    expect(r.applied).toBe(r.recorded);
    expect(positionHash(useGameStore.getState().position)).toBe(before);
  });
});

describe('棋譜ファイル — 直前の 1 局の受け皿', () => {
  beforeEach(() => {
    clearLastKifu();
    useAiStore.setState({ enabled: false });
  });

  it('対局が終わると受け皿に入り、次の対局が始まると消える', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(6);
    expect(loadLastKifu()).toBeNull(); // 対局中はまだ入らない

    useGameStore.getState().resign('player1');
    const saved = loadLastKifu();
    expect(saved).not.toBeNull();
    expect(saved?.meta.result.status).toBe('resigned_p1');
    expect(saved?.moves).toHaveLength(6);

    useGameStore.getState().reset();
    expect(loadLastKifu()).toBeNull();
  });
});

/** 素性だけ差し替えた見本 (ファイル名の規約を単体で確かめる用)。 */
function sampleKifu(over: Partial<KifuFile['meta']> = {}): KifuFile {
  return {
    format: 'momo-shogi-kifu',
    version: 1,
    meta: {
      savedAt: '2026-08-16T14:32:10+09:00',
      opponent: 'com',
      gameType: 'shogi',
      quantum: false,
      torus: 'none',
      handicap: null,
      players: {
        player1: { name: '', kind: 'human' },
        player2: { name: 'AI', kind: 'ai', engineId: null, level: 'Apocalypse' },
      },
      viewerSide: 'player1',
      result: { status: 'checkmate', winner: 'player1' },
      moveCount: 87,
      timeControl: { mode: 'no_limit' } as KifuFile['meta']['timeControl'],
      ...over,
    },
    moves: [],
    moveTexts: [],
  };
}

describe('棋譜ファイル — ファイル名の規約 (親 §9.2.2)', () => {
  it('対 AI・本将棋・普通・勝ちは COM_HON_W と強さの頭文字になる', () => {
    expect(kifuFileName(sampleKifu())).toBe('260816_1432_COM_HON_W_A.json');
  });

  it('モディファイアが無いときは欄ごと省く / あるときだけ入る', () => {
    expect(kifuFileName(sampleKifu({ quantum: true }))).toBe('260816_1432_COM_HON_Q_W_A.json');
    expect(kifuFileName(sampleKifu({ torus: 'cylinder' }))).toBe('260816_1432_COM_HON_C_W_A.json');
    expect(kifuFileName(sampleKifu({ torus: 'full' }))).toBe('260816_1432_COM_HON_T_W_A.json');
    expect(kifuFileName(sampleKifu({ quantum: true, torus: 'full' }))).toBe('260816_1432_COM_HON_QT_W_A.json');
  });

  it('円筒と完全トーラスは別物なので同じ文字にしない', () => {
    expect(kifuFileName(sampleKifu({ torus: 'cylinder' })))
      .not.toBe(kifuFileName(sampleKifu({ torus: 'full' })));
  });

  it('ネット対戦は相手の名前が入り、負けは L になる', () => {
    const f = sampleKifu({
      opponent: 'net',
      players: {
        player1: { name: 'わたし', kind: 'human' },
        player2: { name: '山田太郎', kind: 'human' },
      },
      result: { status: 'resigned_p1', winner: 'player2' },
    });
    expect(kifuFileName(f)).toBe('260816_1432_NET_HON_L_山田.json');
  });

  it('名前は漢字 2 文字 / 英字 4 文字まで。使えない文字は落とす', () => {
    const withSymbols = sampleKifu({
      opponent: 'net',
      players: {
        player1: { name: 'me', kind: 'human' },
        player2: { name: 'a/b:c*def', kind: 'human' },
      },
    });
    expect(kifuFileName(withSymbols)).toBe('260816_1432_NET_HON_W_abcd.json');
  });

  it('同じ端末の二人対局は先手から見た勝敗で書く', () => {
    const f = sampleKifu({
      opponent: 'f2f',
      viewerSide: null,
      players: {
        player1: { name: '', kind: 'human' },
        player2: { name: '', kind: 'human' },
      },
      result: { status: 'resigned_p1', winner: 'player2' },
    });
    // 先手が投了 → 先手から見れば負け
    expect(kifuFileName(f)).toBe('260816_1432_F2F_HON_L.json');
  });

  it('引分は D・ノーゲームと中断は X', () => {
    expect(kifuFileName(sampleKifu({ result: { status: 'sennichite', winner: null } })))
      .toBe('260816_1432_COM_HON_D_A.json');
    expect(kifuFileName(sampleKifu({ result: { status: 'nogame', winner: null } })))
      .toBe('260816_1432_COM_HON_X_A.json');
    expect(kifuFileName(sampleKifu({ result: { status: 'playing', winner: null } })))
      .toBe('260816_1432_COM_HON_X_A.json');
  });

  it('はさみ将棋は HAS・定義の無いルールは CUS', () => {
    expect(kifuFileName(sampleKifu({ gameType: 'hasami' }))).toContain('_HAS_');
    expect(kifuFileName(sampleKifu({ gameType: 'shogi-custom' }))).toContain('_CUS_');
  });

  it('同じ分に 2 局終わったら連番が付く', () => {
    expect(kifuFileName(sampleKifu(), 1)).toBe('260816_1432_COM_HON_W_A_2.json');
  });

  it('狭い画面でも末尾まで見える長さに収まる (拡張子込み 32 文字以内)', () => {
    const longest = sampleKifu({
      opponent: 'net',
      quantum: true,
      torus: 'full',
      players: {
        player1: { name: 'わたし', kind: 'human' },
        player2: { name: '山田太郎', kind: 'human' },
      },
    });
    expect(kifuFileName(longest).length).toBeLessThanOrEqual(32);
  });
});

describe('棋譜ファイル — 棋譜でないものを読み込んだとき', () => {
  it('JSON でないファイル・別の JSON・欠けた棋譜はいずれも弾く', () => {
    expect(() => parseKifu('これは棋譜ではありません')).toThrow();
    expect(() => parseKifu('{"hello":1}')).toThrow();
    expect(() => parseKifu('{"format":"momo-shogi-kifu","version":1,"meta":{}}')).toThrow();
  });

  it('正しい棋譜は読み込める', () => {
    expect(parseKifu(serializeKifu(sampleKifu())).meta.gameType).toBe('shogi');
  });
});

describe('棋譜ファイル — 素性は先頭に置く (親 §9.2.1)', () => {
  it('書き出した JSON の最初の項目が format・version・meta の順', () => {
    clearPlugins();
    const text = serializeKifu(sampleKifu());
    const keys = Object.keys(JSON.parse(text));
    expect(keys.slice(0, 3)).toEqual(['format', 'version', 'meta']);
    // 手の列より前に素性が来ていること (先頭だけ読めば一覧が作れる形)
    expect(text.indexOf('"meta"')).toBeLessThan(text.indexOf('"moves"'));
  });
});
