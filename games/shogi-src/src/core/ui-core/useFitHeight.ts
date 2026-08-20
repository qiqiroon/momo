import { useLayoutEffect, useRef, type RefObject } from 'react';

/** ★v1.62: 測った結果を外へ渡すための 1 件ぶん（デバッグ表示用）。 */
export interface FitMeasurement {
  /** そのときの窓の内側の幅・高さ。 */
  vw: number;
  vh: number;
  /** 正方形までを横長（付録D-8 §5.1.2）。 */
  landscape: boolean;
  /** 盤以外に置くものの高さ（横長のときだけ数が入る。縦長では使わないので null）。 */
  fixed: number | null;
  /** 実際に描かれた盤の一辺（px）。 */
  boardPx: number;
  /** 実際に描かれたマス 1 つの大きさ（px・小数第 1 位まで）。 */
  cellPx: number;
  /** 画面からはみ出している量（0 なら収まっている）。 */
  overflowX: number;
  overflowY: number;
}

/**
 * 盤以外に置くものの高さを、**そのつど実際に測る**（付録D-8 v1.12 §5.1）。
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
 * ## ★測るのは「盤が入っている列」だけ（v1.62 で修正・2026-08-20 実機のご報告）
 *
 * v1.61 まで、引く値を **「画面全体の高さ − 盤の高さ」** で出していた。**これが誤り。**
 *
 * 画面全体の高さは「**盤の列**」と「**右の列**（チャット・観戦者・デバッグ情報）」の
 * **高いほう**で決まる。盤が小さくなると高さを決めるのが右の列に入れ替わり、そこから先は
 *
 *   盤が縮む → 引く値が増える → もっと縮む
 *
 * という**逆向きの関係**になって**止まる場所が無くなる**。実測＝窓 900×430・デバッグ表示
 * ありで、引く値が **277px → 600px**（右の列 562px ＋ ヘッダ 52px）に化け、盤が
 * **488px → 38px**（マス 4px＝下限）まで潰れた。**右の列の高さは、盤の上下に置かれている
 * ものとは何の関係も無い。**
 *
 * そこで **「盤の列の外にあるもの」＋「盤の列の中で盤以外のもの」** を別々に測って足す。
 * こう出せば**右の列の高さは一切入らない**ので、引く値は盤の大きさに依存しなくなり、
 * 逆向きの関係そのものが消える。
 *
 * **止まる理由**＝引く値が盤の大きさで変わらないので、原則 1 回で落ち着く。折り返しが
 * 変わって値が動く場合に備え、**変わったときだけ次のコマでもう一度測る**。
 */
export function useFitHeight(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  onMeasured?: (m: FitMeasurement) => void,
) {
  // 受け取り手は描画のたびに別物になるので、**入れ物に持って見張りを作り直さない**。
  const cbRef = useRef(onMeasured);
  cbRef.current = onMeasured;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let reportTimer = 0;
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
        // **窓の大きさが変わったら、落ち着いたところで 1 件だけ記録する**（v1.62）。
        // 引きずっている途中の値を毎コマ残すと、あとで見るときに埋もれる。
        if (cbRef.current) {
          clearTimeout(reportTimer);
          reportTimer = window.setTimeout(report, 220);
        }
      }
      step();
    };

    /** いま実際に描かれている大きさを読み取って外へ渡す（測るだけ・何も書き換えない）。 */
    const report = () => {
      if (!cbRef.current) return;
      const board = el.querySelector('.board') as HTMLElement | null;
      const boardPx = board ? Math.round(board.getBoundingClientRect().width) : 0;
      const colsRaw = getComputedStyle(el).getPropertyValue('--board-cols').trim();
      const cols = Number(colsRaw) > 0 ? Number(colsRaw) : 9;
      const fixedRaw = el.style.getPropertyValue('--fit-v');
      const landscape = window.innerWidth >= window.innerHeight;
      const doc = document.documentElement;
      cbRef.current({
        vw: window.innerWidth,
        vh: window.innerHeight,
        landscape,
        fixed: landscape && fixedRaw ? parseInt(fixedRaw, 10) : null,
        boardPx,
        cellPx: boardPx ? Math.round((boardPx / cols) * 10) / 10 : 0,
        overflowX: Math.max(0, doc.scrollWidth - window.innerWidth),
        overflowY: Math.max(0, doc.scrollHeight - window.innerHeight),
      });
    };

    const step = () => {
      // **横長のときだけ測って返す**。理由は 2 つ。
      //  ① **使うのが横長のときだけ**＝縦長では盤を横幅いっぱいにするので高さを見ない
      //     （付録D-8 §5.1.2）。
      //  ② **古い値が別の形のまま残る事故を防ぐ**＝測り直しの知らせ（`resize` や
      //     `ResizeObserver`）は**届かない場面がある**（画面が裏にあるときは `resize` が
      //     1 件も来ないことを 2026-08-20 に実測）。縦長で測った値が横長に持ち越されると
      //     **盤が要らぬほど小さくなる**。**書くのは使う形のときだけ**にしておけば、
      //     知らせが届かなくても「前に横長で測った値」が残るだけで済む。
      if (window.innerWidth < window.innerHeight) return;

      // **盤そのものの高さ＝段数 × マス**は、盤の枡目を並べている入れ物の内側の高さ
      // （`.board` の内容の高さ）と同じ。**`--cell` の値を読みに行かない**＝
      // CSS の変数は `min()` などの式のまま返ることがあり、数として読めない。
      const grid = el.querySelector('.grid') as HTMLElement | null;
      const mainCol = el.querySelector('.main-col') as HTMLElement | null;
      const board = el.querySelector('.board') as HTMLElement | null;
      if (!grid || !mainCol || !board) return;
      const boardH = board.clientHeight;
      if (!boardH) return;

      // ★v1.62: **2 つに分けて測る**（この関数の説明を参照）。
      //  ① 盤の列の外にあるもの＝ヘッダ・列とのすき間・画面の上下の余白
      //  ② 盤の列の中で盤以外のもの＝ルール名の行・手番の帯・対局者の行・操作の行など
      // **右の列（チャット等）の高さはどちらにも入らない。**
      const outsideGrid = el.getBoundingClientRect().height - grid.getBoundingClientRect().height;
      const insideCol = mainCol.getBoundingClientRect().height - boardH;
      const fixed = Math.round(outsideGrid + insideCol);
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
      clearTimeout(reportTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
