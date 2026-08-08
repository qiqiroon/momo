/**
 * 段階2・段階4 で計測する検証事項（実装指示書 5章）
 *
 * - V-01 チャンク容量：既定25問のときの1チャンクの大きさと、在庫を取りきるまでの総通信量
 * - V-02 localStorage 容量：既出200件×7サイズ＋成績＋中断セッション（49×49 が最大）
 * - V-03 49×49 の中断保存が可視性変化の処理時間内に終わるか
 * - V-07 候補メモの相互変換コスト（49×49）
 * - V-08 Easy 49×49 の候補自動算出が入力応答を妨げないか
 * - V-09 Undo 100手のメモリ量
 *
 * 数字は検査の出力に残す。判定は「壁に対して余裕があるか」だけを見る。
 * **時間の計測は機械によってぶれる。** 判定の閾値は桁で外れたときだけ落ちるよう広く取る。
 */

import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { RECENT_BUFFER_SIZE, STORAGE_VERSION } from '../data/config';
import { BOARD_SIZES, type BoardSize, type StatsEntry, type StatsKey } from '../data/types';
import * as board from '../game/board';
import type { BoardState } from '../game/board';
import * as notes from '../game/notes';
import * as session from '../game/session';
import * as undoStack from '../history/undoStack';
import { identityParams } from '../transform/params';
import {
  columnsFor,
  PALETTE_GAP_PX,
  PALETTE_KEY_PX,
} from '../ui/components/NumberPalette';
import { create as createLayout } from '../ui/canvas/layout';
import { decide as decideLod } from '../ui/canvas/lod';
import { bubbleGeometries, rectContains as contains, test as hitTest } from '../ui/canvas/hitTest';
import { cellPx as cellPxOf, initial as initialViewport } from '../ui/canvas/viewport';
import {
  HINT_CLOSE_SIZE,
  LOD_COMPACT_PX,
  LOD_FULL_PX,
  MIN_TOUCH_PX,
} from '../ui/config';
import { readDataText, sizeDirName, syntheticPuzzle } from './fixtures';

const KB = 1024;

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

describe('V-01 チャンク容量（3.3.4 / 5.2）', () => {
  it('在庫のある5サイズの1チャンクの大きさを測る', () => {
    const rows: string[] = [];
    let perPuzzle25 = 0;

    for (const n of [1, 4, 9, 16, 25] as BoardSize[]) {
      const text = readDataText(`${sizeDirName(n)}/c0000.json`);
      const raw = bytesOf(text);
      const gz = gzipSync(Buffer.from(text, 'utf-8')).length;
      const count = (JSON.parse(text) as { count: number }).count;
      const each = raw / count;
      if (n === 25) perPuzzle25 = each;

      rows.push(
        `  ${String(n).padStart(2)}×${String(n).padEnd(2)} ` +
          `1チャンク ${(raw / KB).toFixed(1)}KB（gzip ${(gz / KB).toFixed(1)}KB・${((gz / raw) * 100).toFixed(0)}%）` +
          ` / ${count}問 → 1問 ${(each / KB).toFixed(2)}KB`,
      );
    }

    // 在庫の無い 36 / 49 は、1セルあたりの大きさから見積もる
    const perCell25 = perPuzzle25 / (25 * 25);
    for (const n of [36, 49] as BoardSize[]) {
      const est = perCell25 * n * n * 25;
      rows.push(
        `  ${n}×${n} 1チャンク（見積り）${(est / KB).toFixed(1)}KB ＝ ${(est / KB / KB).toFixed(2)}MB`,
      );
    }

    console.log('\n[V-01] チャンク容量（非圧縮 / gzip）\n' + rows.join('\n'));

    // 49×49 の見積りが仕様書 5.2 の約0.34MB と桁で食い違っていないこと
    const est49 = perCell25 * 49 * 49 * 25;
    expect(est49 / KB / KB).toBeGreaterThan(0.15);
    expect(est49 / KB / KB).toBeLessThan(0.7);
  });

  it('在庫を取りきるまでの取得回数と総通信量を出す', () => {
    const rows: string[] = [];
    for (const n of [1, 4, 9, 16, 25] as BoardSize[]) {
      const index = JSON.parse(readDataText(`${sizeDirName(n)}/index.json`)) as {
        chunks: { file: string }[];
      };
      let total = 0;
      let gzTotal = 0;
      for (const c of index.chunks) {
        const text = readDataText(`${sizeDirName(n)}/${c.file}`);
        total += bytesOf(text);
        gzTotal += gzipSync(Buffer.from(text, 'utf-8')).length;
      }
      rows.push(
        `  ${String(n).padStart(2)}×${String(n).padEnd(2)} ${index.chunks.length}回で全部 ` +
          `→ ${(total / KB).toFixed(1)}KB（gzip ${(gzTotal / KB).toFixed(1)}KB）`,
      );
    }
    console.log('\n[V-01] 熱心な利用者が在庫を取りきる場合\n' + rows.join('\n'));
    expect(rows).toHaveLength(5);
  });
});

