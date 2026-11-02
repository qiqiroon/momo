// 「解答」：解答の手を 1 手ずつ待ち行列に入れて、目の前で回してそろえる（設計 06 §5 の autoplay）
// 待ち行列が空になるたびに次の 1 手を入れる。利用者がほかの手を指したら止める（手順が合わなくなるため）
import type { Move } from '../core/types';
import type { GameSession } from './gameSession';

export class AutoSolver {
  private readonly session: GameSession;
  private moves: Move[] = [];
  private _running = false;
  /** 自分が入れた手の確定を、利用者の手と見分ける */
  private pending = 0;
  onChange: () => void = () => {};

  constructor(session: GameSession) {
    this.session = session;
    session.on('move:committed', ({ origin }) => {
      if (origin === 'solver' && this.pending > 0) this.pending--;
      else this.stop();
    });
    for (const e of ['reset', 'scrambled', 'size:changed'] as const) session.on(e, () => this.stop());
  }

  get running(): boolean {
    return this._running;
  }

  start(): void {
    this.moves = this.session.solution();
    this.pending = 0;
    this._running = this.moves.length > 0;
    this.onChange();
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    this.moves = [];
    this.onChange();
  }

  /** 毎フレーム。待ち行列が空なら次の 1 手を入れる */
  update(): void {
    if (!this._running || this.session.queueLength > 0) return;
    const m = this.moves.shift();
    if (!m) {
      // 最後の手を入れ終えた
      this.stop();
      return;
    }
    this.pending++;
    if (!this.session.enqueue({ kind: 'move', move: m, origin: 'solver' })) this.stop();
  }
}
