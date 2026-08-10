/**
 * 画面の高さを実測して土台へ渡す（C-207）
 *
 * 段階7 までは、土台（`.app`）の高さを CSS の「画面いっぱい」（`100dvh`）に任せていた。
 * ところが **iPhone の横画面では、この値が実際に見えている範囲より下まで伸びることがある**。
 * 起こり方は環境によっていくつかある（回転した直後に古い値のまま返る／ブラウザの帯が
 * 中身の上に重なる／`dvh` を解さない）が、**現れ方はどれも同じ**である。
 *
 *   - 盤面の「全体」が、見えていない下側まで含めて収めようとする（下が欠ける）
 *   - 画面いっぱいに重ねるダイアログが、見えている範囲より下を中心にして置かれ、
 *     下のボタンが帯の裏に入る（押しても効かない・そもそも見えない）
 *
 * **どの数字が本当かをブラウザ任せにせず、こちらで測る。** ブラウザが答える2つの高さ
 * ——器としての高さ（`documentElement.clientHeight`）と、いま実際に見えている高さ
 * （`visualViewport`）——の**小さいほうを採る。** どちらが正しいかは環境によるが、
 * **小さいほうを採るかぎり「見えていないところまで広げる」ことは起こらない。**
 *
 * この選び方には、もう一つ効き目がある。ホームバーの帯は器のほうの高さから除かれるので、
 * **見えている高さがその帯を含んでいても、小さいほうを採れば巻き込まれない。**
 */

import { useEffect } from 'react';
import { diagnostics } from '../data/diagnostics';

/** 実測した高さを渡す変数名。CSS 側はこれを最優先で使う */
export const APP_HEIGHT_VAR = '--app-height';

/**
 * 回転した直後に測り直す時刻（ミリ秒）
 *
 * **向きが変わった合図が来た瞬間は、まだ新しい寸法になっていないことがある。**
 * 1回だけ遅らせても足りない端末があるため、二度に分けて測り直す。
 * 同じ値なら書き込みは起こらないので、余分に測っても害は無い。
 */
const RECHECK_MS = [120, 400] as const;

/**
 * 「ブラウザの飾りが全部出ているときの高さ」を尋ねる物差し（C-212）
 *
 * **携帯の横画面には高さが2つある。** ブラウザの帯が出ているときと、引っ込んだとき——
 * 実機の記録では 334 と 393 で、**その差 59px がちょうど帯の高さ**であった。
 * 器も見えている高さも、**引っ込んだときは 393 と答える。** そのまま採ると、
 * 帯が戻ってきた瞬間に下 59px が帯の裏へ入る（＝画面が拡大したように見える）。
 *
 * CSS には**この「いちばん狭いときの高さ」を指す単位**（`svh`）がある。
 * 数字では尋ねられないので、**その高さを持つ見えない物差しを1本立てて実寸を読む。**
 *
 * **狭いほうへ倒すので、帯が引っ込んでいるあいだは下に余白ができる。** それは承知のうえで、
 * **いつ帯が出てきても操作できることを優先する**（隠れたボタンは押せないが、余白は押せる）。
 */
const PROBE_ID = 'momo-sudoku-viewport-probe';

function smallViewportHeight(win: Window): number {
  const doc = win.document;
  if (!doc.body) return 0;

  let probe = doc.getElementById(PROBE_ID);
  if (probe === null) {
    probe = doc.createElement('div');
    probe.id = PROBE_ID;
    // 見えず・触れず・場所も取らない。**高さを尋ねるためだけに立てる**
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none;z-index:-1';
    doc.body.appendChild(probe);
  }
  return probe.getBoundingClientRect().height;
}

/**
 * いま使ってよい高さ（CSS px）。測れなければ 0 を返す。
 *
 * 純粋な関数として切り出してある（副作用は `applyAppHeight` が持つ）。
 */
export function measureAppHeight(win: Window): number {
  const heights: number[] = [];

  const client = win.document?.documentElement?.clientHeight ?? 0;
  if (client > 0) heights.push(client);

  const visual = win.visualViewport;
  if (visual && visual.height > 0) {
    // **見えている高さは、そのまま使う**（C-213）。
    //
    // v0.07〜v0.09 では、ここで倍率を掛けて「等倍のときの高さ」へ戻していた。
    // 指で広げている（ピンチ）あいだに器まで縮むのを避けるつもりだったが、
    // **携帯を横にしたときにブラウザが自分でページを拡大することがあり、
    // その拡大まで打ち消していた。** 結果、実際には半分ほどしか見えていないのに
    // 「全部見えている」ものとして器を組み、下がはみ出していた
    // （「表示したあと拡大する」という形で出た）。
    //
    // **見えている高さとは、いま実際に目に入っている範囲の広さである。**
    // 拡大されているならそのぶん狭いのが正しく、器もそれに合わせるのが正しい。
    // 拡大の理由（ブラウザの都合か、指で広げたのか）を見分ける必要は無い。
    heights.push(visual.height);
  }

  // **飾りが全部出ているときの高さ**（C-212）。上の2つは飾りが引っ込むと大きく答えるため、
  // これを混ぜないと、帯が戻ってきた瞬間に下が隠れる
  const small = smallViewportHeight(win);
  if (small > 0) heights.push(small);

  if (heights.length === 0) return win.innerHeight > 0 ? win.innerHeight : 0;
  return Math.round(Math.min(...heights));
}

