import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  isShogiMessage,
  sendShogiMessage,
  unwrapShogiMessage,
  wrapShogiMessage,
  type ShogiMessage,
} from './protocol';

/**
 * v1.53 段1：**対局の伝言は包みに入れて運ぶ**（親 §6.2）。
 *
 * **これは実サーバーで実際に壊れた**（2026-08-20・第54セッション）。
 * サーバー中継では **`to` が「宛先」・`from` が「送り主」**として土台に使われ、
 * **送る瞬間と中継の瞬間に上書きされる**。将棋の「指した手」は
 * **`from`（どこから）／`to`（どこへ）** でマスを運んでいたため、
 * **行き先も出どころも消えて、受け取った側が手を黙って捨てていた**。
 *
 * ここでは**土台と同じ上書きを自分で起こして**、包みがそれを防ぐことを確かめる。
 */

/** 土台がやることをそのまま真似る＝送る側が宛先を付け、サーバーが送り主を付ける。 */
function throughTransport(sent: unknown, opts?: { to?: string; from?: string }): unknown {
  return Object.assign({}, sent as object, {
    to: opts?.to ?? 'all',
    from: opts?.from ?? 'p0',
  });
}

const move: ShogiMessage = {
  v: PROTOCOL_VERSION,
  type: 'move',
  kind: 'move',
  pieceId: 'P6',
  from: { row: 6, col: 2 },
  to: { row: 5, col: 2 },
  promote: false,
} as ShogiMessage;

describe('v1.53 段1: 対局の伝言の包み', () => {
  it('★土台が宛先と送り主を上書きしても、指した手のマスが生き残る', () => {
    const received = unwrapShogiMessage(throughTransport(wrapShogiMessage(move))) as {
      type: string;
      from: { row: number; col: number };
      to: { row: number; col: number };
    };
    expect(received.type).toBe('move');
    expect(received.from).toEqual({ row: 6, col: 2 });
    expect(received.to).toEqual({ row: 5, col: 2 });
  });

  it('★包みに入れずに同じ道を通すと、マスが失われる（これが実際に起きた壊れ方）', () => {
    const broken = throughTransport(move) as { from: unknown; to: unknown };
    // 行き先は「全員へ」に、出どころは送り主の番号に化ける
    expect(broken.to).toBe('all');
    expect(broken.from).toBe('p0');
  });

  it('包みの外に出ているのは土台が読む項目だけ', () => {
    const w = wrapShogiMessage(move) as unknown as Record<string, unknown>;
    expect(Object.keys(w).sort()).toEqual(['body', 'type', 'v']);
    // 中身の名前は外に漏れていない＝これ以上ぶつかりようがない
    expect(w.from).toBeUndefined();
    expect(w.to).toBeUndefined();
  });

  it('送る口は必ず包む（宛先を省くと自分以外の全員へ）', () => {
    let sent: unknown = null;
    let dest: string | undefined = 'まだ';
    sendShogiMessage(
      {
        send: (d, to) => {
          sent = d;
          dest = to;
        },
      },
      move,
    );
    const s = sent as { type: string; body: { type: string } };
    expect(s.type).toBe('shogi_msg');
    expect(s.body.type).toBe('move');
    expect(dest).toBeUndefined();
  });

  it('包みでないものはそのまま通す（包みを使わない相手とも話せる）', () => {
    expect(unwrapShogiMessage(move)).toBe(move);
    expect(unwrapShogiMessage(null)).toBeNull();
    expect(unwrapShogiMessage('文字列')).toBe('文字列');
  });

  it('取り出したものは今までどおり対局の伝言として通る', () => {
    const received = unwrapShogiMessage(throughTransport(wrapShogiMessage(move)));
    expect(isShogiMessage(received)).toBe(true);
  });

  it('チャットのように名前がぶつからない伝言も同じ道を通る', () => {
    const chat = { v: PROTOCOL_VERSION, type: 'chat', side: 'player1', text: 'こんにちは' } as ShogiMessage;
    const received = unwrapShogiMessage(throughTransport(wrapShogiMessage(chat))) as {
      type: string;
      text: string;
    };
    expect(received.type).toBe('chat');
    expect(received.text).toBe('こんにちは');
  });
});
