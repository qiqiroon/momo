// エンジン層の唯一の公開面。待ち行列・アニメーション・履歴・タイマーを束ねる（設計 02 §3・§6）
// 論理状態はアニメーションの開始時に確定させる（決定 D1）
import {
  applyMove, assertInvariants, createSolved, isSolved, type CubeState,
} from '../core/cubeState';
import { generateScramble, scrambleLengthFor, type Rng } from '../core/scramble';
import type { Move, MoveOrigin } from '../core/types';
import { historySolution } from '../solver/historySolver';
import { Emitter } from '../util/emitter';
import {
  DEFAULT_ANIMATION, durationFor, phiAt, type ActiveAnimation, type AnimationSettings,
} from './animator';
import { MoveHistory } from './history';
import { MoveQueue, type MoveRequest } from './moveQueue';

export type GamePhase = 'solved' | 'scrambled' | 'playing';

export interface GameSessionEvents {
  'move:committed': { move: Move; origin: MoveOrigin; state: CubeState };
  'move:finished': { move: Move };
  /** timed＝シャッフルから計っていたゲームがそろった（記録に残すのはこれだけ） */
  'solved': {
    timeMs: number; moves: number; n: number; timed: boolean; scrambleLength: number;
    /** このゲームでヒント・自動の解答を使ったか（使った記録はベストに数えない） */
    usedHint: boolean; usedSolver: boolean;
  };
  'reset': { n: number };
  'scrambled': { length: number };
  'queue:full': Record<string, never>;
  'size:changed': { n: number };
}

export interface SessionOptions {
  animation?: AnimationSettings;
  /** 実時間の時計（ms）。テストで差し替える */
  clock?: () => number;
  rng?: Rng;
}

const MAX_FRAME_MS = 100;

interface Running {
  move: Move;
  elapsed: number;
  duration: number;
}

export class GameSession extends Emitter<GameSessionEvents> {
  private _state: CubeState;
  private readonly queue = new MoveQueue();
  private readonly history = new MoveHistory();
  private readonly animation: AnimationSettings;
  private readonly clock: () => number;
  private readonly rng: Rng;
  private running: Running | null = null;
  private _phase: GamePhase = 'solved';
  private startedAt = 0;
  private finishedMs = 0;
  private wasSolved = true;
  private scrambleLen = 0;
  private usedHint = false;
  private usedSolver = false;

  constructor(n: number, options: SessionOptions = {}) {
    super();
    this._state = createSolved(n);
    this.animation = options.animation ?? { ...DEFAULT_ANIMATION };
    this.clock = options.clock ?? (() => performance.now());
    this.rng = options.rng ?? Math.random;
  }

  /** 読み取り専用として扱うこと */
  get state(): CubeState {
    return this._state;
  }

  get phase(): GamePhase {
    return this._phase;
  }

  /** タブが隠れていても実時間で進む（時計の差分から求める） */
  get elapsedMs(): number {
    return this._phase === 'playing' ? this.clock() - this.startedAt : this.finishedMs;
  }

