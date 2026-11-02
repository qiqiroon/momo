// 型付きの軽量イベントエミッタ（設計 08 §7.5）
type Listener<T> = (payload: T) => void;

export class Emitter<M extends { [K in keyof M]: unknown }> {
  private readonly listeners = new Map<keyof M, Set<Listener<never>>>();

  /** 戻り値を呼ぶと解除できる */
  on<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof M>(type: K, fn: Listener<M[K]>): void {
    this.listeners.get(type)?.delete(fn as Listener<never>);
  }

  protected emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.listeners.get(type)?.forEach((fn) => (fn as Listener<M[K]>)(payload));
  }
}
