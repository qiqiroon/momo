// 局を始める側（一人用ではその端末、オンラインでは段階5で決める配り役）が出す出来事を作る。
// ここは山の並びを知っている側だけが呼ぶ。作った出来事は列に積み、局面は state.ts の apply で作る。

import { HIDDEN, SEATS, type Envelope, type GameEvent, type Seat, type Visibility } from './events';
import { furitenOf } from './furiten';
import { callProblem, dealerByDice, kanProblem, kyushuOk, liveWallLeft, riichiAffordable, riichiMinWall, scoreRon, scoreTsumo, tenpaiForDeclare, type GameState } from './state';
import { doraIndicatorPos, uraIndicatorPos } from './dora';
import { waitKinds } from './agari';
import { nextStep } from './game';
import { createRng, shuffle } from './rng';
import { isRed, kindOf, tileSetFor, type TileId } from './tiles';

const HAND_SIZE = 13;

/**
 * 山の何番目の牌かを聞いて背番号を返すもの。一人用は山の並びを知っているので並びから引く（wallSource）。
 * オンラインは山の並びを誰も知らない＝先に位置だけを集めて（positionsNeeded）、鍵を集めて開けてから渡す（段階5の3）
 */
export type TileSource = (pos: number) => TileId;

export function wallSource(s: GameState): TileSource {
  if (!s.wall) throw new Error('山の並びを知らない端末は進行役になれない');
  const wall = s.wall;
  return (pos) => wall[pos];
}

/** 出来事を作るのに、山のどの位置の牌が要るか（作ってみて、聞かれた位置を集める。牌は仮に 0 を返す） */
export function positionsNeeded(make: (src: TileSource) => unknown): number[] {
  const asked: number[] = [];
  make((pos) => {
    asked.push(pos);
    return 0;
  });
  return asked;
}

/** 山の枚数（日本式は 136 枚） */
export const wallSizeOf = (s: GameState): number => {
  if (!s.rules) throw new Error('対局が始まっていない');
  return tileSetFor(s.rules).length;
};
/** 王牌の枚数（日本式）。嶺上牌は王牌の頭 4 枚（dora.ts の山 0・1） */
const DEAD_WALL = 14;

/** 対局の種から、その局の山の種を決める（「同じ山で勝負」では対局の種をリンクで配る）。hand＝この対局で何局目か（0 から。連荘でも別の山） */
export function roundSeed(gameSeed: string, hand: number): string {
  return `${gameSeed}#${hand}`;
}

/** 配る順に山から取る。親から 4 枚ずつ 3 周、そのあと 1 枚ずつ 1 周（親の 14 枚目は最初のツモ）。
 *  1 回ずつを出来事にする＝どの時点でも「配った牌は山の先頭から順」が成り立つ。返すのは山の位置 */
export function dealChunkPositions(dealer: Seat): { seat: Seat; positions: number[] }[] {
  const chunks: { seat: Seat; positions: number[] }[] = [];
  let p = 0;
  for (const size of [4, 4, 4, 1]) {
    for (let i = 0; i < 4; i++) {
      chunks.push({ seat: ((dealer + i) % 4) as Seat, positions: Array.from({ length: size }, (_, k) => p + k) });
      p += size;
    }
  }
  return chunks;
}

function dealChunks(wall: readonly TileId[], dealer: Seat): { seat: Seat; tiles: TileId[] }[] {
  return dealChunkPositions(dealer).map((c) => ({ seat: c.seat, tiles: c.positions.map((p) => wall[p]) }));
}

/** 局の始まりから配牌までの出来事。honba＝本場（2 局目からは局の進め方 nextStep が決めた値を渡す） */
/**
 * 親決め（訂正26100917・利用者 Q7=A サイコロ）。仮親 by がサイコロを 2 つ振る。目は対局の種から決まる＝牌譜で同じ親決めになる。
 * 一人用の仮親は席 0（自分）。
 */
export function rollForDealer(gameSeed: string, by: Seat = 0): GameEvent {
  const rng = createRng(`${gameSeed}:dealerDice`);
  const dice: [number, number] = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
  return { type: 'dealerDice', by, dice, dealer: dealerByDice(by, dice) };
}