  get moveCount(): number {
    return this.history.moveCount;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** いまのゲームのシャッフルの手数（シャッフルしていなければ 0） */
  get scrambleLength(): number {
    return this.scrambleLen;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  guaranteedSolution(): Move[] {
    return this.history.guaranteedSolution();
  }

  /** 見せる・自動で回す解答（確実解の、打ち消し合う手をまとめたもの。06 §3） */
  solution(): Move[] {
    return historySolution(this.history.fullHistory);
  }

  /** ヒントを見た（このゲームの記録はベストに数えない） */
  noteHint(): void {
    this.usedHint = true;
  }

  setSize(n: number): void {
    this.restart(createSolved(n));
    this.emit('size:changed', { n });
  }

  reset(): void {
    this.restart(createSolved(this._state.n));
    this.emit('reset', { n: this._state.n });
  }

  /** 既定は論理に即時適用（決定 D9）。描画は 'scrambled' を受けて 1 回だけ作り直す */
  scramble(length?: number): void {
    const n = this._state.n;
    this.restart(createSolved(n));
    const moves = generateScramble(n, scrambleLengthFor(n, length), this.rng);
    moves.forEach((m) => applyMove(this._state, m));
    if (import.meta.env.DEV) assertInvariants(this._state);
    this.history.setScramble(moves);
    this.scrambleLen = moves.length;
    this.wasSolved = isSolved(this._state);
    this._phase = this.wasSolved ? 'solved' : 'scrambled';
    this.emit('scrambled', { length: moves.length });
  }

  /** いまのゲームのシャッフルの手 */
  get scrambleMoves(): readonly Move[] {
    return this.history.scramble;
  }

  /** 回している最中の手がある */
  get busy(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  /**
   * プレイ記録の再生（2026-11-04）：大きさ n の完成形にシャッフルの手を当てたところから始める。
   * 時間は計らない（再生は遊びではないので、そろっても記録に残さない）。
   * 大きさが変わるときは 'size:changed'、そのあと 'scrambled' を出す
   */
  loadScramble(n: number, moves: readonly Move[]): void {
    const sizeChanged = n !== this._state.n;
    this.restart(createSolved(n));
    if (sizeChanged) this.emit('size:changed', { n });
    moves.forEach((m) => applyMove(this._state, m));
    if (import.meta.env.DEV) assertInvariants(this._state);
    this.history.setScramble(moves);
    this.scrambleLen = moves.length;
    this.wasSolved = isSolved(this._state);
    this._phase = 'solved';
    this.emit('scrambled', { length: moves.length });
  }

  /** false＝待ち行列が満杯で捨てた */
  enqueue(req: MoveRequest): boolean {
    if (req.kind === 'move' && req.move.n !== this._state.n) return false;
    if (!this.queue.push(req)) {
      this.emit('queue:full', {});
      return false;
    }
    this.pump();
    return true;
  }

  /** 描画ループから毎フレーム */
  tick(deltaMs: number): void {
    const r = this.running;
    if (!r) return;
    r.elapsed += Math.min(Math.max(deltaMs, 0), MAX_FRAME_MS);
    if (r.elapsed >= r.duration) {
      this.running = null;
      this.emit('move:finished', { move: r.move });
      this.pump();
    }
  }

  getAnimation(): ActiveAnimation | null {
    const r = this.running;
    if (!r) return null;
    return {
      move: r.move,
      axis: r.move.axis,
      slices: r.move.slices,
      phi: phiAt(r.move, r.elapsed, r.duration),
      elapsedMs: r.elapsed,
      durationMs: r.duration,
    };
  }

  private restart(state: CubeState): void {
    this._state = state;
    this.queue.clear();
    this.history.clear();
    this.running = null;
    this._phase = 'solved';
    this.finishedMs = 0;
    this.wasSolved = true;
    this.scrambleLen = 0;
    this.usedHint = false;
    this.usedSolver = false;
  }

  /** 動いていなければ次の要求を取り出して確定させる */
  private pump(): void {
    while (!this.running) {
      const req = this.queue.shift();
      if (!req) return;
      let move: Move | null;
      let origin: MoveOrigin;
      if (req.kind === 'undo') {
        move = this.history.undo();
        origin = 'undo';
      } else if (req.kind === 'redo') {
        move = this.history.redo();
        origin = 'redo';
      } else {
        move = req.move;
        origin = req.origin;
        if (origin === 'user' || origin === 'solver') this.history.push(move);
      }
      if (move) this.commit(move, origin);
    }
  }

  private commit(move: Move, origin: MoveOrigin): void {
    applyMove(this._state, move);
    if (import.meta.env.DEV) assertInvariants(this._state);
    if (origin === 'solver') this.usedSolver = true;

    if (this._phase === 'scrambled' && origin === 'user') {
      this._phase = 'playing';
      this.startedAt = this.clock();
    }
    const solved = isSolved(this._state);
    const justSolved = solved && !this.wasSolved;
    this.wasSolved = solved;
    const timed = justSolved && this._phase === 'playing';
    if (timed) this.finishedMs = this.clock() - this.startedAt;
    // 計り始める前に（自動の解答などで）そろっても、ゲームは終わり
    if (justSolved) this._phase = 'solved';

    this.running = { move, elapsed: 0, duration: durationFor(move, origin, this.animation) };
    this.emit('move:committed', { move, origin, state: this._state });
    if (justSolved) {
      this.emit('solved', {
        timeMs: this.finishedMs, moves: this.history.moveCount, n: this._state.n, timed, scrambleLength: this.scrambleLen,
        usedHint: this.usedHint, usedSolver: this.usedSolver,
      });
    }
  }
}