describe('V-02 localStorage 容量（5.2）', () => {
  it('既出・成績・中断の合計が 5MB の壁に対してどれだけかを測る', () => {
    // 既出：200件 × 7サイズ。IDは実物と同じ桁で作る
    const buffers: Partial<Record<BoardSize, string[]>> = {};
    for (const n of BOARD_SIZES) {
      buffers[n] = Array.from(
        { length: RECENT_BUFFER_SIZE },
        (_, i) => `N${n}-${String(i + 1).padStart(6, '0')}`,
      );
    }
    const recentBytes = bytesOf(
      JSON.stringify({ schemaVersion: STORAGE_VERSION, bufferSize: RECENT_BUFFER_SIZE, buffers }),
    );

    // 成績：7サイズ × 3難易度がすべて埋まった状態
    const entries = {} as Record<StatsKey, StatsEntry>;
    for (const n of BOARD_SIZES) {
      for (const d of ['Easy', 'Hard', 'Apocalypse'] as const) {
        entries[`${n}:${d}`] = {
          clearCount: 9999,
          failedCount: 9999,
          bestTimeMs: 5999999,
          hintUsedTotal: 99999,
          playCount: 99999,
        };
      }
    }
    const statsBytes = bytesOf(
      JSON.stringify({ schemaVersion: STORAGE_VERSION, entries, updatedAt: new Date().toISOString() }),
    );

    // 中断：49×49 でいちばん重くなる形（候補メモが全セル全数字で埋まっている）
    const cells = 49 * 49;
    const worstNotes = Array.from({ length: cells }, () =>
      Array.from({ length: 49 }, (_, k) => k + 1),
    );
    const typicalNotes = Array.from({ length: cells }, (_, i) =>
      i % 2 === 0 ? [] : [1, 2, 3, 4, 5],
    );
    const sessionBase = {
      schemaVersion: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      sourceId: 'N49-000001',
      n: 49,
      difficulty: 'Apocalypse',
      transformParams: { rotation: 2, mirror: true, symbols: Array.from({ length: 49 }, (_, i) => i + 1) },
      entered: Array.from({ length: cells }, (_, i) => (i % 50) % 49),
      elapsedMs: 3600000,
      mistakeCount: 3,
      failed: false,
      hintUsed: 7,
    };
    const worstSession = bytesOf(JSON.stringify({ ...sessionBase, notes: worstNotes }));
    const typicalSession = bytesOf(JSON.stringify({ ...sessionBase, notes: typicalNotes }));

    const worstTotal = recentBytes + statsBytes + worstSession;
    const typicalTotal = recentBytes + statsBytes + typicalSession;

    console.log(
      '\n[V-02] localStorage の見込み（5MB 制限に対して）\n' +
        `  既出 200件×7サイズ      ${(recentBytes / KB).toFixed(1)}KB\n` +
        `  成績 7サイズ×3難易度    ${(statsBytes / KB).toFixed(1)}KB\n` +
        `  中断 49×49（ふつう）    ${(typicalSession / KB).toFixed(1)}KB\n` +
        `  中断 49×49（最悪）      ${(worstSession / KB).toFixed(1)}KB ＝ ${(worstSession / KB / KB).toFixed(2)}MB\n` +
        `  ── 合計（ふつう）       ${(typicalTotal / KB).toFixed(1)}KB（5MB の ${((typicalTotal / (5 * KB * KB)) * 100).toFixed(1)}%）\n` +
        `  ── 合計（最悪）         ${(worstTotal / KB).toFixed(1)}KB（5MB の ${((worstTotal / (5 * KB * KB)) * 100).toFixed(1)}%）`,
    );

    // いちばん重い形でも 5MB を超えないこと
    expect(worstTotal).toBeLessThan(5 * KB * KB);
  });
});