export function startRound(state: GameState, gameSeed: string, roundIndex: number, dealer: Seat, honba = 0): Envelope[] {
  if (!state.rules) throw new Error('対局が始まっていない');
  const seed = roundSeed(gameSeed, state.handCount);
  const wall = shuffle(tileSetFor(state.rules), createRng(seed));
  const chunks = dealChunks(wall, dealer);
  for (const seat of SEATS) {
    const n = chunks.filter((c) => c.seat === seat).reduce((m, c) => m + c.tiles.length, 0);
    if (n !== HAND_SIZE) throw new Error('配牌の枚数が合わない');
  }

  const out: Envelope[] = [];
  const push = (to: Visibility, ev: GameEvent) => out.push({ seq: state.nextSeq + out.length, to, ev });
  push('all', { type: 'roundStart', roundIndex, dealer, honba });
  push([], { type: 'wallSeed', seed });
  for (const c of chunks) push([c.seat], { type: 'deal', seat: c.seat, tiles: c.tiles });
  // 配り終えたらドラ表示牌をめくる（日本式だけ）
  if (state.rules.family === 'jp') push('all', { type: 'doraReveal', tile: wall[doraIndicatorPos(wall.length, 0)] });
  return out;
}

// ---- 局の進行（段階1：ツモって切る） ----
// 進め方：番の人がツモる前（phase='draw'）なら advance、切る前（phase='discard'）ならその席の人（画面か CPU）が選んだ act を出す。
// どちらも「全部を知る局面」を受け取り、次の出来事を返すだけ。局面を変えるのは state.ts の apply だけ。

/** 番の人が選べること。打牌は背番号で指す（同じ種類でも赤5かどうかで別の牌） */
export type Action =
  | { type: 'discard'; tile: TileId }
  | { type: 'riichi'; tile: TileId }
  | { type: 'tsumo' }
  /** 九種九牌で流す（自分の最初のツモで、么九牌が 9 種類以上） */
  | { type: 'kyushu' }
  /** 流局したときの宣言 */
  | { type: 'tenpai' }
  | { type: 'noten' }
  /** 切られた牌への返事。chi・pon の tiles は手牌から出す 2 枚 */
  | { type: 'pass' }
  | { type: 'ron' }
  | { type: 'chi' | 'pon'; tiles: TileId[] }
  /** カン。minkan＝大明槓（切られた牌への返事・手牌から 3 枚）／ankan＝暗槓（自分の番・4 枚）／kakan＝加槓（自分の番・ポンに足す 1 枚） */
  | { type: 'kan'; kan: 'minkan' | 'ankan' | 'kakan'; tiles: TileId[] }
  /** オーラスでトップの親が、やめる（stop）か続けるか */
  | { type: 'yame'; stop: boolean };

/**
 * 局が終わった局面から、次の局（配牌まで）か対局の終わりの出来事を作る（進行役だけが呼ぶ）。
 * 親がやめるか続けるかを選ぶ番なら、何も作らない（親の act の yame を待つ）
 */
export function nextHand(full: GameState, gameSeed: string): Envelope[] {
  const n = nextStep(full);
  if (n.type === 'yame') return [];
  if (n.type === 'end') return [{ seq: full.nextSeq, to: 'all', ev: { type: 'gameEnd', reason: n.reason } }];
  return startRound(full, gameSeed, n.roundIndex, n.dealer, n.honba);
}

/** 牌の見分け（赤5かどうかまで）。同じ見分けの牌はどれを出しても同じ＝選ぶ候補を 1 つにまとめる */
const faceOf = (view: GameState, t: TileId) => `${kindOf(t)}${view.rules && isRed(t, view.rules) ? 'r' : ''}`;

/** その席が切られた牌でできるチー・ポン（手牌が見えている本人の局面で決まる）。赤5を出すかどうかは別の候補 */
export function callOptions(view: GameState, seat: Seat): Action[] {
  const c = view.claim;
  if (view.phase !== 'claim' || !c || c.replies[seat] !== null) return [];
  const hand = view.hands[seat];
  if (hand.includes(HIDDEN)) return [];
  const out: Action[] = [];
  const seen = new Set<string>();
  const offer = (meld: 'chi' | 'pon', tiles: TileId[]) => {
    const key = meld + tiles.map((t) => faceOf(view, t)).sort().join(',');
    if (seen.has(key) || callProblem(view, seat, meld, tiles)) return;
    seen.add(key);
    out.push({ type: meld, tiles });
  };
  const k = kindOf(c.tile);
  const ofKind = (kind: number) => hand.filter((t) => kindOf(t) === kind);
  const same = ofKind(k);
  for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length; j++) offer('pon', [same[i], same[j]]);
  // 大明槓：同じ牌を 3 枚持っている（出す牌は 3 枚とも決まっている）
  if (same.length === 3 && !callProblem(view, seat, 'kan', same)) out.push({ type: 'kan', kan: 'minkan', tiles: same.slice() });
  if (k < 27) {
    for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
      const ka = k + a;
      const kb = k + b;
      if (Math.floor(ka / 9) !== Math.floor(k / 9) || Math.floor(kb / 9) !== Math.floor(k / 9) || ka < 0 || kb < 0) continue;
      for (const ta of ofKind(ka)) for (const tb of ofKind(kb)) offer('chi', [ta, tb]);
    }
  }
  return out;
}

