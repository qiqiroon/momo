import '@testing-library/jest-dom';

// jsdom は要素の scrollIntoView を持たない（画面が無いので巻き取る先も無い）。
// 検査で「現在の手が見える位置に入る」ことまでは確かめないので、空の口を足しておく。
const proto: { scrollIntoView?: () => void } = Element.prototype;
if (typeof proto.scrollIntoView !== 'function') {
  proto.scrollIntoView = () => {};
}