// ================================================================ 段階4 の計測

const N49 = 49 as BoardSize;
const B49 = 7;

/** 49×49 の盤面を作る。**在庫が空のサイズなので合成の完成盤を使う**（貯まったら実物へ） */
function board49(difficulty: 'Easy' | 'Apocalypse'): BoardState {
  const created = board.create({
    puzzle: { ...syntheticPuzzle(N49, B49), difficulty },
    params: identityParams(N49, B49),
    difficulty,
  });
  if (!created.ok) throw new Error(`49×49 の盤面を作れない: ${created.error.message}`);
  return created.value;
}

/** 候補メモを全セル全数字で埋める。中断保存がいちばん重くなる形 */
function fillAllNotes(state: BoardState): void {
  const all = Array.from({ length: state.n }, (_, i) => i + 1);
  for (let index = 0; index < state.n * state.n; index++) {
    if (state.given[index] !== 0) continue;
    notes.setValues(state.notes, index, all);
  }
}

function ms(fn: () => void, times = 1): number {
  const start = performance.now();
  for (let i = 0; i < times; i++) fn();
  return (performance.now() - start) / times;
}

describe('V-03 / V-07 中断保存と候補の相互変換（49×49）', () => {
  it('いちばん重い形でも、画面が隠れたときの処理として間に合う', () => {
    const state = board49('Apocalypse');
    fillAllNotes(state);
    const play = session.begin({
      puzzle: { ...syntheticPuzzle(N49, B49), difficulty: 'Apocalypse' },
      difficulty: 'Apocalypse',
      params: identityParams(N49, B49),
    });
    if (!play.ok) throw new Error('セッションを作れない');
    play.value.board = state;

    // V-07 相互変換のみ
    const toArraysMs = ms(() => void notes.toArrays(state.notes), 5);
    const arrays = notes.toArrays(state.notes);
    const fromArraysMs = ms(() => void notes.fromArrays(arrays, N49), 5);

    // V-03 中断保存ひと通り（像の構築 → 文字列化。localStorage への書き込み手前まで）
    const buildMs = ms(() => void session.toSuspended(play.value), 5);
    const suspended = session.toSuspended(play.value);
    const jsonMs = ms(() => void JSON.stringify(suspended), 5);
    const bytes = Buffer.byteLength(JSON.stringify(suspended), 'utf-8');

    console.log(
      '\n[V-07 / V-03] 49×49 の中断保存（候補メモが全マス埋まった最悪の形）\n' +
        `  候補 → 値配列            ${toArraysMs.toFixed(1)}ms\n` +
        `  値配列 → 候補            ${fromArraysMs.toFixed(1)}ms\n` +
        `  中断の像を作る           ${buildMs.toFixed(1)}ms\n` +
        `  文字列にする             ${jsonMs.toFixed(1)}ms（${(bytes / KB).toFixed(0)}KB）\n` +
        `  ── 保存ひと通り          ${(buildMs + jsonMs).toFixed(1)}ms`,
    );

    // 可視性の変化で走らせる処理として現実的な範囲に収まること
    expect(buildMs + jsonMs).toBeLessThan(1000);
    expect(fromArraysMs).toBeLessThan(1000);
  });
});

