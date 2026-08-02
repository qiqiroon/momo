import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import { useBoard } from '../store/board';
import { useUI } from '../store/ui';
import { CardNode } from './nodes/CardNode';
import { GroupNode } from './nodes/GroupNode';
import { RelationEdge } from './nodes/RelationEdge';

const CARD_HALF_W = 95;
const CARD_HALF_H = 45;

const nodeTypes = { card: CardNode, group: GroupNode };
const edgeTypes = { relation: RelationEdge };

function deriveNodes(
  cards: ReturnType<typeof useBoard.getState>['cards'],
  groups: ReturnType<typeof useBoard.getState>['groups'],
): Node[] {
  const gNodes: Node[] = groups.map((g) => ({
    id: g.id,
    type: 'group',
    position: { ...g.pos },
    data: {},
    deletable: false,
    zIndex: 0,
    style: { width: g.size.w, height: g.size.h },
  }));
  const cNodes: Node[] = cards
    .filter((c) => c.status === 'active')
    .map((c) => ({
      id: c.id,
      type: 'card',
      position: { ...c.pos },
      data: {},
      deletable: false,
      zIndex: 1,
      dragHandle: '.kj-card-head',
    }));
  return [...gNodes, ...cNodes];
}

function deriveEdges(
  relations: ReturnType<typeof useBoard.getState>['relations'],
  visibleIds: Set<string>,
): Edge[] {
  return relations
    .filter((r) => visibleIds.has(r.from) && visibleIds.has(r.to))
    .map((r) => ({
      id: r.id,
      source: r.from,
      target: r.to,
      type: 'relation',
      label: r.label,
    }));
}

export function BoardCanvas() {
  const cards = useBoard((s) => s.cards);
  const groups = useBoard((s) => s.groups);
  const relations = useBoard((s) => s.relations);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // 構造的変化（追加/削除/退避/復活）のときだけノードを作り直す。
  // テキスト編集や移動では作り直さない（フォーカスや位置を保つ）。
  const nodeSig = useMemo(
    () =>
      cards
        .filter((c) => c.status === 'active')
        .map((c) => c.id)
        .join(',') +
      '|' +
      groups.map((g) => g.id).join(','),
    [cards, groups],
  );
  useEffect(() => {
    setNodes(deriveNodes(useBoard.getState().cards, useBoard.getState().groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSig, setNodes]);

  // エッジは関係線と可視ノードから毎回導出。
  useEffect(() => {
    const visible = new Set<string>([
      ...groups.map((g) => g.id),
      ...cards.filter((c) => c.status === 'active').map((c) => c.id),
    ]);
    setEdges(deriveEdges(relations, visible));
  }, [relations, cards, groups, setEdges]);

  const memberIdsOf = useCallback((groupId: string): string[] => {
    return useBoard
      .getState()
      .cards.filter((c) => c.groupId === groupId && c.status === 'active')
      .map((c) => c.id);
  }, []);

  // グループをドラッグしたら、中のカードも同じ差分だけ動かす（見た目のみ・確定は drag stop）。
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const groupIds = new Set(useBoard.getState().groups.map((g) => g.id));
      const extra: NodeChange<Node>[] = [];
      for (const ch of changes) {
        if (ch.type === 'position' && ch.dragging && ch.position && groupIds.has(ch.id)) {
          const cur = nodesRef.current.find((n) => n.id === ch.id);
          if (!cur) continue;
          const dx = ch.position.x - cur.position.x;
          const dy = ch.position.y - cur.position.y;
          if (dx === 0 && dy === 0) continue;
          for (const mid of memberIdsOf(ch.id)) {
            const mn = nodesRef.current.find((n) => n.id === mid);
            if (mn) {
              extra.push({
                id: mid,
                type: 'position',
                dragging: true,
                position: { x: mn.position.x + dx, y: mn.position.y + dy },
              });
            }
          }
        }
      }
      onNodesChangeBase(extra.length ? [...changes, ...extra] : changes);
    },
    [memberIdsOf, onNodesChangeBase],
  );

  const groupContaining = useCallback((x: number, y: number): string | null => {
    const cx = x + CARD_HALF_W;
    const cy = y + CARD_HALF_H;
    const gs = useBoard.getState().groups;
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i];
      if (cx >= g.pos.x && cx <= g.pos.x + g.size.w && cy >= g.pos.y && cy <= g.pos.y + g.size.h) {
        return g.id;
      }
    }
    return null;
  }, []);

  const isOverPark = useCallback((event: MouseEvent | TouchEvent): boolean => {
    const el = document.getElementById('kj-park');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const p = 'clientX' in event ? event : event.changedTouches[0];
    if (!p) return false;
    return p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom;
  }, []);

  const onNodeDragStop: OnNodeDrag<Node> = useCallback(
    (event, node) => {
      const b = useBoard.getState();
      if (node.type === 'card') {
        if (isOverPark(event as unknown as MouseEvent)) {
          b.parkCard(node.id);
          return;
        }
        b.moveCard(node.id, node.position.x, node.position.y);
        b.setCardGroup(node.id, groupContaining(node.position.x, node.position.y));
      } else if (node.type === 'group') {
        b.moveGroup(node.id, node.position.x, node.position.y);
        for (const mid of memberIdsOf(node.id)) {
          const mn = nodesRef.current.find((n) => n.id === mid);
          if (mn) b.moveCard(mid, mn.position.x, mn.position.y);
        }
      }
    },
    [groupContaining, isOverPark, memberIdsOf],
  );

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    const { pendingRelLabel, pendingRelFamily } = useUI.getState();
    useBoard.getState().addRelation(conn.source, conn.target, pendingRelLabel, pendingRelFamily);
  }, []);

  return (
    <div className="kj-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        minZoom={0.2}
        maxZoom={2}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="#2a2a2a" />
        <Controls />
        <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.6)" nodeColor="#c2410c" />
      </ReactFlow>
    </div>
  );
}
