/**
 * 検査の下ごしらえ。
 *
 * ★**画面の無い検査でも読み込まれる**（2026-08-26）。盤の計算だけを見る検査は
 * 画面の土台を組み立てずに走らせるようにしたので、ここは**画面があるときだけ**
 * 画面向けの支度をする。**無条件に画面の部品へ触ると、画面の無い側が起動できずに
 * 「検査が全部落ちる」**（＝壊し確認が全部赤に見えて何も確かめられない）。
 */
import '@testing-library/jest-dom';

if (typeof Element !== 'undefined') {
  // jsdom は要素の scrollIntoView を持たない（画面が無いので巻き取る先も無い）。
  // 検査で「現在の手が見える位置に入る」ことまでは確かめないので、空の口を足しておく。
  const proto: { scrollIntoView?: () => void } = Element.prototype;
  if (typeof proto.scrollIntoView !== 'function') {
    proto.scrollIntoView = () => {};
  }
}