/** 切られた牌でロンできるか（手牌が見えている本人の局面で決まる）。フリテン・役なしはできない */
export function canRon(view: GameState, seat: Seat): boolean {
  const c = view.claim;
  if (view.phase !== 'claim' || !c || c.replies[seat] !== null) return false;
  const hand = view.hands[seat];
  if (hand.includes(HIDDEN)) return false;
  if (furitenOf(view, seat)?.reasons.length) return false;
  return scoreRon(view, seat, hand, c.tile) !== null;
}

/** 自分の番にできるカン（暗槓・加槓）。リーチのあとは、待ちが変わらない暗槓だけ（kanProblem が決める） */
export function kanOptions(view: GameState, seat: Seat): Action[] {
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  const hand = view.hands[seat];
  if (hand.includes(HIDDEN)) return [];
  const out: Action[] = [];
  const kinds = [...new Set(hand.map(kindOf))];
  for (const k of kinds) {
    const tiles = hand.filter((t) => kindOf(t) === k);
    if (tiles.length === 4 && !kanProblem(view, seat, 'ankan', tiles)) out.push({ type: 'kan', kan: 'ankan', tiles });
    if (tiles.length === 1 && !kanProblem(view, seat, 'kakan', tiles)) out.push({ type: 'kan', kan: 'kakan', tiles });
  }
  return out;
}

/** リーチを宣言して切れる牌（切ったあとテンパイになる牌）。リーチできないときは空 */
export function riichiTiles(view: GameState, seat: Seat): TileId[] {
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  if (view.rules?.family !== 'jp' || view.riichi[seat] !== 'none') return [];
  // 鳴いている手はリーチできない（暗槓は鳴きに数えない）。持ち点が 1000 点未満ならルールの riichiUnder
  if (view.melds[seat].some((m) => m.type !== 'ankan')) return [];
  if (liveWallLeft(view) < riichiMinWall(view.rules)) return [];
  if (!riichiAffordable(view, seat)) return [];
  const hand = view.hands[seat];
  const byKind = new Map<number, boolean>();
  return hand.filter((tile) => {
    const k = kindOf(tile);
    let ok = byKind.get(k);
    if (ok === undefined) {
      const rest = hand.slice();
      rest.splice(rest.indexOf(tile), 1);
      ok = waitKinds(rest).length > 0;
      byKind.set(k, ok);
    }
    return ok;
  });
}

/** その席がいま選べること（その席から見える局面だけで決まる＝画面と CPU が使う） */
export function legalActions(view: GameState, seat: Seat): Action[] {
  if (view.phase === 'ended') {
    const n = nextStep(view);
    return n.type === 'yame' && n.seat === seat ? [{ type: 'yame', stop: true }, { type: 'yame', stop: false }] : [];
  }
  if (view.phase === 'declare' && view.turn === seat) return declareOptions(view, seat);
  if (view.phase === 'claim') {
    if (view.claim?.replies[seat] !== null) return [];
    return [...(canRon(view, seat) ? [{ type: 'ron' } as Action] : []), ...callOptions(view, seat), { type: 'pass' }];
  }
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  const hand = view.hands[seat];
  const out: Action[] = [];
  // アガリの形で、役がある（縛りに届く）ときだけツモアガリできる
  const drawn = view.drawn[seat];
  if (drawn !== null && scoreTsumo(view, seat, hand, drawn)) out.push({ type: 'tsumo' });
  // 九種九牌：ルールが「必ず流す」なら、流すしかない（国士無双でツモアガリできるときだけアガりも選べる）
  if (kyushuOk(view, seat)) {
    out.push({ type: 'kyushu' });
    if (view.rules?.family === 'jp' && view.rules.values.kyushuHow === 'force') return out;
  }
  // リーチのあとはツモった牌を切るだけ（待ちが変わらない暗槓はできる）
  if (view.riichi[seat] !== 'none') {
    if (drawn !== null) out.push({ type: 'discard', tile: drawn });
    out.push(...kanOptions(view, seat));
    return out;
  }
  // 喰い替え禁止のときは、鳴いた直後に切れない牌を除く
  for (const tile of hand) if (!view.kuikaeBan.includes(kindOf(tile))) out.push({ type: 'discard', tile });
  for (const tile of riichiTiles(view, seat)) out.push({ type: 'riichi', tile });
  out.push(...kanOptions(view, seat));
  return out;
}

