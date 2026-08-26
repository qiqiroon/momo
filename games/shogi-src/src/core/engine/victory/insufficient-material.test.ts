/**
 * 駒不足（親 v1.65 §3.10・チェス §5.5.5・第 9 段 9-4d）。
 *
 * 押さえたいことは 4 つ。
 * 1. **ルール定義が名指しした顔ぶれ**のときだけ成立する（左右を入れ替えても成立する）
 * 2. **「勝ち切れない」ではなく「詰みが一度も現れない」**＝ナイト 2 枚は引き分けにならない
 * 3. **欄を持たないルールでは判定しない**＝本将棋・はさみ将棋は素通り
 * 4. **量子で正体が未確定な駒が残っていれば成立させない**（終わらせる側には確かさが要る）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { chess, hondou, hasami } from '../mgf/loader';
import type { Mgf } from '../mgf/types';
import type { PieceInstance, Position } from '../position/types';
import { isInsufficientMaterial } from './insufficient-material';
import { useGameStore, winnerOf } from '../../store/game-store';
import { endingLabel } from '../../../features/kifu-replay/ui/ending';

/** チェス盤の内部座標。row 7 = 段 1・col 0 = a 列。マスの色は (row + col) % 2。 */
const A1 = { row: 7, col: 0 };
const H8 = { row: 0, col: 7 };

