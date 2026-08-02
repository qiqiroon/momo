import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store/board';
import { useT } from '../../i18n/store';

/** グループ枠（React Flow カスタムノード）。カードの背後に敷く大きな箱。 */
export function GroupNode({ id, selected }: NodeProps) {
  const t = useT();
  const group = useBoard((s) => s.groups.find((g) => g.id === id));
  const renameGroup = useBoard((s) => s.renameGroup);
  const resizeGroup = useBoard((s) => s.resizeGroup);
  const deleteGroup = useBoard((s) => s.deleteGroup);

  if (!group) return null;

  return (
    <div className="kj-group" style={{ width: '100%', height: '100%' }}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={140}
        onResize={(_, p) => resizeGroup(group.id, p.width, p.height)}
      />
      <Handle type="target" position={Position.Left} />
      <div className="kj-group-header">
        <input
          className="kj-group-name nodrag"
          value={group.name}
          placeholder={t('group.namePh')}
          onChange={(e) => renameGroup(group.id, e.target.value)}
        />
        <button
          className="kj-mini kj-mini-danger nodrag"
          title={t('group.delete')}
          onClick={() => {
            if (window.confirm(t('confirm.deleteGroup'))) deleteGroup(group.id);
          }}
        >
          ✕
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