/** 流局したときに言えること。テンパイならテンパイと言える。ノーテンと言えるのはノーテンのとき、
 *  またはテンパイでもリーチしておらず、ルールが「テンパイでもノーテンと言える」のとき */
function declareOptions(view: GameState, seat: Seat): Action[] {
  const tenpai = tenpaiForDeclare(view, seat, view.hands[seat]);
  const out: Action[] = [];
  if (tenpai) out.push({ type: 'tenpai' });
  const mayHide = view.riichi[seat] === 'none' && view.rules?.family === 'jp' && view.rules.values.tenpaiHide === 'ok';
  if (!tenpai || mayHide) out.push({ type: 'noten' });
  return out;
}

/** 局面のあとに続けて出す出来事の封筒を作る（呼ぶたびに通し番号を 1 つ進める） */
const envelopesFrom = (state: GameState) => {
  let seq = state.nextSeq;
  return (to: Visibility, ev: GameEvent): Envelope => ({ seq: seq++, to, ev });
};

/** めくっていないカンドラを n 枚めくる出来事（王牌の決まった場所から順に） */
function revealDora(full: GameState, n: number, at: (to: Visibility, ev: GameEvent) => Envelope, src: TileSource): Envelope[] {
  if (n <= 0) return [];
  const size = wallSizeOf(full);
  return Array.from({ length: n }, (_, i) => at('all', { type: 'doraReveal', tile: src(doraIndicatorPos(size, full.doraIndicators.length + i)) }));
}

/** ツモる位置（山が尽きていれば null）。全員に見える数だけで決まる */
export function drawPosition(view: GameState): { pos: number; rinshan: boolean } | null {
  const size = wallSizeOf(view);
  if (view.rinshanDue) return { pos: size - DEAD_WALL + view.rinshanTaken, rinshan: true };
  if (liveWallLeft(view) <= 0) return null;
  // 山の頭から順に取る。引いた嶺上牌の数だけ、王牌が山の尻から補われている（その分は数えない）
  return { pos: size - view.wallLeft - view.rinshanTaken, rinshan: false };
}

/**
 * ツモる前の局面から、次の出来事（ツモ、または山が尽きての流局）を作る。
 * カンのあとは嶺上牌を引く。その前に、めくる時機の来たカンドラをめくる
 * （すぐめくるカンの分と、前の明槓の分。最後の明槓の分はルールが split なら打牌のとき）
 */
export function advance(full: GameState, src?: TileSource): Envelope[] {
  if (full.phase !== 'draw' && full.phase !== 'deal') throw new Error('ツモる時ではない');
  const tileAt: TileSource = src ?? wallSource(full);
  const at = envelopesFrom(full);
  const d = drawPosition(full);
  if (d === null) return [at('all', { type: 'exhaust' })];
  if (d.rinshan) {
    const reveals = revealDora(full, full.pendingDora - (full.deferDora ? 1 : 0), at, tileAt);
    return [...reveals, at([full.turn], { type: 'draw', seat: full.turn, tile: tileAt(d.pos), rinshan: true })];
  }
  return [at([full.turn], { type: 'draw', seat: full.turn, tile: tileAt(d.pos) })];
}

