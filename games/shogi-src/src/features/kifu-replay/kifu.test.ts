import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { clear as clearPlugins } from '../../core/plugin/registry';
import { dismissSaveNotice, useSaveNoticeStore } from '../../core/store/save-notice';
import {
  guardCancel,
  guardResetYes,
  requestNewGame,
  useKifuGuardStore,
} from '../../core/store/kifu-guard';
import { applyMove, generateLegalMoves, positionHash, chess } from '../../core/engine';
import { readMgfFile } from '../../core/engine/mgf/rule-catalog';
import '../quantum';
import '../torus';
import {
  adoptLoadedKifu,
  buildKifuFile,
  kifuFileName,
  listFolderKifu,
  parseKifu,
  replayKifu,
  customRuleMatches,
  resolveCustomRuleForOpen,
  saveCurrentKifu,
  serializeKifu,
  usableFolder,
  type FsDirHandle,
} from './index';
import { forgetFolder } from './folder';
import {
  discardKifu,
  kifuMemoryState,
  loadKifuMemory,
  loadLastKifu,
  markKifuPendingDiscard,
} from './storage';
import type { Mgf } from '../../core/engine/mgf/types';
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

/**
 * 千日手（同じ局面 4 回）まで指す。**手だけで終局する棋譜**が要るところで使う
 * （投了や時間切れは棋譜に手として残らないので、再生では終局まで行かない）。
 *
 * 選び方＝行き先の局面が既に出ている手を優先する。行って戻れる駒を見つけると
 * そこを往復し続けるので、そのまま 4 回に達する。乱数は使わない（毎回同じ棋譜）。
 */
function playUntilSennichite(cap = 120): void {
  for (let i = 0; i < cap; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') return;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) return;
    let best = legal[(i * 7 + 3) % legal.length];
    let bestSeen = -1;
    for (const m of legal) {
      const seen = s.positionCounts[positionHash(applyMove(s.mgf, s.position, m))] ?? 0;
      if (seen > bestSeen) {
        bestSeen = seen;
        best = m;
      }
    }
    if (!useGameStore.getState().replayRecordedMove(best)) return;
  }
}

