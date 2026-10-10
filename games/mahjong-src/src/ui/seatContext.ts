// 卓の画面の「自分の席」と「席の名前」。一人用は自分が席 0・ほかは CPU。
// オンライン（段階5の3c）は自分の席が 0 とは限らないので、卓の画面はここから自分の席を読む。

import { createContext, useContext } from 'react';
import type { Seat } from '../engine/events';

export interface SeatInfo {
  me: Seat;
  /** 席ごとの名前（null の席は「CPU n」と出す）。null＝一人用 */
  names: readonly (string | null)[] | null;
}

export const SeatContext = createContext<SeatInfo>({ me: 0, names: null });

export const useSeat = (): SeatInfo => useContext(SeatContext);

/** 自分から見た位置（0＝自分・1＝下家・2＝対面・3＝上家） */
export const relFrom = (me: Seat, seat: number): number => (seat - me + 4) % 4;
