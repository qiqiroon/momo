// ── MOMO KJCards データモデル（概要設計書 v0.02 第4章）
//   アプリとAIが共有する "型式"。保存形式（10章）もこの構造に一致させる。

export type CardStatus = 'active' | 'parked';

/** 関係パレットのグループ（4.4） */
export type RelationFamily = 'つづく' | 'ぶつかる' | '支える' | 'その他';

export interface Pos {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** カード（4.2）: 1つの考え・断片を表す最小単位 */
export interface Card {
  id: string;
  /** 短い見出し（必須・原子的な1トピック） */
  title: string;
  /** 任意の補足メモ（無ければ空文字） */
  note: string;
  /** 所属グループ（未所属は null） */
  groupId: string | null;
  /** active=構造に参加 / parked=退避（AIに渡さない） */
  status: CardStatus;
  /** キャンバス座標（空間ヒント。順番の意味は持たない） */
  pos: Pos;
}

/** グループ（4.3）: 複数カードを囲む枠。表札を持つ */
export interface Group {
  id: string;
  /** 表札（グループの見出し） */
  name: string;
  pos: Pos;
  size: Size;
}

/** 関係線（4.4）: カード間／グループ間の関係。向きは from→to */
export interface Relation {
  id: string;
  /** カードID または グループID */
  from: string;
  /** カードID または グループID */
  to: string;
  /** 関係の意味（プリセット語 or 自由記述）。AIは文字列として解釈 */
  label: string;
  /** プリセット時の系統（任意） */
  family?: RelationFamily;
}

/** 目的欄（4.1 purpose） */
export interface Purpose {
  message: string;
  audience: string;
  tone: string;
}

/** 盤面（4.1 Board）＝保存形式 kjboard */
export interface Board {
  format: 'kjboard';
  /** 保存データ形式の版（アプリ画面表示バージョンとは別管理） */
  version: string;
  purpose: Purpose;
  cards: Card[];
  groups: Group[];
  relations: Relation[];
}

/** 保存データ形式の版（4.1）。アプリ画面バージョン(APP_VERSION)とは別管理 */
export const BOARD_FORMAT = 'kjboard' as const;
export const BOARD_VERSION = '0.01';

/** 画面表示バージョン（10章。デプロイ毎に 0.01 刻み） */
export const APP_VERSION = 'v0.01';
