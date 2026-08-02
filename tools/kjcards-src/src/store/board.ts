// ── 盤面ストア（zustand）
//   概要設計書 v0.02 第4章のデータモデルを保持し、§4.5 の不変条件を操作の中で守る。
//   保存/読込（10章）・受け渡し（8章）・入口取り込み（7章）は、このストアの board を素材にする。

import { create } from 'zustand';
import type { Board, Card, Group, Purpose, Relation, RelationFamily } from '../types';
import { BOARD_FORMAT, BOARD_VERSION } from '../types';

const GROUP_DEFAULT_W = 320;
const GROUP_DEFAULT_H = 240;

function emptyPurpose(): Purpose {
  return { message: '', audience: '', tone: '' };
}

/** 盤面内で一意なIDを作る（prefix + 連番。既存最大値を避ける） */
function makeId(prefix: string, existing: { id: string }[]): string {
  let max = 0;
  for (const e of existing) {
    const m = e.id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

export interface BoardState {
  purpose: Purpose;
  cards: Card[];
  groups: Group[];
  relations: Relation[];

  // 目的
  setPurpose: (patch: Partial<Purpose>) => void;

  // カード操作（第6章）
  addCard: (init?: Partial<Card>) => string;
  updateCard: (id: string, patch: Partial<Pick<Card, 'title' | 'note'>>) => void;
  moveCard: (id: string, x: number, y: number) => void;
  setCardGroup: (id: string, groupId: string | null) => void;
  parkCard: (id: string) => void; // 退避（既定の"外す"）
  restoreCard: (id: string) => void; // 復活
  deleteCard: (id: string) => void; // 完全削除（参照する関係線も削除）

  // グループ操作
  addGroup: (init?: Partial<Group>) => string;
  renameGroup: (id: string, name: string) => void;
  moveGroup: (id: string, x: number, y: number) => void;
  resizeGroup: (id: string, w: number, h: number) => void;
  deleteGroup: (id: string) => void; // 所属カードは未所属に戻す・カードは消さない

  // 関係線
  addRelation: (from: string, to: string, label: string, family?: RelationFamily) => string | null;
  updateRelation: (id: string, patch: Partial<Pick<Relation, 'label' | 'family'>>) => void;
  deleteRelation: (id: string) => void;

  // 盤面全体
  toBoard: () => Board;
  loadBoard: (board: Board) => void;
  addCardsBatch: (
    items: { title: string; note: string }[],
    origin?: { x: number; y: number },
  ) => number;
  resetBoard: () => void;
}

/** カード/グループを端点に持つ関係線か（退避・削除の巻き込み判定に使う） */
function relationTouches(r: Relation, id: string): boolean {
  return r.from === id || r.to === id;
}

export const useBoard = create<BoardState>((set, get) => ({
  purpose: emptyPurpose(),
  cards: [],
  groups: [],
  relations: [],

  setPurpose: (patch) => set((s) => ({ purpose: { ...s.purpose, ...patch } })),

  addCard: (init) => {
    const id = makeId('c', get().cards);
    const card: Card = {
      id,
      title: init?.title ?? '',
      note: init?.note ?? '',
      groupId: init?.groupId ?? null,
      status: init?.status ?? 'active',
      pos: init?.pos ?? { x: 0, y: 0 },
    };
    set((s) => ({ cards: [...s.cards, card] }));
    return id;
  },

  updateCard: (id, patch) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  moveCard: (id, x, y) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, pos: { x, y } } : c)),
    })),

  setCardGroup: (id, groupId) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, groupId } : c)),
    })),

  // 退避: status:parked にし、所属を解除（§6・§4.2）。関係線は保持（直列化で除外＝§8.1）。
  parkCard: (id) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === id ? { ...c, status: 'parked', groupId: null } : c,
      ),
    })),

  // 復活: status:active に戻す（トレイからキャンバスへ）。
  restoreCard: (id) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, status: 'active' } : c)),
    })),

  // 完全削除: カードを消し、参照する関係線も削除（§4.5）。
  deleteCard: (id) =>
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      relations: s.relations.filter((r) => !relationTouches(r, id)),
    })),

  addGroup: (init) => {
    const id = makeId('g', get().groups);
    const group: Group = {
      id,
      name: init?.name ?? '',
      pos: init?.pos ?? { x: 0, y: 0 },
      size: init?.size ?? { w: GROUP_DEFAULT_W, h: GROUP_DEFAULT_H },
    };
    set((s) => ({ groups: [...s.groups, group] }));
    return id;
  },

  renameGroup: (id, name) =>
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)) })),

  moveGroup: (id, x, y) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, pos: { x, y } } : g)),
    })),

  resizeGroup: (id, w, h) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, size: { w, h } } : g)),
    })),

  // グループ削除: 所属カードは未所属(null)に戻す（カード自体は消さない）。
  //   そのグループを端点に持つ関係線は参照切れになるため削除（§4.5）。
  deleteGroup: (id) =>
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      cards: s.cards.map((c) => (c.groupId === id ? { ...c, groupId: null } : c)),
      relations: s.relations.filter((r) => !relationTouches(r, id)),
    })),

  addRelation: (from, to, label, family) => {
    if (from === to) return null; // 自己ループは作らない
    // 実在チェック（§4.5）
    const s = get();
    const exists = (i: string) => s.cards.some((c) => c.id === i) || s.groups.some((g) => g.id === i);
    if (!exists(from) || !exists(to)) return null;
    // 同じ向きの重複は作らない
    if (s.relations.some((r) => r.from === from && r.to === to)) return null;
    const id = makeId('r', s.relations);
    const rel: Relation = { id, from, to, label, family };
    set((st) => ({ relations: [...st.relations, rel] }));
    return id;
  },

  updateRelation: (id, patch) =>
    set((s) => ({
      relations: s.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  deleteRelation: (id) =>
    set((s) => ({ relations: s.relations.filter((r) => r.id !== id) })),

  toBoard: () => {
    const s = get();
    return {
      format: BOARD_FORMAT,
      version: BOARD_VERSION,
      purpose: s.purpose,
      cards: s.cards,
      groups: s.groups,
      relations: s.relations,
    };
  },

  loadBoard: (board) =>
    set(() => ({
      purpose: { ...emptyPurpose(), ...board.purpose },
      cards: board.cards ?? [],
      groups: board.groups ?? [],
      relations: board.relations ?? [],
    })),

  // 入口取り込み（7章）: パース済みの {title, note}[] をカードとして配置。
  //   起点から少しずつずらして重ならないように並べ、status:active を付与。
  addCardsBatch: (items, origin) => {
    if (!items.length) return 0;
    const base = origin ?? { x: 80, y: 80 };
    set((s) => {
      const added: Card[] = [];
      items.forEach((it, i) => {
        const id = makeId('c', [...s.cards, ...added]);
        const col = i % 4;
        const row = Math.floor(i / 4);
        added.push({
          id,
          title: it.title,
          note: it.note,
          groupId: null,
          status: 'active',
          pos: { x: base.x + col * 210, y: base.y + row * 130 },
        });
      });
      return { cards: [...s.cards, ...added] };
    });
    return items.length;
  },

  resetBoard: () =>
    set(() => ({ purpose: emptyPurpose(), cards: [], groups: [], relations: [] })),
}));
