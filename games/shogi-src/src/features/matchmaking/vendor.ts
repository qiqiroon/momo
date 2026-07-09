/**
 * momo-matchmaking.js を副作用 import で読み込み、`window.MomoMatchmaking` を設定する。
 * B ビルドのみで実行される (main-b.tsx から import される・main-a.tsx からは import されない)。
 * A ビルドには tree-shake により含まれない。
 */

import '@momo-mm/momo-matchmaking.js';