describe('棋譜ファイル — 書き出して読み直すと同じ局面に戻る', () => {
  beforeEach(() => {
    discardKifu();
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

  it('カスタムルール (チェス・§9.2.6): 棋譜は名前+版の参照だけ持ち、公式一覧から取り戻して再生できる', () => {
    // 読み込んだカスタムルールで対局する (段A と同じ道)。
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none', handicap: null });
    expect(useGameStore.getState().position.width).toBe(8); // チェスは 8×8
    playMoves(6);
    const before = positionHash(useGameStore.getState().position);

    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    // 棋譜は定義本体でなく「名前+版」の参照だけを持つ (§9.2.6・MGF は埋め込まない)。
    expect(file.meta.gameType).toBe('custom');
    expect(file.meta).not.toHaveProperty('customMgf');
    expect(file.meta.customRule?.id).toBe('chess');
    expect(file.meta.customRule?.name).toBeTruthy();
    expect(file.meta.customRule?.version).toBe(chess.metadata.version);

    // ★縮退の見張り: 別セッション相当にする＝手元の読み込み済み定義 (currentCustomMgf) を
    //   消し、9×9 本将棋にしてから再生する。これで「手元の控え」の枝を封じ、**公式一覧
    //   (officialCustomRule) から名前で取り戻せて初めて 8×8 に戻る**ことを固定する。
    //   参照を種類だけで引き直すと custom は組み込みの一覧に無いので本将棋 (9×9) に化ける。
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    useGameStore.setState({ currentCustomMgf: null });
    expect(useGameStore.getState().position.width).toBe(9);

    const r = replayKifu(file);
    expect(r.applied).toBe(r.recorded);
    expect(useGameStore.getState().position.width).toBe(8); // チェスに戻っている
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

describe('カスタムルールの取り戻し — 開く工程 (段2・§9.2.6)', () => {
  beforeEach(() => {
    discardKifu();
    useAiStore.setState({ enabled: false });
    useGameStore.setState({ currentCustomMgf: null });
  });

  /** チェスを 6 手指した棋譜 (名前+版の参照だけを持つ)。 */
  function chessKifu(): KifuFile {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none', handicap: null });
    playMoves(6);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(file.meta.customRule?.id).toBe('chess');
    return file;
  }

  it('組み込みルールの棋譜は取り戻し不要 (none)', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(4);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(resolveCustomRuleForOpen(file)).toEqual({ kind: 'none' });
  });

  it('公式一覧にあるチェスは、手元の控えが空でも resolved で取り戻せる', () => {
    const file = chessKifu();
    // 別セッション相当＝手元の読み込み済みを消す。公式一覧 (officialCustomRule) から引ける。
    useGameStore.setState({ currentCustomMgf: null });
    const r = resolveCustomRuleForOpen(file);
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.mgf.metadata.game_id).toBe('chess');
  });

  it('手元に読み込み済みで一致すれば、その定義で取り戻す (同一セッション)', () => {
    const file = chessKifu();
    useGameStore.setState({ currentCustomMgf: chess });
    const r = resolveCustomRuleForOpen(file);
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.mgf).toBe(chess);
  });

  it('★公式にも手元にも無いルールは needsFile＝ファイル選択が要る (§9.2.6 ②)', () => {
    const file = chessKifu();
    // 公式一覧に無いルール (将来の中将棋など) を模す＝参照の id を差し替える。
    const unknown: KifuFile = {
      ...file,
      meta: { ...file.meta, customRule: { id: 'chuushogi', name: '中将棋', version: '0.1.0' } },
    };
    useGameStore.setState({ currentCustomMgf: null });
    const r = resolveCustomRuleForOpen(unknown);
    expect(r.kind).toBe('needsFile');
    if (r.kind === 'needsFile') {
      expect(r.ref.name).toBe('中将棋');
      expect(r.ref.version).toBe('0.1.0');
    }
  });

  it('★開く工程で選んだ定義を渡すと、その定義で並べ直す (自動では取り戻せなくても)', () => {
    const file = chessKifu();
    // 参照の id を未知にして、自動の取り戻し (手元・公式) をどちらも封じる。
    const unknown: KifuFile = {
      ...file,
      meta: { ...file.meta, customRule: { id: 'chuushogi', name: '中将棋', version: '0.1.0' } },
    };
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    useGameStore.setState({ currentCustomMgf: null });

    // 定義を渡さないと自動では取り戻せず、本将棋 (9×9) に化ける＝手はほとんど並ばない。
    const auto = replayKifu(unknown);
    expect(useGameStore.getState().position.width).toBe(9);
    expect(auto.applied).toBeLessThan(auto.recorded);

    // ファイル選択で取り戻した定義 (ここではチェス) を渡すと、その定義で満額並ぶ。
    const picked = replayKifu(unknown, undefined, { mgf: chess });
    expect(useGameStore.getState().position.width).toBe(8);
    expect(picked.applied).toBe(picked.recorded);
  });
});

describe('食い違う定義での並べ直し — 違反を無視する (段2c・§9.2.6 ④)', () => {
  beforeEach(() => {
    discardKifu();
    useAiStore.setState({ enabled: false });
    useGameStore.setState({ currentCustomMgf: null });
  });

  /**
   * **版だけが違い、どの駒も動けない**チェス。記録された手は 1 手目から全部
   * 「このルールでは指せない手」になるので、**違反を無視するかどうかで結果が
   * はっきり分かれる**（盤の形・駒の並びは本物のチェスと同じなので、並べられれば
   * 同じ局面に戻るはず）。
   */
  const crippled: Mgf = {
    ...chess,
    metadata: { ...chess.metadata, version: '9.9.9' },
    pieces: chess.pieces.map((p) => ({ ...p, move_logic: { ...p.move_logic, abilities: [] } })),
  };

  /** チェスを 6 手指した棋譜と、そのときの局面。 */
  function chessGame(): { file: KifuFile; hash: string } {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none', handicap: null });
    playMoves(6);
    const hash = positionHash(useGameStore.getState().position);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    expect(file.moves.length).toBe(6);
    return { file, hash };
  }

  it('★そのまま進めると、このルールで指せない手も記録どおりに並ぶ (同じ局面に戻る)', () => {
    const { file, hash } = chessGame();
    const r = replayKifu(file, undefined, { mgf: crippled, ignoreViolations: true });
    expect(r.applied).toBe(r.recorded);
    expect(positionHash(useGameStore.getState().position)).toBe(hash);
  });

  it('★同じ定義でも、無視しないなら 1 手目で止まる (段2c が効いていることの対)', () => {
    const { file } = chessGame();
    const r = replayKifu(file, undefined, { mgf: crippled });
    expect(r.applied).toBe(0);
    expect(r.recorded).toBe(6);
  });

  it('★終局が立っても止めない (食い違う定義は、本来と違う場所で終局を立てる)', () => {
    const { file } = chessGame();
    // **同じ局面が 1 回出たら引分**とする定義＝**1 手並べた時点で終局が立つ**。
    // 版がずれると、こういう「本来と違う場所で立つ終局」が起こりうる。
    const endsAtOnce: Mgf = { ...crippled, repetition: { detection_threshold: 1 } };
    const r = replayKifu(file, undefined, { mgf: endsAtOnce, ignoreViolations: true });
    expect(useGameStore.getState().status).not.toBe('playing');
    // 終局で止める作りのままなら、ここは 1 手で終わっている。
    expect(r.applied).toBe(6);
  });

  it('★止めないのは「違反」だけ＝盤と噛み合わない手はそこで止まる', () => {
    const { file } = chessGame();
    // 3 手目を「誰も居ないマスから動かす手」に差し替える＝運びようがない手。
    const broken: KifuFile = {
      ...file,
      moves: [
        ...file.moves.slice(0, 2),
        { type: 'move', pieceId: 'no_such_piece', from: { row: 4, col: 4 }, to: { row: 3, col: 4 }, promote: false },
        ...file.moves.slice(3),
      ],
    };
    const r = replayKifu(broken, undefined, { mgf: chess, ignoreViolations: true });
    expect(r.applied).toBe(2); // ここまでは記録どおり
    expect(r.recorded).toBe(6);
  });

  it('一致して取り戻せた棋譜は従来どおり満額並ぶ (無回帰の対)', () => {
    const { file, hash } = chessGame();
    useGameStore.setState({ currentCustomMgf: null });
    const r = replayKifu(file, undefined, { mgf: chess });
    expect(r.applied).toBe(r.recorded);
    expect(positionHash(useGameStore.getState().position)).toBe(hash);
  });
});

describe('MGF ファイルの読み込み検証 — readMgfFile (段2・§9.2.6 ②)', () => {
  /** 検査環境の jsdom は Blob.text() を持たないので、コードベース慣例の疑似ファイルを使う。 */
  const fakeFile = (text: string) => ({ text: async () => text }) as unknown as Blob;

  it('正しい MGF ファイルは読めて検証を通る', async () => {
    const mgf = await readMgfFile(fakeFile(JSON.stringify(chess)));
    expect(mgf.metadata.game_id).toBe('chess');
    expect(mgf.board.width).toBe(8);
  });

  it('壊れた JSON は弾く', async () => {
    await expect(readMgfFile(fakeFile('{ これは JSON ではない'))).rejects.toBeTruthy();
  });

  it('MGF として欠けているファイルは弾く (loadMgf の検証)', async () => {
    await expect(readMgfFile(fakeFile(JSON.stringify({ hello: 'world' })))).rejects.toBeTruthy();
  });
});

describe('選んだ定義の一致確認 — customRuleMatches (段2b・§9.2.6 ③)', () => {
  const ref = { id: 'chess', name: chess.metadata.game_name, version: chess.metadata.version };

  it('名前も版も同じなら一致', () => {
    expect(customRuleMatches(ref, chess)).toBe(true);
  });

  it('名前が違えば不一致', () => {
    expect(customRuleMatches({ ...ref, name: 'ぐるぐる大砲将棋' }, chess)).toBe(false);
  });

  it('★版だけが違っても不一致に数える (§9.2.6 明文＝手が合わなくなることがある)', () => {
    expect(customRuleMatches({ ...ref, version: '0.0.1' }, chess)).toBe(false);
  });

  it('棋譜が版を記録していないのに定義が版を持つなら不一致', () => {
    expect(customRuleMatches({ id: 'chess', name: chess.metadata.game_name }, chess)).toBe(false);
  });
});

describe('棋譜の記憶 — 1 枠 3 状態 (親 §9.2.3 ①②)', () => {
  beforeEach(() => {
    discardKifu();
    useAiStore.setState({ enabled: false });
  });

  it('対局が終わると「未保存」で記憶に入る', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(6);
    expect(kifuMemoryState()).toBe('empty'); // 対局中はまだ入らない

    useGameStore.getState().resign('player1');
    expect(kifuMemoryState()).toBe('unsaved');
    const m = loadKifuMemory();
    expect(m?.file.meta.result.status).toBe('resigned_p1');
    expect(m?.file.moves).toHaveLength(6);
  });

  it('盤を作り直しただけでは消えない（破棄は §9.2.3 ② の契機だけ）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(6);
    useGameStore.getState().resign('player1');
    expect(kifuMemoryState()).toBe('unsaved');

    // v1.40 はここで消していた。盤の作り直しは再生でも起きるので合図にしてはならない。
    useGameStore.getState().reset();
    expect(kifuMemoryState()).toBe('unsaved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
  });

  it('破棄すると空になる', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(4);
    useGameStore.getState().resign('player2');
    expect(kifuMemoryState()).toBe('unsaved');

    discardKifu();
    expect(kifuMemoryState()).toBe('empty');
    expect(loadLastKifu()).toBeNull();
  });

  it('★再生しても記憶は消えず、印も変わらない（v1.40 の欠陥①）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(10);
    useGameStore.getState().resign('player2');
    const kept = loadKifuMemory();
    expect(kept).not.toBeNull();

    // 記憶している棋譜そのものを再生する（v1.40 では、これで当の棋譜が消えていた）
    const r = replayKifu(kept!.file);
    expect(r.applied).toBe(r.recorded);

    const after = loadKifuMemory();
    expect(after).not.toBeNull();
    expect(after?.mark).toBe(kept!.mark);
    expect(after?.file.moves).toHaveLength(10);
  });

  it('★破棄を選んでも中身は残り、盤が作り直されるまで再生できる（v1.42）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(10);
    useGameStore.getState().resign('player2');
    expect(kifuMemoryState()).toBe('unsaved');

    markKifuPendingDiscard();
    expect(kifuMemoryState()).toBe('pending-discard');
    // **中身は残っている**＝読み込み直さずに再生できる。
    const kept = loadLastKifu();
    expect(kept).not.toBeNull();
    expect(replayKifu(kept!).applied).toBe(10);
    expect(loadLastKifu()).not.toBeNull();
  });

  it('★盤が実際に作り直されたときに、はじめて黙って捨てる（v1.42）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(10);
    useGameStore.getState().resign('player2');
    markKifuPendingDiscard();
    expect(loadLastKifu()).not.toBeNull();

    // 新しい対局が本当に始まった＝ここで捨てる。
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    expect(kifuMemoryState()).toBe('empty');
  });

  it('★未保存のまま盤が作り直されても、勝手には捨てない（確認は画面側の担当）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(10);
    useGameStore.getState().resign('player2');
    expect(kifuMemoryState()).toBe('unsaved');

    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    // 未保存は残す（誰も答えていない棋譜を、盤の都合で捨てない）。
    expect(loadLastKifu()).not.toBeNull();
  });

  it('★保存済みも、盤が作り直された時点で捨てる（ファイルは残っている）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(10);
    useGameStore.getState().resign('player2');
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    adoptLoadedKifu(file);
    expect(kifuMemoryState()).toBe('saved');

    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    expect(kifuMemoryState()).toBe('empty');
  });

  it('★再生で盤を作り直しても捨てない（再生は新しい対局ではない）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(10);
    useGameStore.getState().resign('player2');
    markKifuPendingDiscard();

    const kept = loadLastKifu()!;
    replayKifu(kept); // 中で reset が走る
    expect(kifuMemoryState()).toBe('pending-discard');
    expect(loadLastKifu()).not.toBeNull();
  });

  it('★v1.41 までの記憶（真偽値 1 つ）も読み直せる＝版が上がって受け皿が消えない', () => {
    discardKifu();
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(6);
    useGameStore.getState().resign('player2');
    const file = loadLastKifu()!;

    localStorage.setItem('shogi.kifu.last', JSON.stringify({ saved: true, file }));
    expect(kifuMemoryState()).toBe('saved');
    localStorage.setItem('shogi.kifu.last', JSON.stringify({ saved: false, file }));
    expect(kifuMemoryState()).toBe('unsaved');
  });

  it('★終局まで指し切る棋譜を再生しても、本物の対局と取り違えない', () => {
    // 再生は盤を作り直して終局まで指し直すので、見張っている側から見ると
    // 「対局が終わった」と同じに見える。取り違えると印が未保存へ戻ってしまう。
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playUntilSennichite();
    expect(useGameStore.getState().status).toBe('sennichite'); // 手だけで終局していること

    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));
    adoptLoadedKifu(file); // 読み込んだ棋譜＝「保存済み」
    expect(kifuMemoryState()).toBe('saved');

    const r = replayKifu(file);
    expect(r.applied).toBe(r.recorded);
    expect(useGameStore.getState().status).not.toBe('playing'); // 再生でも終局まで進む
    expect(kifuMemoryState()).toBe('saved'); // 印が未保存へ戻らないこと
  });

  it('読み込んだ棋譜は「保存済み」で記憶に入る（ファイルが存在するため）', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(4);
    const file = parseKifu(serializeKifu(buildKifuFile(new Date())));

    adoptLoadedKifu(file);
    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(4);
  });
});

