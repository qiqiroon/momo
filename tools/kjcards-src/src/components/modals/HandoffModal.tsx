import { useMemo } from 'react';
import { Modal } from '../Modal';
import { CopyButton } from '../CopyButton';
import { useBoard } from '../../store/board';
import { useT } from '../../i18n/store';
import { buildHandoffPrompt } from '../../lib/prompts';

export function HandoffModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const cards = useBoard((s) => s.cards);
  const groups = useBoard((s) => s.groups);
  const relations = useBoard((s) => s.relations);
  const purpose = useBoard((s) => s.purpose);

  // 退避を除外した素材＋指示文（§8）。開いている間は盤面に追従して再生成。
  const prompt = useMemo(
    () => buildHandoffPrompt(useBoard.getState().toBoard()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, groups, relations, purpose],
  );

  return (
    <Modal title={t('modal.handoffTitle')} onClose={onClose} wide>
      <p className="kj-lead">{t('modal.handoffLead')}</p>
      <textarea className="kj-output" readOnly rows={16} value={prompt} />
      <div className="kj-modal-foot">
        <CopyButton getText={() => prompt} />
      </div>
    </Modal>
  );
}