describe('V-08 Easy 49×49 の候補自動算出', () => {
  it('1入力ごとの再算出が入力の応答を妨げない', () => {
    const state = board49('Easy');

    const targets: number[] = [];
    for (let i = 0; i < state.n * state.n && targets.length < 20; i++) {
      if (state.given[i] === 0) targets.push(i);
    }

    let total = 0;
    for (const index of targets) {
      total += ms(() => void board.place(state, index, state.solution[index]));
    }
    const each = total / targets.length;

    console.log(
      '\n[V-08] Easy 49×49 の1入力あたりの再算出（対象は約145セル）\n' +
        `  1入力 ${each.toFixed(1)}ms（${targets.length}回の平均）`,
    );

    // 遅延実行（描画対象セルのみ先行算出）へ切り替える必要が出るのは、この桁を超えたときである
    expect(each).toBeLessThan(100);
  });
});

describe('V-09 履歴100手のメモリ量（49×49）', () => {
  it('`UNDO_LIMIT_DEFAULT` を100手のままにしてよいかを測る', () => {
    const state = board49('Apocalypse');
    fillAllNotes(state);
    const undo = undoStack.create();

    const before = process.memoryUsage().heapUsed;
    let cellsPerEntry = 0;
    let placed = 0;
    for (let index = 0; index < state.n * state.n && placed < 100; index++) {
      if (state.given[index] !== 0) continue;
      const outcome = board.place(state, index, state.solution[index]);
      if (outcome.entry) {
        cellsPerEntry = outcome.entry.noteDelta.length;
        undoStack.push(undo, outcome.entry);
        placed++;
      }
    }
    const after = process.memoryUsage().heapUsed;

    // 1セル分の差分は「位置1つ＋ワード列」。49×49 は1セル2ワードである
    const wordsPerCell = state.notes.wordsPerCell;
    const estimate = 100 * cellsPerEntry * (wordsPerCell + 1) * 8;

    console.log(
      '\n[V-09] Undo 100手（49×49・関連セルは1手あたり約145）\n' +
        `  1手あたりの記録セル数    ${cellsPerEntry}\n` +
        `  1セルのワード数          ${wordsPerCell}\n` +
        `  見積り（数値8バイト換算）${(estimate / KB).toFixed(0)}KB\n` +
        `  実測のヒープ増加         ${((after - before) / KB).toFixed(0)}KB（履歴以外の一時的な割り当ても混じる上限側の数字）`,
    );

    expect(undo.entries).toHaveLength(100);
    // 見積りが MB の桁へ届かないこと（届くなら上限100手を見直す）
    expect(estimate).toBeLessThan(KB * KB);
  });
});

// ---------------------------------------------------------------- 段階7 前半

/**
 * V-14 スマートフォン縦画面での数値パレット実寸（受入条件 7-1）。
 *
 * 実機の見た目は実機でしか確かめられないが、**寸法そのものは算数で決まる**。
 * ボタン 44px・間隔 6px・左右余白 16px という決めから、幅ごとに何列入るかと、
 * パレットが縦にどれだけ場所を取るかを出す。**盤面に残る高さ**が判定の対象である。
 */
