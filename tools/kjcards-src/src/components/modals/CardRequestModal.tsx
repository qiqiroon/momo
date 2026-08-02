import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CopyButton } from '../CopyButton';
import { useT } from '../../i18n/store';
import { buildCardRequestPrompt } from '../../lib/prompts';

export function CardRequestModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [source, setSource] = useState('');
  const prompt = useMemo(() => buildCardRequestPrompt(source), [source]);

  return (
    <Modal title={t('modal.cardRequestTitle')} onClose={onClose} wide>
      <p className="kj-lead">{t('modal.cardRequestLead')}</p>
      <label className="kj-field">
        <span>{t('modal.sourceLabel')}</span>
        <textarea
          rows={4}
          value={source}
          placeholder={t('modal.sourcePh')}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>
      <textarea className="kj-output" readOnly rows={10} value={prompt} />
      <div className="kj-modal-foot">
        <CopyButton getText={() => prompt} />
      </div>
    </Modal>
  );
}