/**
 * ★指しかけの対局も、リセットの前に棋譜として残せる（v1.43・2026-08-17 ユーザー報告）。
 *
 * 棋譜が生まれるのは終局の瞬間だけだったので、**対局中にリセットすると、その対局は
 * 保存する機会が一度も無いまま消えていた**。
 */
describe('リセットで指しかけの棋譜を残す', () => {
  function startGame(moves: number): void {
    discardKifu();
    useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
    useAiStore.setState({ enabled: false });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(moves);
  }

  it('★対局中にリセットすると、その時点の棋譜が未保存として残り、確認が出る', () => {
    startGame(6);
    expect(kifuMemoryState()).toBe('empty'); // 終局していないので、まだ記録は無い

    requestNewGame(() => useGameStore.getState().reset(), { twoStep: true });
    expect(useKifuGuardStore.getState().stage).toBe('reset');
    guardResetYes();

    expect(kifuMemoryState()).toBe('unsaved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
    // 保存する／破棄する／やめる が出ている＝ここで残す機会がある
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
  });

  it('「やめる」を選べば盤はそのまま（対局は続く）', () => {
    startGame(6);
    requestNewGame(() => useGameStore.getState().reset(), { twoStep: true });
    guardResetYes();
    guardCancel();

    expect(useGameStore.getState().moveHistory).toHaveLength(6); // 盤は戻っていない
    expect(loadLastKifu()?.moves).toHaveLength(6); // 残した棋譜はそのまま
  });

  it('1 手も指していなければ作らない（残すものが無い）', () => {
    startGame(0);
    requestNewGame(() => useGameStore.getState().reset(), { twoStep: true });
    guardResetYes();

    expect(kifuMemoryState()).toBe('empty');
    expect(useKifuGuardStore.getState().stage).toBeNull(); // 尋ねずにリセットされる
  });

  it('★終局後のリセットでは、生まれている記録を上書きしない', () => {
    startGame(6);
    useGameStore.getState().resign('player2');
    const born = loadLastKifu();
    expect(born?.meta.result.status).toBe('resigned_p2');

    requestNewGame(() => useGameStore.getState().reset(), { twoStep: true });
    guardResetYes();

    // 終局の記録が「指しかけ」で上書きされていないこと
    expect(loadLastKifu()?.meta.result.status).toBe('resigned_p2');
    expect(loadLastKifu()?.meta.savedAt).toBe(born?.meta.savedAt);
  });

  it('★答えの済んでいない棋譜が残っていれば押しのけない', () => {
    startGame(6);
    useGameStore.getState().resign('player2'); // 前の対局の記録（未保存）
    const previous = loadLastKifu()?.meta.savedAt;
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(4); // 新しい対局を指しかける
    expect(kifuMemoryState()).toBe('unsaved'); // 前の対局が未保存のまま残っている

    requestNewGame(() => useGameStore.getState().reset(), { twoStep: true });
    guardResetYes();

    expect(loadLastKifu()?.meta.savedAt).toBe(previous); // 前の対局のまま
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    guardCancel();
  });
});

/**
 * 共有シートとダウンロードの差し替え。
 * jsdom には共有シートが無いので、こちらで名乗らせて経路を作る。
 */
function stubShare(behavior: 'ok' | 'cancel' | 'broken'): ReturnType<typeof vi.fn> {
  const share = vi.fn(async () => {
    if (behavior === 'cancel') {
      // 取り消しは拒否として返る（iOS の実際の返り方）
      const e = new Error('share cancelled');
      e.name = 'AbortError';
      throw e;
    }
    if (behavior === 'broken') throw new Error('share is not working here');
  });
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  return share;
}

function removeShare(): void {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
}

/** ダウンロードが走ったかどうかを見る（走ったらファイル名が積まれる）。 */
function watchDownloads(): string[] {
  const names: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return names;
}

describe('棋譜の書き出し — 保存の成否をどう確かめるか (親 §9.2.3 ③)', () => {
  beforeEach(() => {
    discardKifu();
    useAiStore.setState({ enabled: false });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(8);
    useGameStore.getState().resign('player2');
    expect(kifuMemoryState()).toBe('unsaved');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeShare();
  });

  it('共有に成功すると「保存済み」になり、記憶は残る（もう一度保存でき、再生もできる）', async () => {
    const share = stubShare('ok');
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('saved');
    expect(share).toHaveBeenCalledTimes(1);
    expect(downloads).toHaveLength(0);
    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(8); // 消えていない
  });

  it('★共有を取り消すとダウンロードが走らず、印も「未保存」のまま（v1.40 の欠陥②）', async () => {
    stubShare('cancel');
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('cancelled');
    expect(downloads).toHaveLength(0); // やめたのに保存される、が v1.40 の欠陥
    expect(kifuMemoryState()).toBe('unsaved');
  });

  it('共有そのものが動かない端末はダウンロードへ落ちる（取り消しとは区別する）', async () => {
    stubShare('broken');
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('saved');
    expect(downloads).toHaveLength(1);
    expect(kifuMemoryState()).toBe('saved');
  });

  it('共有を持たない端末（PC）はダウンロードになり、印は「保存済み」・記憶も残る', async () => {
    removeShare();
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('saved');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/\.json$/);
    // 引き渡した先は分からないが、印は保存済みとし、記憶は安全網として残す
    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()).not.toBeNull();
  });

  // ★v1.42: 保存できたことを必ず知らせる（親 v1.40 §9.2.3 ③）。
  // 保存は成功しても画面上では何も起こらないので、**押したのに何も起きなかったのと
  // 区別が付かない**。知らせにはファイル名と書いた場所を載せる。
  it('★共有できたら知らせが出る。ただし置かれた場所は分からないので断定しない', async () => {
    dismissSaveNotice();
    stubShare('ok');
    await saveCurrentKifu();

    const notice = useSaveNoticeStore.getState().notice;
    expect(notice).not.toBeNull();
    expect(notice?.fileName).toMatch(/\.json$/);
    expect(notice?.folderName).toBeNull();
    expect(notice?.verified).toBe(false);
  });

  it('★ダウンロードでも知らせは出るが、確かめられないので断定しない', async () => {
    dismissSaveNotice();
    removeShare();
    watchDownloads();
    await saveCurrentKifu();

    const notice = useSaveNoticeStore.getState().notice;
    expect(notice?.verified).toBe(false);
    expect(notice?.folderName).toBeNull();
  });

  it('★やめたときは知らせを出さない（何も書いていない）', async () => {
    dismissSaveNotice();
    stubShare('cancel');
    watchDownloads();
    expect(await saveCurrentKifu()).toBe('cancelled');
    expect(useSaveNoticeStore.getState().notice).toBeNull();
  });

  it('★フォルダへ書けたときは、書いた場所まで言い切る（読み返して突き合わせている）', async () => {
    dismissSaveNotice();
    const written = new Map<string, string>();
    const dir = {
      kind: 'directory' as const,
      name: '棋譜フォルダ',
      getFileHandle: async (n: string, opts?: { create?: boolean }) => {
        if (!opts?.create && !written.has(n)) throw new Error('not found');
        return {
          kind: 'file' as const,
          name: n,
          getFile: async () => ({ text: async () => written.get(n) ?? '' }) as unknown as File,
          createWritable: async () => ({
            write: async (data: string) => {
              written.set(n, data);
            },
            close: async () => {},
          }),
        };
      },
      values: async function* () {},
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => 'granted' as PermissionState,
    };
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => dir,
      configurable: true,
    });
    try {
      await forgetFolder();
      expect(await saveCurrentKifu()).toBe('saved');

      const notice = useSaveNoticeStore.getState().notice;
      expect(notice?.verified).toBe(true);
      expect(notice?.folderName).toBe('棋譜フォルダ');
      // 実際に書いた名前であること（フォルダの中に同じ名前で入っている）。
      expect(written.has(notice!.fileName)).toBe(true);
    } finally {
      await forgetFolder();
      Reflect.deleteProperty(window, 'showDirectoryPicker');
    }
  });
});