describe('V-14 数値パレットの実寸（8.4 / 7-1）', () => {
  it('スマートフォン縦画面で、44px を守ったときのパレットの高さを出す', () => {
    const KEY = PALETTE_KEY_PX;
    const GAP = PALETTE_GAP_PX;
    const SIDE_PADDING = 16 * 2;
    // 代表的なスマートフォン縦画面（CSS px）。iPhone SE / 標準 / 大型
    const widths = [320, 375, 430];
    const rows: string[] = [];

    for (const width of widths) {
      const usable = width - SIDE_PADDING;
      const fit = Math.max(1, Math.floor((usable + GAP) / (KEY + GAP)));
      const parts: string[] = [];
      for (const n of BOARD_SIZES) {
        const b = Math.round(Math.sqrt(n));
        const columns = Math.min(columnsFor(n, b), fit);
        const lines = Math.ceil(n / columns);
        parts.push(`${n}:${columns}列${lines}行=${lines * KEY + (lines - 1) * GAP}px`);
      }
      rows.push(`  幅${width}px（使える幅 ${usable}px・最大 ${fit}列）  ${parts.join('  ')}`);
    }

    // 画面の高さの目安（iPhone SE 568 / 標準 667〜844）から、盤面に残る高さを出す
    const HEADER = 57;
    const STATUS = 32;
    const ACTIONS = 44 * 2 + 10; // 操作ボタンは折り返して2段になりうる
    const usable = 375 - 32;
    const fit375 = Math.floor((usable + GAP) / (KEY + GAP));
    const worst = Math.ceil(49 / Math.min(columnsFor(49, 7), fit375));
    const paletteHeight = worst * KEY + (worst - 1) * GAP;
    const boardHeight667 = 667 - HEADER - STATUS - ACTIONS - paletteHeight - 20;

    console.log(
      [
        '',
        '[V-14] 数値パレットの実寸（ボタン44px・間隔6px・左右余白16px）',
        ...rows,
        `  幅375px・高さ667px の 49×49 では パレット ${paletteHeight}px、盤面に残る高さ ${boardHeight667}px`,
        '  ※ 49×49 は在庫が空でまだ遊べない。実機での確認は在庫を貯めてから',
      ].join('\n'),
    );

    // 在庫のある5サイズは、狭い画面でも盤面に十分な高さが残ることを確かめる
    for (const n of [1, 4, 9, 16, 25] as BoardSize[]) {
      const b = Math.round(Math.sqrt(n));
      const columns = Math.min(columnsFor(n, b), fit375);
      const lines = Math.ceil(n / columns);
      const height = lines * KEY + (lines - 1) * GAP;
      const board667 = 667 - HEADER - STATUS - ACTIONS - height - 20;
      expect(board667, `${n}×${n} の盤面に残る高さ`).toBeGreaterThan(200);
    }
  });
});

// ---------------------------------------------------------------- 段階7 後半

/**
 * V-16 ルーペ閾値 24px の妥当性（7.1）／ V-17 49×49 の fit倍率で俯瞰が成立するか（5.2）
 *
 * どちらも**盤面いっぱいに表示したときのセル実寸**が答えを決める。
 * ルーペは「小さすぎて読めない」ときに出るべきもので、**読める大きさのうちは出てはいけない。**
 * 俯瞰は逆に「読めなくてよいが、埋まり具合は分かる」ことが要る。
 */
describe('V-16 / V-17 fit表示のセル実寸・ルーペ・俯瞰（5.2 / 6.2 / 7.1）', () => {
  it('全サイズについて、盤面いっぱいのときのセル実寸と表示の段を出す', () => {
    // 代表的なスマートフォン縦画面の盤面領域（幅375px・V-14 の残り高さの目安）
    const AREA = 343;
    const rows: string[] = [];
    let cellPx49 = 0;

    for (const n of BOARD_SIZES) {
      const layout = createLayout(n);
      const vp = initialViewport(layout, AREA, AREA);
      const px = cellPxOf(vp, layout);
      if (n === 49) cellPx49 = px;
      const lod = decideLod(px, null);
      rows.push(
        `  ${String(n).padStart(2)}×${String(n).padEnd(2)} セル ${px.toFixed(1).padStart(5)}px  ` +
          `表示=${lod.padEnd(7)}`,
      );
    }

    console.log(
      [
        '',
        `[V-16 / V-17] 盤面いっぱい（fit倍率）のセル実寸　盤面領域 ${AREA}×${AREA}px`,
        ...rows,
        `  閾値：FULL ${LOD_FULL_PX}px 以上／MINIMAL ${LOD_COMPACT_PX}px 未満`,
        '  ※ ルーペは自分で開く道具になったため、この表からは外した（C-189）',
      ].join('\n'),
    );

    // V-16: 読める大きさ（FULL）のうちはルーペを出さない。出すと画面を無駄に覆う
    for (const n of BOARD_SIZES) {
      const layout = createLayout(n);
      const vp = initialViewport(layout, AREA, AREA);
      const px = cellPxOf(vp, layout);
      if (decideLod(px, null) === 'FULL') {
      }
    }

    /**
     * **ルーペの自動有効化は廃止した**（C-189）。自分で開く道具になったため、
     * 「このサイズではルーペが出る／出ない」という見込みそのものが意味を持たなくなった。
     */

    // V-17: 携帯の盤面領域（343px）では 49×49 のセルは 6.7px しかなく、**塗りだけになる**。
    // C-181 で境目を 8px へ下げたが、**それでも届かない**（届くのは据置機の広い画面である）
    expect(decideLod(cellPx49, null)).toBe('MINIMAL');
    // つぶれても「何かある」と分かる大きさは要る。**2px は最低限の壁である**
    expect(cellPx49).toBeGreaterThan(2);
  });
});

