import type { Mgf } from '../mgf/types';
import { initPosition } from './init';

/**
 * Phase 5-12: 駒の身元 (PieceID) の並びのダイジェスト (親 §6.5.2)。
 *
 * 親 §3.12 の採番規則は決定的なので、両者が同じルール定義 (MGF) を独立に処理すれば
 * PieceID の並びは必ず一致する。ここで作るのは「本当に一致しているか」を 1 本の
 * 文字列で突き合わせるための値で、実装差異 (版ちがい・採番順の取り違え) を
 * 対局が始まる前に見つけるのが目的。
 *
 * 局面ではなくルール定義から作る点が要。初期配置と採番規則だけで決まる値なので、
 * 対局準備中 (盤がまだ無い時点) に計算できる。
 *
 * 正規化 (§6.5.2): PieceID を辞書順に並べ、`PID:所属:初期座標` の 3 つ組にしてから
 * つなぐ。ハッシュ関数を通さず読める形のまま送るのは、食い違ったときにどの駒が
 * 違うのかをそのまま見比べられるようにするため (局面ハッシュ positionHash と同じ方針)。
 *
 * 量子 OFF の対局では駒の外形的な区別が要らないので、呼び出し側が送信を省く
 * (§6.5.2 末尾)。
 */
export function pieceIdListDigest(mgf: Mgf): string {
  const pos = initPosition(mgf);
  const entries: string[] = [];
  for (let row = 0; row < pos.height; row++) {
    for (let col = 0; col < pos.width; col++) {
      const cell = pos.board[row][col];
      if (!cell) continue;
      entries.push(`${cell.pieceId}:${cell.owner}:${row},${col}`);
    }
  }
  entries.sort();
  return entries.join('|');
}
