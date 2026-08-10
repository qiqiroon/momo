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
    // 指で広げている（ピンチ）あいだは、見えている高さが倍率のぶん縮んで見える。
    // **倍率を掛けて等倍へ戻してから比べる**——そうしないと、広げるたびに器まで縮む
    const scale = visual.scale > 0 ? visual.scale : 1;
    heights.push(visual.height * scale);
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
export function applyAppHeight(win: Window): number {
  const height = measureAppHeight(win);
  if (height <= 0) return 0;

  const root = win.document.documentElement;
  const before = root.style.getPropertyValue(APP_HEIGHT_VAR);
  root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);

  if (before !== `${height}px`) {
    const visual = win.visualViewport;
    diagnostics.recordEvent(
      '画面の高さ',
      `窓 ${win.innerWidth}×${win.innerHeight} / 器 ${root.clientHeight}` +
        ` / 見え ${visual ? `${Math.round(visual.height)}(倍 ${visual.scale})` : '-'}` +
        ` / 狭 ${Math.round(smallViewportHeight(win)) || '-'}` +
        ` / 採用 ${height}（前 ${before || '-'}）`,
    );
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
