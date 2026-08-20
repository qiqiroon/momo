import { useLayoutEffect, type RefObject } from 'react';

/**
 * 盤以外に置くものの高さを、**そのつど実際に測る**（付録D-8 v1.10 §5.1）。
 *
 * **なぜ測るのか**＝盤の大きさは「表示できる高さから、盤以外に置くものを引いた残り」で
 * 決まる。この「引く値」を**あらかじめ数えた固定値**で持つと、
 *
 *  - 言語（日本語・英語・中文・猫語）で帯の高さが変わる
 *  - 窓の幅しだいでヘッダやボタンの折り返し方が変わる
 *  - 詰め方（すき間・余白）を直すたびに値が古くなる
 *
 * のいずれでもズレる。**実際 2026-08-20 の 1 回の作業で 3 つの固定値が古くなった。**
 * 窓は縦にも横にも自由に変えられる連続したものなので、**区切りごとに数えた値では
 * 追いつかない**（2026-08-20 ユーザー指示「毎回測定しなおして合わせこんでほしい」）。
 *
 * **測り方**＝画面全体の高さから**盤そのものの高さ（段数 × マス）を引く**。残りが
 * 「盤以外に置くもの」の高さで、これを CSS 変数として画面のいちばん外側へ返す。
 * CSS 側はその値を使ってマスの大きさを決める。
 *
 * **止まる理由**＝引く値が変わるとマスが変わり、画面の高さも変わるが、**盤のぶんは
 * 同じだけ増減する**ので引く値は同じ値に落ち着く。落ち着いたら測り直さない。
 * 折り返しが変わって値が動く場合に備え、**変わったときだけ次のコマでもう一度測る**。
 */
export function useFitHeight(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    // **書き換えた回数を数える**＝折り返しが 2 つの形を行き来する窓では、測る → 直す →
    // また変わる、が終わらなくなりうる。**窓が変わるまでの回数に上限を置いて必ず止める**
    // （止まった時点の値でも 1px 単位の誤差にしかならない）。
    let applied = 0;
    // **数え直す合図は「窓の大きさが変わったこと」そのものにする**（`resize` の知らせでは
    // ない）＝**知らせが来ない場面がある**（画面が裏にあるときなど）ので、知らせを当てに
    // すると**上限に達したまま二度と測り直さなくなる**。事実のほうを見る。
    let seenW = -1;
    let seenH = -1;

    const measure = () => {
      if (window.innerWidth !== seenW || window.innerHeight !== seenH) {
        seenW = window.innerWidth;
        seenH = window.innerHeight;
        applied = 0;
      }
      step();
    };

    const step = () => {
      // **横長のときだけ測って返す**。理由は 2 つ。
      //  ① **使うのが横長のときだけ**＝縦長では盤を横幅いっぱいにするので高さを見ない
      //     （付録D-8 v1.10 §5.1.2）。
      //  ② **古い値が別の形のまま残る事故を防ぐ**＝測り直しの知らせ（`resize` や
      //     `ResizeObserver`）は**届かない場面がある**（画面が裏にあるときは 1 件も
      //     来ないことを 2026-08-20 に実測）。縦長で測った値が横長に持ち越されると
      //     **盤が要らぬほど小さくなる**。**書くのは使う形のときだけ**にしておけば、
      //     知らせが届かなくても「前に横長で測った値」が残るだけで済む。
      if (window.innerWidth < window.innerHeight) return;

      // **盤そのものの高さ＝段数 × マス**は、盤の枡目を並べている入れ物の内側の高さ
      // （`.board` の内容の高さ）と同じ。**`--cell` の値を読みに行かない**＝
      // CSS の変数は `min()` などの式のまま返ることがあり、数として読めない。
      const grid = el.querySelector('.board');
      if (!grid) return;
      const boardH = (grid as HTMLElement).clientHeight;
      if (!boardH) return;

      const fixed = Math.round(el.getBoundingClientRect().height - boardH);
      if (!Number.isFinite(fixed) || fixed <= 0) return;

      const next = `${fixed}px`;
      if (el.style.getPropertyValue('--fit-v') === next) return;
      if (applied >= 8) return;
      applied++;
      el.style.setProperty('--fit-v', next);
      // 直した結果また変わることがあるので、変わったときだけ次のコマでもう一度測る。
      raf = requestAnimationFrame(step);
    };

    measure();

    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    // 窓の大きさだけでなく、中身の入れ替わり（相手の入室・チャットの伸縮など）でも
    // 引く値は変わる。ResizeObserver が無い環境（検査用の仮想 DOM）では窓の変化だけを見る。
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
