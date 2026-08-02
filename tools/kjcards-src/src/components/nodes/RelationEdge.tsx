import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useBoard } from '../../store/board';
import { useT } from '../../i18n/store';

/** 関係線（ラベル付き）。ラベルのピルをクリックで編集、✕で削除。 */
export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const t = useT();
  const label = useBoard((s) => s.relations.find((r) => r.id === id)?.label ?? '');
  const updateRelation = useBoard((s) => s.updateRelation);
  const deleteRelation = useBoard((s) => s.deleteRelation);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        <div
          className="kj-edge-label nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            className="kj-edge-pill"
            title={t('rel.editLabel')}
            onClick={() => {
              const next = window.prompt(t('rel.editLabel'), label);
              if (next !== null && next.trim() !== '') updateRelation(id, { label: next.trim() });
            }}
          >
            {label}
          </button>
          <button
            className="kj-edge-x"
            title={t('rel.delete')}
            onClick={() => deleteRelation(id)}
          >
            ✕
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
