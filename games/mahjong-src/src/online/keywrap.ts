// 鍵の包み（段階10 の 1・2026-10-15 利用者決定 Q8=A）：落ちた人の鍵をサーバーに預けるときの包み方。
// ホストにしか開けられない形に包んでから預ける＝預かるサーバーにも、ほかのプレイヤーにも中身は読めない。
//
// 仕組み：錠前と同じ安全素数の群で、ホストが「開ける鍵 x」と「包む鍵 y = 4^x」を作り、y だけを全員へ配る。
// 包む人は使い捨ての r を選び、R = 4^r と共通の秘密 s = y^r を作る（ホストは s = R^x で同じ値を得る）。
// s から AES-GCM の鍵を作って中身を包む（ブラウザの WebCrypto）。4 は平方数＝大きさ q の群を作る。
// ルール部分（engine）とは分けて置く。画面にも通信にも触らない。

import { modPow, type Group } from './lock';

/** ホストの持つ鍵の組（x はホストの端末から出さない） */
export interface WrapKeyPair {
  x: bigint;
  y: bigint;
}

const GEN = 4n;

function randomBelowQ(g: Group): bigint {
  const bytes = new Uint8Array(g.bits / 8 + 8);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (g.q - 2n)) + 2n;
}

export function newWrapKeyPair(g: Group): WrapKeyPair {
  const x = randomBelowQ(g);
  return { x, y: modPow(GEN, x, g.p) };
}

/** 送れる形の「包む鍵」として受け取った値が群の中にあるか（1 や p-1 などの弱い値を断る） */
export function validWrapKey(g: Group, y: bigint): boolean {
  if (y <= 1n || y >= g.p - 1n) return false;
  return modPow(y, g.q, g.p) === 1n;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(u: Uint8Array): string {
  let s = '';
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const u = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function aesKeyOf(s: bigint): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode('momo-mahjong-keywrap:' + s.toString(16)));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 中身（文字列）を包む鍵 y で包む。返すのは送れる文字列 */
export async function wrapFor(g: Group, y: bigint, plain: string): Promise<string> {
  if (!validWrapKey(g, y)) throw new Error('包む鍵が正しくない');
  const r = randomBelowQ(g);
  const R = modPow(GEN, r, g.p);
  const key = await aesKeyOf(modPow(y, r, g.p));
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return JSON.stringify({ R: R.toString(36), iv: b64(iv), ct: b64(ct) });
}

/** ホストが開ける。開けられない（別の鍵・書き換えられた）ときは null */
export async function unwrap(g: Group, x: bigint, blob: string): Promise<string | null> {
  try {
    const o = JSON.parse(blob) as { R: string; iv: string; ct: string };
    const R = [...o.R].reduce((v, c) => v * 36n + BigInt(parseInt(c, 36)), 0n);
    if (!validWrapKey(g, R)) return null;
    const key = await aesKeyOf(modPow(R, x, g.p));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct));
    return dec.decode(pt);
  } catch {
    return null;
  }
}