/**
 * ★書き出す対象は「記憶している 1 局」であって、盤ではない（2026-08-16 ユーザー判断）。
 *
 * 棋譜再生は記録された手を初手から並べ直すので、途中まで戻して見ている間、
 * **盤にはそこまでの手しか載っていない**。ここで盤から棋譜を組み立てると、
 * 満額の記録が短いものに化け、しかもそれが記憶へ書き戻されて正本が壊れる。
 * 記録から盤を作るのは順方向・その逆は作らない、を検査で固定する。
 */
describe('★保存の対象は記憶の側（記録 → 盤の一方向）', () => {
  beforeEach(() => {
    discardKifu();
    useAiStore.setState({ enabled: false });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(8);
    useGameStore.getState().resign('player2');
    expect(loadLastKifu()?.moves).toHaveLength(8);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeShare();
  });

  it('途中まで再生した状態で保存しても、書き出されるのは満額の 8 手', async () => {
    removeShare();
    const downloads = watchDownloads();
    const memory = loadLastKifu()!;

    // 3 手目まで戻して見ている状態を作る（盤には 3 手しか載っていない）
    replayKifu(memory, 3);
    expect(useGameStore.getState().position.history).toHaveLength(3);

    expect(await saveCurrentKifu()).toBe('saved');
    expect(downloads).toHaveLength(1);
    // ファイル名の結果欄が 'X'（不成立）なら、指し掛けの盤から作ってしまっている。
    // 末尾の連番はこの端末が何度目に出した名前かで変わるので、そこは見ない。
    const stem = kifuFileName(memory, 0).replace(/\.json$/, '');
    expect(downloads[0].startsWith(stem)).toBe(true);
  });

  it('保存しても記憶の中身は書き戻されない（変わるのは印だけ）', async () => {
    removeShare();
    watchDownloads();
    const before = loadLastKifu()!;

    replayKifu(before, 3);
    await saveCurrentKifu();

    const after = loadLastKifu()!;
    expect(after.moves).toHaveLength(8);
    expect(after.meta.savedAt).toBe(before.meta.savedAt);
    expect(kifuMemoryState()).toBe('saved');
  });

  it('記憶を持てない端末では、いままでどおり盤から組み立てる（記録が生まれる経路と同じ）', async () => {
    removeShare();
    const downloads = watchDownloads();
    discardKifu(); // 記憶が空の状態
    expect(kifuMemoryState()).toBe('empty');

    expect(await saveCurrentKifu()).toBe('saved');
    expect(downloads).toHaveLength(1);
    expect(loadLastKifu()?.moves).toHaveLength(8); // 盤に残っている 8 手から作られる
    expect(kifuMemoryState()).toBe('saved');
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
    expect(kifuFileName(sampleKifu({ gameType: 'custom' }))).toContain('_CUS_');
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

/**
 * 端末のフォルダの代役。**中身は素の文字列で持つ**ので、書いたものが本当に
 * そのまま読み返せるか（＝突き合わせが効いているか）を見られる。
 */
function fakeFolder(name: string, initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const fileHandle = (n: string) => ({
    kind: 'file' as const,
    name: n,
    getFile: async () => ({ text: async () => files.get(n) ?? '' }) as unknown as File,
    createWritable: async () => ({
      write: async (data: string) => {
        files.set(n, data);
      },
      close: async () => {},
    }),
  });
  const dir = {
    kind: 'directory' as const,
    name,
    getFileHandle: vi.fn(async (n: string, opts?: { create?: boolean }) => {
      if (!files.has(n)) {
        if (!opts?.create) throw new Error('NotFoundError');
        files.set(n, '');
      }
      return fileHandle(n);
    }),
    values: async function* () {
      for (const n of [...files.keys()]) yield fileHandle(n);
    },
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
  };
  return { dir: dir as unknown as FsDirHandle, files };
}

/** フォルダを選ぶ画面の代役。`null` を渡すと「やめた」になる。 */
function stubPicker(result: FsDirHandle | null): ReturnType<typeof vi.fn> {
  const picker = vi.fn(async () => {
    if (!result) {
      const e = new Error('picker cancelled');
      e.name = 'AbortError';
      throw e;
    }
    return result;
  });
  Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true });
  return picker;
}

function removePicker(): void {
  Reflect.deleteProperty(window, 'showDirectoryPicker');
}

/**
 * ★PC のフォルダ指定（親 v1.39 §9.2.3 ④）。
 *
 * ここが**保存できたと確実に言える唯一の経路**＝書いた直後に読み返して突き合わせる。
 * 併せて、**フォルダを選ぶのをやめたらダウンロードへ落とさない**ことを固定する
 * （落とすと「やめたのに保存される」＝共有シートで一度直した誤りの繰り返しになる）。
 */
describe('★PC のフォルダ指定 (親 v1.39 §9.2.3 ④)', () => {
  beforeEach(async () => {
    await forgetFolder();
    discardKifu();
    useAiStore.setState({ enabled: false });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    playMoves(8);
    useGameStore.getState().resign('player2');
    expect(kifuMemoryState()).toBe('unsaved');
  });

  afterEach(async () => {
    await forgetFolder();
    vi.restoreAllMocks();
    removePicker();
    removeShare();
  });

  it('フォルダへ書き、読み返して一致すれば「保存済み」になる', async () => {
    const { dir, files } = fakeFolder('棋譜');
    stubPicker(dir);
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('saved');
    expect(downloads).toHaveLength(0); // フォルダがあるならダウンロードは使わない
    expect(files.size).toBe(1);
    expect(parseKifu([...files.values()][0]).moves).toHaveLength(8);
    expect(kifuMemoryState()).toBe('saved');
  });

  it('★選ぶのをやめたら何も書かず、ダウンロードにも落とさない（印は未保存のまま）', async () => {
    stubPicker(null);
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('cancelled');
    expect(downloads).toHaveLength(0);
    expect(kifuMemoryState()).toBe('unsaved');
    expect(loadLastKifu()?.moves).toHaveLength(8); // 記憶は残る＝押し直せる
  });

  it('一度指定したら、次からは尋ねずにそのフォルダへ書く', async () => {
    const { dir, files } = fakeFolder('棋譜');
    const picker = stubPicker(dir);

    expect(await saveCurrentKifu()).toBe('saved');
    expect(await saveCurrentKifu()).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    expect(files.size).toBe(2); // 1 局 1 ファイル＝上書きしない
  });

  it('★書き戻せなかったら「保存済み」と言わない（読み返して突き合わせる）', async () => {
    const { dir } = fakeFolder('棋譜');
    // 書いたものと違う中身が返ってくる＝書けたつもりの状態を作る
    (dir as unknown as { getFileHandle: unknown }).getFileHandle = async () => ({
      getFile: async () => ({ text: async () => '別の中身' }),
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    stubPicker(dir);

    expect(await saveCurrentKifu()).toBe('failed');
    expect(kifuMemoryState()).toBe('unsaved');
  });

  it('★同じ名前が既にあるときは連番を送る（あるファイルを上書きしない）', async () => {
    const base = kifuFileName(loadLastKifu()!, 0);
    const { dir, files } = fakeFolder('棋譜', { [base]: '先にあった中身' });
    stubPicker(dir);

    expect(await saveCurrentKifu()).toBe('saved');
    expect(files.get(base)).toBe('先にあった中身'); // 触っていない
    expect(files.size).toBe(2);
    expect([...files.keys()][1]).toBe(base.replace(/\.json$/, '_2.json'));
  });

  it('フォルダを扱えない端末は、いままでどおり共有シート・ダウンロードへ落ちる', async () => {
    removePicker();
    removeShare();
    const downloads = watchDownloads();

    expect(await saveCurrentKifu()).toBe('saved');
    expect(downloads).toHaveLength(1);
  });

  it('一覧はフォルダの中の棋譜から組み立て、棋譜でないファイルは黙って飛ばす', async () => {
    const { dir } = fakeFolder('棋譜', {
      'a.json': serializeKifu(sampleKifu()),
      'b.json': 'これは棋譜ではありません',
      'memo.txt': serializeKifu(sampleKifu()),
    });

    const list = await listFolderKifu(dir);
    expect(list).toHaveLength(1); // 棋譜 1 件だけ（.txt は見ない・壊れた JSON は飛ばす）
    expect(list[0].meta.gameType).toBe('shogi');
  });

  it('★一覧を開くだけではフォルダを選ばせない（保存のときだけ尋ねる）', async () => {
    const { dir } = fakeFolder('棋譜');
    const picker = stubPicker(dir);

    expect((await usableFolder('permission')).kind).toBe('none');
    expect(picker).not.toHaveBeenCalled();

    expect((await usableFolder('choose')).kind).toBe('ready');
    expect(picker).toHaveBeenCalledTimes(1);
  });

  /**
   * ★2026-08-26 実機のご報告＝**アプリ内蔵ブラウザは「フォルダを選べます」と名乗るのに、
   * 呼んでも窓が出ず、成功も失敗も返してこない**。v1.90 まではここで**永久に待ち、
   * 利用者には何も出なかった**（押しても何も起きないように見える）。
   */
  describe('★返事が返ってこない環境（アプリ内蔵ブラウザ）', () => {
    /** **成功も失敗も返さない**窓の代役（内蔵ブラウザで起きていること）。 */
    function stubSilentPicker(): ReturnType<typeof vi.fn> {
      const picker = vi.fn(() => new Promise<never>(() => {}));
      Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true });
      return picker;
    }

    it('★待ち続けず、共有シート・ダウンロードへ落とす（保存はやめない）', async () => {
      vi.useFakeTimers();
      try {
        stubSilentPicker();
        removeShare();
        const downloads = watchDownloads();

        const saving = saveCurrentKifu();
        await vi.advanceTimersByTimeAsync(6000);

        expect(await saving).toBe('saved');
        expect(downloads).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('★窓が出ている間は見切らない（人が選んでいる途中で二重に保存しない）', async () => {
      vi.useFakeTimers();
      try {
        stubSilentPicker();
        removeShare();
        const downloads = watchDownloads();

        let done = false;
        void saveCurrentKifu().then(() => {
          done = true;
        });
        // ★**窓を開くところまで進めてから**知らせる＝保存は控えを読むところから
        // 始まるので、押した直後にはまだ窓を開いていない（見張りも付いていない）。
        await vi.advanceTimersByTimeAsync(0);
        // **窓が出た**＝画面がいったん裏へ回る。人が選んでいる途中なので待ち続ける。
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(60000);

        expect(done).toBe(false);
        expect(downloads).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('★一度見切ったら、次の保存では待ち直さない', async () => {
      vi.useFakeTimers();
      try {
        const picker = stubSilentPicker();
        removeShare();
        const downloads = watchDownloads();

        const first = saveCurrentKifu();
        await vi.advanceTimersByTimeAsync(6000);
        expect(await first).toBe('saved');

        // 2 回目は窓を呼ばずに落とす＝**毎回 5 秒待たされない**。
        expect(await saveCurrentKifu()).toBe('saved');
        expect(picker).toHaveBeenCalledTimes(1);
        expect(downloads).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
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
