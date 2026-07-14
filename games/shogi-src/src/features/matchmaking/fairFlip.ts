/**
 * 公平な振り駒 (乱数コミット & リビール方式) の補助関数群。
 * 段階 2-5.3 (v0.53 追加)。
 *
 * 目的: 現状 (v0.25〜) の「ホストが乱数計算 → 両者に配信」方式では、
 *   ホストが結果を歪める余地があった。両者がそれぞれ乱数を持ち寄って
 *   合成することで、どちらもコミット後は結果に介入できないようにする。
 *
 * フロー:
 *   1. 両者「おまかせ」検知 → 各自が 128bit の乱数 nonce を生成
 *   2. 各自が SHA-256(nonce) をコミットとして相手に送信 (nonce は隠す)
 *   3. 両者のコミットが揃ったら、各自が nonce を平文で相手に送信 (リビール)
 *   4. 受信した相手の nonce のハッシュが受け取っていたコミットと一致するか検証
 *   5. 一致すれば両 nonce を XOR で合成 → 5 コマの表裏 (faceUps) を決定
 *   6. hostIsSente は faceUps の過半 (3 個以上表) で判定 (従来ロジックと同じ)
 *
 * 乱数の合成に XOR を使うのは順序非依存 (どちらから送っても同じ結果) にするため。
 * ハッシュはブラウザ標準の Web Crypto SubtleCrypto を使う (async)。
 */

/** 16 バイト (128bit) のランダム 16 進数文字列を生成 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** 文字列を SHA-256 ハッシュし、16 進数文字列で返す */
export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(buf));
}

/**
 * 両者の nonce を合成して 5 コマの表裏 + hostIsSente を決定的に導出する。
 * nonce の XOR の先頭バイトの下位 5 bit を使う。
 * どちらの nonce を先に渡しても同じ結果になる (順序非依存)。
 */
export function deriveFurigoma(nonceA: string, nonceB: string): { faceUps: boolean[]; hostIsSente: boolean } {
  const a = hexToBytes(nonceA);
  const b = hexToBytes(nonceB);
  const len = Math.min(a.length, b.length);
  if (len === 0) throw new Error('nonce が短すぎます');
  const firstByte = a[0] ^ b[0];
  const faceUps: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    faceUps.push((firstByte & (1 << i)) !== 0);
  }
  const faceUpCount = faceUps.filter((x) => x).length;
  // 5 コマの過半 (3 以上) で hostIsSente を判定 (奇数個なので同数はあり得ない)
  const hostIsSente = faceUpCount >= 3;
  return { faceUps, hostIsSente };
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
