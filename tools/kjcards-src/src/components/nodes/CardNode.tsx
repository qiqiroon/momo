import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store/board';
import { useT } from '../../i18n/store';

/** カード1枚（React Flow カスタムノード）。データの正本はストア側。
 *  ドラッグは上部のハンドル（.kj-card-head）から。本文の入力欄は編集専用（nodrag）。 */
export function CardNode({ id }: NodeProps) {
  const t = useT();
  const card = useBoard((s) => s.cards.find((c) => c.id === id));
  const updateCard = useBoard((s) => s.updateCard);
  const parkCard = useBoard((s) => s.parkCard);
  const deleteCard = useBoard((s) => s.deleteCard);

  if (!card) return null;

  return (
    <div className="kj-card">
      <Handle type="target" position={Position.Left} />
      <div className="kj-card-head" title="ドラッグで移動">
        <span className="kj-grip">⠿</span>
        <span className="kj-card-actions nodrag">
          <button className="kj-mini" title={t('card.park')} onClick={() => parkCard(card.id)}>
            ⇩
          </button>
          <button
            className="kj-mini kj-mini-danger"
            title={t('card.delete')}
            onClick={() => {
              if (window.confirm(t('confirm.deleteCard'))) deleteCard(card.id);
            }}
          >
            ✕
          </button>
        </span>
      </div>
      <input
        className="kj-card-title nodrag"
        value={card.title}
        placeholder={t('card.titlePh')}
        onChange={(e) => updateCard(card.id, { title: e.target.value })}
      />
      <textarea
        className="kj-card-note nodrag"
        value={card.note}
        placeholder={t('card.notePh')}
        rows={2}
        onChange={(e) => updateCard(card.id, { note: e.target.value })}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