/**
 * 測った高さを CSS 変数へ書き込む。書き込んだ値を返す（測れなければ 0・何も書かない）
 *
 * **値が変わったときだけ、そのときの内訳を控える**（C-210）。
 * 「画面の大きさを取り違えているように見える」という指摘は、**その瞬間の1枚では確かめられない**
 * ——傾けた前後でどう動いたかを並べて初めて分かる。毎回書くと記録が溢れるので変わった瞬間だけにする。
 */
/**
 * 向きごとに「いちばん狭かった高さ」を覚える（C-214）
 *
 * **実機の記録が、この扱いを求めていた。**
 *
 *     #13 窓 734×334 / 器 393 / 見え 334 / 採用 334
 *     #14 窓 734×393 / 器 393 / 見え 393 / 採用 393
 *
 * **#13 では「入れ物は 393」と言いながら、実際に目に入っているのは 334 しかない**
 * ——ブラウザの帯が上に乗っている状態である。ところが 0.3 秒後に「見え」も 393 に変わり、
 * **以後 334 には戻らない。** 帯が引っ込んだのか、回転の途中で一瞬だけ全部見えたのか。
 * どちらであれ、**大きいほうを掴んだまま握り続ける**ため、アプリは 393 のつもりで組み、
 * 実際には 334 しか見えていない状態になる。差の 59 が、そのまま下からはみ出す。
 *
 * したがって **一度でも「これだけしか見えていない」と答えた画面では、以後もその狭いほうに合わせる。**
 * 大きいほうの申告が来ても乗り換えない。帯が本当に引っ込んでいるあいだは下に余白が出るが、
 * **いつ帯が戻ってきても全部操作できるほうを採る**（隠れたボタンは押せないが、余白は押せる）。
 *
 * 覚え直すのは**向きが変わったとき**（窓の幅が変わったとき）である。縦と横で別々に覚える。
 *
 * **この扱いは指で操作する端末だけに効かせる。** マウスの端末では窓の大きさがそのまま正しく、
 * 「小さかったときを覚える」と窓を広げたときに戻らなくなる。
 */
interface Smallest {
  width: number;
  height: number;
}
let smallest: Smallest | null = null;

/** 検査用。覚えていることを忘れさせる */
export function forgetSmallest(): void {
  smallest = null;
}

/**
 * 実際に使う高さを決める。
 *
 * `zoomed` のあいだは覚えない——**指で広げているだけの一時的な狭さ**を、
 * その向きの答えとして握ってしまわないためである。
 */
export function adoptHeight(width: number, live: number, coarse: boolean, zoomed: boolean): number {
  if (live <= 0) return live;
  if (!coarse) {
    smallest = null;
    return live;
  }
  if (zoomed) return live;
  if (smallest === null || smallest.width !== width) {
    smallest = { width, height: live };
    return live;
  }
  if (live < smallest.height) smallest.height = live;
  return smallest.height;
}

/** 指で操作する端末か（C-214） */
function isCoarsePointer(win: Window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
}

let lastNote = '';

export function applyAppHeight(win: Window): number {
  const live = measureAppHeight(win);
  const zoomed = (win.visualViewport?.scale ?? 1) > 1.01;
  const height = adoptHeight(win.innerWidth, live, isCoarsePointer(win), zoomed);
  if (height <= 0) return 0;

  const root = win.document.documentElement;
  const before = root.style.getPropertyValue(APP_HEIGHT_VAR);
  root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);

  // **採った値だけでなく、内訳のどれかが動いたら控える**（C-213）。
  // ページが拡大されても採った値は動かないことがあり、**動いた値だけ見ていると
  // 拡大そのものが記録に残らない。** 拡大は「倍」と「ずれ」に出る
  const visual = win.visualViewport;
  const note =
    `窓 ${win.innerWidth}×${win.innerHeight} / 器 ${root.clientHeight}` +
    ` / 見え ${visual ? `${Math.round(visual.height)}(倍 ${visual.scale}・ずれ ${Math.round(visual.offsetTop)})` : '-'}` +
    ` / 狭 ${Math.round(smallViewportHeight(win)) || '-'}` +
    ` / 生 ${live} / 採用 ${height}`;

  if (note !== lastNote) {
    diagnostics.recordEvent('画面の高さ', `${note}（前 ${before || '-'}）`);
    lastNote = note;
  }
  return height;
}

/**
 * 測り続ける。後片付けの関数を返す。
 *
 * 窓の寸法変化・向きの変化に加えて、**見えている高さ自身の変化**も見る
 * （ブラウザの帯が出入りしても窓の `resize` は来ないことがある）。
 */
export function observeAppHeight(win: Window): () => void {
  const apply = (): void => {
    applyAppHeight(win);
  };
  apply();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const onOrientation = (): void => {
    apply();
    for (const delay of RECHECK_MS) timers.push(setTimeout(apply, delay));
  };

  win.addEventListener('resize', apply);
  win.addEventListener('orientationchange', onOrientation);
  const visual = win.visualViewport;
  visual?.addEventListener('resize', apply);
  visual?.addEventListener('scroll', apply);

  return () => {
    for (const timer of timers) clearTimeout(timer);
    win.removeEventListener('resize', apply);
    win.removeEventListener('orientationchange', onOrientation);
    visual?.removeEventListener('resize', apply);
    visual?.removeEventListener('scroll', apply);
  };
}

/** 土台が生きているあいだ、器の高さを測り続ける */
export function useAppHeight(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    return observeAppHeight(window);
  }, []);
}