/** 番の人が選んだことを出来事にする。選べないことなら例外 */
export function act(full: GameState, seat: Seat, action: Action, src?: TileSource): Envelope[] {
  // 山の牌が要るのは、ドラ・裏ドラをめくるときだけ（一人用は山の並びから引く）
  const tileAt: TileSource = src ?? ((pos) => wallSource(full)(pos));
  if (full.phase === 'ended') {
    if (action.type !== 'yame' || !legalActions(full, seat).length) throw new Error('いまはできない');
    return [{ seq: full.nextSeq, to: 'all', ev: { type: 'yame', seat, stop: action.stop } }];
  }
  if (full.phase === 'declare' && full.turn === seat) {
    if (!declareOptions(full, seat).some((a) => a.type === action.type)) throw new Error(`その宣言はできない（${action.type}）`);
    const tenpai = action.type === 'tenpai';
    return [{ seq: full.nextSeq, to: 'all', ev: { type: 'declare', seat, tenpai, hand: tenpai ? full.hands[seat].slice() : null } }];
  }
  const at = envelopesFrom(full);
  if (full.phase === 'claim') {
    if (full.claim?.replies[seat] !== null) throw new Error(`席 ${seat} は返事をする人ではない（または返事をした）`);
    if (action.type === 'pass') return [at('all', { type: 'pass', seat })];
    if (action.type === 'chi' || action.type === 'pon' || (action.type === 'kan' && action.kan === 'minkan')) {
      const meld = action.type === 'kan' ? 'kan' : action.type;
      const problem = callProblem(full, seat, meld, action.tiles);
      if (problem) throw new Error(problem);
      return [at('all', { type: 'call', seat, meld, tiles: action.tiles.slice() })];
    }
    if (action.type !== 'ron') throw new Error(`いまは返事しかできない（${action.type}）`);
    if (!canRon(full, seat)) throw new Error('ロンできない（アガリの形でない・役が無い・フリテン）');
    const size = wallSizeOf(full);
    // 槍槓で崩れたカンのカンドラ：ルールが「めくる」なら、ロンの前にめくる
    const v = full.rules?.family === 'jp' ? full.rules.values : null;
    const reveals = full.claim.kind === 'kakan' && v?.chankanDora === 'yes' ? revealDora(full, full.pendingDora, at, tileAt) : [];
    const shown = full.doraIndicators.length + reveals.length;
    const ura = full.riichi[seat] === 'none' ? [] : Array.from({ length: shown }, (_, i) => tileAt(uraIndicatorPos(size, i)));
    return [...reveals, at('all', { type: 'ron', seat, hand: full.hands[seat].slice(), ura })];
  }
  if (full.phase !== 'discard' || full.turn !== seat) throw new Error(`席 ${seat} の番ではない`);
  const hand = full.hands[seat];
  switch (action.type) {
    case 'kyushu':
      if (!kyushuOk(full, seat)) throw new Error('九種九牌で流せない');
      return [at('all', { type: 'kyushu', seat, hand: hand.slice() })];
    case 'discard':
      if (!hand.includes(action.tile)) throw new Error(`持っていない牌は切れない（背番号 ${action.tile}）`);
      if (full.kuikaeBan.includes(kindOf(action.tile))) throw new Error('喰い替えになる牌は切れない');
      if (full.rules?.family === 'jp' && full.rules.values.kyushuHow === 'force' && kyushuOk(full, seat)) throw new Error('九種九牌は必ず流すルール');
      if (full.riichi[seat] !== 'none' && action.tile !== full.drawn[seat]) throw new Error('リーチのあとはツモった牌しか切れない');
      // 打牌のときに、まだめくっていない明槓のカンドラをめくる（この打牌へのロンにも乗る）
      return [at('all', { type: 'discard', seat, tile: action.tile, tsumogiri: action.tile === full.drawn[seat] }), ...revealDora(full, full.pendingDora, at, tileAt)];
    case 'riichi':
      if (!riichiTiles(full, seat).includes(action.tile)) throw new Error(`その牌ではリーチできない（背番号 ${action.tile}）`);
      return [
        at('all', { type: 'discard', seat, tile: action.tile, tsumogiri: action.tile === full.drawn[seat], riichi: true }),
        ...revealDora(full, full.pendingDora, at, tileAt),
      ];
    case 'kan': {
      if (action.kan === 'minkan') throw new Error('大明槓は切られた牌への返事');
      const problem = kanProblem(full, seat, action.kan, action.tiles);
      if (problem) throw new Error(problem);
      return [at('all', { type: 'kan', seat, kan: action.kan, tiles: action.tiles.slice() })];
    }
    case 'tsumo': {
      const winTile = full.drawn[seat];
      if (winTile === null || !scoreTsumo(full, seat, hand, winTile)) throw new Error('アガリの形になっていない（または役が無い）');
      // 裏ドラはリーチでアガったときだけ、ドラ表示牌の真下をめくる
      const size = wallSizeOf(full);
      const ura = full.riichi[seat] === 'none' ? [] : full.doraIndicators.map((_, i) => tileAt(uraIndicatorPos(size, i)));
      return [at('all', { type: 'tsumo', seat, hand: hand.slice(), winTile, ura })];
    }
    default:
      throw new Error(`いまはできない（${action.type}）`);
  }
}