function mk(kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return {
    pieceId: `${owner}-${kind}-${row}-${col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function posWith(
  pieces: PieceInstance[],
  sideToMove: 'player1' | 'player2' = 'player1',
  hands: { player1: PieceInstance[]; player2: PieceInstance[] } = { player1: [], player2: [] },
): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return {
    width: 8,
    height: 8,
    board,
    hands,
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

/** 双方の王だけを置いた盤に、指定した駒を足す。 */
function kingsPlus(...pieces: PieceInstance[]): Position {
  return posWith([
    mk('king', 'player1', A1.row, A1.col),
    mk('king', 'player2', H8.row, H8.col),
    ...pieces,
  ]);
}

describe('9-4d 駒不足（名指しした顔ぶれと突き合わせる）', () => {
  it('王 対 王 は引き分け（王は数えないので、一覧の「空 対 空」に当てはまる）', () => {
    expect(isInsufficientMaterial(chess, kingsPlus())).toBe(true);
  });

  it('王＋ビショップ 対 王 は引き分け（先手側でも後手側でも）', () => {
    expect(isInsufficientMaterial(chess, kingsPlus(mk('bishop', 'player1', 5, 2)))).toBe(true);
    expect(isInsufficientMaterial(chess, kingsPlus(mk('bishop', 'player2', 5, 2)))).toBe(true);
  });

  it('王＋ナイト 対 王 は引き分け', () => {
    expect(isInsufficientMaterial(chess, kingsPlus(mk('knight', 'player2', 4, 4)))).toBe(true);
  });

  it('ビショップ 1 枚ずつは、同じ色のマスに乗っているときだけ引き分け', () => {
    // (row+col) が偶数どうし = 同じ色
    const same = kingsPlus(mk('bishop', 'player1', 5, 1), mk('bishop', 'player2', 3, 3));
    expect(isInsufficientMaterial(chess, same)).toBe(true);
    // 片方だけ奇数 = 色違い。協力すれば詰みが作れるので本家でも引き分けにならない
    const diff = kingsPlus(mk('bishop', 'player1', 5, 1), mk('bishop', 'player2', 3, 4));
    expect(isInsufficientMaterial(chess, diff)).toBe(false);
  });

  it('王＋ナイト 2 枚 対 王 は引き分けにならない（詰ませ切れないだけで、詰みは現れうる）', () => {
    const pos = kingsPlus(mk('knight', 'player1', 4, 4), mk('knight', 'player1', 4, 6));
    expect(isInsufficientMaterial(chess, pos)).toBe(false);
  });

  it('ポーンが 1 枚でも残っていたら引き分けにならない（昇格できる）', () => {
    expect(isInsufficientMaterial(chess, kingsPlus(mk('pawn', 'player1', 6, 4)))).toBe(false);
  });

  it('ルークやクイーンが残っていたら引き分けにならない', () => {
    expect(isInsufficientMaterial(chess, kingsPlus(mk('rook', 'player2', 4, 4)))).toBe(false);
    expect(isInsufficientMaterial(chess, kingsPlus(mk('queen', 'player1', 4, 4)))).toBe(false);
  });

  it('持ち駒も盤の上と同じように数える（打てる駒は残っている駒）', () => {
    const inHand = posWith(
      [mk('king', 'player1', A1.row, A1.col), mk('king', 'player2', H8.row, H8.col)],
      'player1',
      { player1: [mk('bishop', 'player1', -1, -1)], player2: [] },
    );
    // 「王＋ビショップ 対 王」の行に当てはまる
    expect(isInsufficientMaterial(chess, inHand)).toBe(true);
  });

  it('持ち駒にルークが残っていれば引き分けにならない（数え落とさない）', () => {
    const inHand = posWith(
      [mk('king', 'player1', A1.row, A1.col), mk('king', 'player2', H8.row, H8.col)],
      'player1',
      { player1: [], player2: [mk('rook', 'player2', -1, -1)] },
    );
    expect(isInsufficientMaterial(chess, inHand)).toBe(false);
  });

  it('マスの色を要求する行には、持ち駒は当てはまらない（乗っているマスが無い）', () => {
    const oneOnBoard = posWith(
      [
        mk('king', 'player1', A1.row, A1.col),
        mk('king', 'player2', H8.row, H8.col),
        mk('bishop', 'player1', 5, 1),
      ],
      'player1',
      { player1: [], player2: [mk('bishop', 'player2', -1, -1)] },
    );
    expect(isInsufficientMaterial(chess, oneOnBoard)).toBe(false);
  });
});

describe('9-4d 駒不足（判定しない場合）', () => {
  it('本将棋・はさみ将棋は欄を持たない（従来どおり駒不足では終わらない）', () => {
    expect(hondou.victory?.insufficient_material).toBeUndefined();
    expect(hasami.victory?.insufficient_material).toBeUndefined();
    expect(isInsufficientMaterial(hondou, kingsPlus())).toBe(false);
    expect(isInsufficientMaterial(hasami, kingsPlus())).toBe(false);
  });

  it('欄に enabled:false と書いてあれば、顔ぶれが書いてあっても成立しない', () => {
    const off = JSON.parse(JSON.stringify(chess)) as Mgf;
    off.victory!.insufficient_material!.enabled = false;
    expect(off.victory!.insufficient_material!.combinations).toHaveLength(4);
    expect(isInsufficientMaterial(off, kingsPlus())).toBe(false);
  });

  it('欄はあっても顔ぶれを 1 つも書いていなければ成立しない', () => {
    const empty = JSON.parse(JSON.stringify(chess)) as Mgf;
    empty.victory!.insufficient_material = { enabled: true, trigger: 'auto', combinations: [] };
    expect(isInsufficientMaterial(empty, kingsPlus())).toBe(false);
  });

  it('起こし方が「主張」と書かれていたら成立しない（主張の道はまだ無い）', () => {
    const claim = JSON.parse(JSON.stringify(chess)) as Mgf;
    claim.victory!.insufficient_material!.trigger = 'claim';
    expect(isInsufficientMaterial(claim, kingsPlus())).toBe(false);
  });

  it('量子で正体が未確定な駒が残っていれば成立しない（名札で数えない）', () => {
    // 先手の 2 枚は「王かビショップのどちらか」で、どちらがどちらかは決まっていない。
    // **名札のとおりに数えると「王＋ビショップ 対 王」に見えて引き分けになってしまう**が、
    // ビショップの名札の駒が本当は王かもしれない以上、終わらせてよいとは言えない。
    const k = mk('king', 'player1', A1.row, A1.col);
    const b = mk('bishop', 'player1', 5, 2);
    const candidates = new Set([k.pieceId, b.pieceId]);
    const unsettled = posWith([
      { ...k, candidates },
      { ...b, candidates },
      mk('king', 'player2', H8.row, H8.col),
    ]);
    expect(isInsufficientMaterial(chess, unsettled)).toBe(false);

    // 候補が 1 つに絞れたら、いつもどおり「王＋ビショップ 対 王」として引き分けになる。
    const settled = posWith([
      { ...k, candidates: new Set([k.pieceId]) },
      { ...b, candidates: new Set([b.pieceId]) },
      mk('king', 'player2', H8.row, H8.col),
    ]);
    expect(isInsufficientMaterial(chess, settled)).toBe(true);
  });
});

describe('9-4d 駒不足（ストア経由で終局する）', () => {
  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess });
  });

  it('最後のナイトを取った瞬間に引き分けで終わる（勝った側は居ない）', () => {
    useGameStore.setState({
      position: posWith([
        mk('king', 'player1', A1.row, A1.col),
        mk('bishop', 'player1', 3, 5), // f5
        mk('king', 'player2', H8.row, H8.col),
        mk('knight', 'player2', 1, 3), // d7
      ]),
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
    });
    const st = useGameStore.getState();
    st.selectSquare({ row: 3, col: 5 });
    expect(st.tryMove({ row: 1, col: 3 })).toBe(true);

    const s = useGameStore.getState();
    expect(s.status).toBe('insufficient_material');
    expect(winnerOf(s.status, s.position.sideToMove)).toBeNull();
  });

  it('チェスの定義は 4 通りの顔ぶれを書いている', () => {
    expect(chess.victory?.insufficient_material?.combinations).toHaveLength(4);
    expect(chess.victory?.insufficient_material?.trigger).toBe('auto');
  });

  it('棋譜の終局表示が対局画面と同じ言葉で出る', () => {
    expect(endingLabel({ status: 'insufficient_material', winner: null }, 'ja')).toBe(
      '駒不足・引分',
    );
  });
});
