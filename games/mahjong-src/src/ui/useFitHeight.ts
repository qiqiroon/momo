// 卓を画面の高さに必ず収める（2026-10-16 利用者指摘「何があっても画面がくずれないように」Q1=C）。
// 卓の上端から画面の下端までの残りの高さを測り、CSS の変数 --fit-h に入れる。
// 卓の上に行が増えても（観戦者の名前・一言・見出しの折り返しなど）、卓はその分だけ小さくなって収まる。
// 決め打ちの「画面の高さ − 100px」は、上に何があるかを見ていなかったため、1 行増えると下へはみ出た。

import { useLayoutEffect, type RefObject } from 'react';

/** which：測る要素が入れ替わる（正方形の卓⇔横4列）ときに測り直すための目印 */
export function useFitHeight(ref: RefObject<HTMLElement | null>, which: unknown) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = '';
    const update = () => {
      // ページの先頭から測った上端（ページが送られていても同じ値）
      const top = el.getBoundingClientRect().top + window.scrollY;
      const v = `${Math.max(0, Math.round(window.innerHeight - top))}px`;
      if (v !== last) {
        last = v;
        el.style.setProperty('--fit-h', v);
      }
    };
    update();
    // 上にあるものが変わったら測り直す。自分の祖先と、その途中で前に並ぶもの全部を見張る：
    // 大きさが変わった（ResizeObserver）／祖先の直下に差し込まれた・取り除かれた（MutationObserver）。
    // 取り除かれたものは大きさの見張りから外れ、祖先の高さも画面いっぱいのまま変わらないことがあるので、差し込み・取り除きも見る
    // （ブラウザで確かめた：差し込みだけ見ていたら、取り除いたあと卓が小さいまま戻らなかった）
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      watch();
      update();
    });
    const watch = () => {
      ro?.disconnect();
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
        if (n !== el) ro?.observe(n);
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) ro?.observe(s);
      }
    };
    watch();
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) mo?.observe(n, { childList: true });
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref, which]);
}