/**
 * V-18 ヒント × のヒット領域の重なり（10.4 / 受入条件 7-4）
 *
 * × の見た目は 20px だが、判定は 44px まで広げてある（タッチ最小寸法）。
 * **広げたぶん、隣り合う吹き出しの判定は重なりうる。** 重なったときに
 * 「押したのと違う吹き出しが閉じる」ことが起きないかを見る。
 */
describe('V-18 ヒント × のヒット領域（10.4 / 7-4）', () => {
  it('吹き出しが密集したときの重なりと、実際にどれが閉じるかを出す', () => {
    const n: BoardSize = 25;
    const layout = createLayout(n);
    // 25×25 を盤面いっぱいに出すと、セルは 13px 前後になる＝いちばん密集する条件
    const vp = initialViewport(layout, 343, 343);
    const cell = cellPxOf(vp, layout);

    // 同じ行の隣り合う4セルへ吹き出しを出す（提示順＝奥から手前）
    const hints = [0, 1, 2, 3].map((offset) => ({
      index: 12 * n + 8 + offset,
      value: 7,
      issuedAt: 1000 + offset,
    }));
    const geoms = bubbleGeometries(layout, vp, hints);

    // 重なりの量（隣どうしの × 判定の重なり幅）
    const overlaps: string[] = [];
    for (let i = 1; i < geoms.length; i++) {
      const previous = geoms[i - 1].closeHit;
      const current = geoms[i].closeHit;
      const overlapX = Math.min(previous.x + previous.w, current.x + current.w) - Math.max(previous.x, current.x);
      overlaps.push(`${overlapX > 0 ? overlapX.toFixed(1) : '0'}px`);
    }

    /**
     * その × が**画面で見えているか**。あとから描いた吹き出しに覆われていれば見えない。
     * 覆われた × は押せなくて正しい（手前のものを先に閉じることになる）。
     */
    const visible = geoms.map((geometry, index) => {
      const x = geometry.close.x + geometry.close.w / 2;
      const y = geometry.close.y + geometry.close.h / 2;
      return !geoms.slice(index + 1).some((later) => contains(later.box, x, y));
    });

    // 見えている × の中心を押したとき、実際に閉じるのはどれか
    const results = geoms.map((geometry, index) => {
      if (!visible[index]) return null;
      const x = geometry.close.x + geometry.close.w / 2;
      const y = geometry.close.y + geometry.close.h / 2;
      const hit = hitTest(x, y, layout, vp, hints);
      return hit.kind === 'HINT_CLOSE' && hit.index === geometry.hint.index;
    });

    console.log(
      [
        '',
        `[V-18] ヒント × のヒット領域（${n}×${n}・盤面いっぱい・セル ${cell.toFixed(1)}px）`,
        `  × の見た目 ${HINT_CLOSE_SIZE}px ／ 判定 ${MIN_TOUCH_PX}px`,
        `  隣り合う判定の重なり  ${overlaps.join(' / ')}`,
        `  × が見えているか      ${visible.map((ok) => (ok ? '見える' : '覆われる')).join(' / ')}`,
        `  見えている × を押した結果  ${results.map((ok) => (ok === null ? '—' : ok ? '○' : '×')).join(' ')}`,
        '  ※ 覆われた × は押せない。手前の吹き出しを先に閉じることになる（10.3）',
      ].join('\n'),
    );

    // **見えている × を押せば、必ずそれが閉じる。** 判定を広げたぶんで取り違えない（7-4）
    expect(results.every((ok) => ok !== false)).toBe(true);
    expect(visible.some((ok) => ok)).toBe(true);
  });
});
