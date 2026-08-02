import { useState } from 'react';
import { Modal } from '../Modal';
import { CopyButton } from '../CopyButton';
import { useBoard } from '../../store/board';
import { useT } from '../../i18n/store';
import { parseTolerantLines, localSplit, type LocalSplitMode } from '../../lib/importParse';
import { buildFixImportPrompt } from '../../lib/prompts';

export function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const addCardsBatch = useBoard((s) => s.addCardsBatch);
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<LocalSplitMode>('line');
  const [result, setResult] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);

  const run = (parse: (text: string) => ReturnType<typeof parseTolerantLines>) => {
    const r = parse(raw);
    if (r.imported === 0) {
      setWarn(true);
      setResult(null);
      return;
    }
    addCardsBatch(r.cards);
    setWarn(false);
    setResult(
      t('import.resultTpl')
        .replace('{total}', String(r.total))
        .replace('{imported}', String(r.imported))
        .replace('{skipped}', String(r.skipped)),
    );
  };

  return (
    <Modal title={t('import.title')} onClose={onClose} wide>
      <textarea
        className="kj-output"
        rows={9}
        value={raw}
        placeholder={t('import.pastePh')}
        onChange={(e) => {
          setRaw(e.target.value);
          setWarn(false);
        }}
      />
      <div className="kj-modal-foot">
        <button className="kj-btn kj-btn-accent" onClick={() => run(parseTolerantLines)}>
          {t('import.run')}
        </button>
        {result && <span className="kj-result-ok">{result}</span>}
      </div>

      {warn && (
        <div className="kj-warn">
          <span>{t('import.emptyWarn')}</span>
          <CopyButton getText={buildFixImportPrompt} />
        </div>
      )}

      <div className="kj-panel kj-subpanel">
        <h4 className="kj-panel-title">{t('import.localTitle')}</h4>
        <p className="kj-lead">{t('import.localLead')}</p>
        <div className="kj-radio-row">
          <label>
            <input
              type="radio"
              name="splitmode"
              checked={mode === 'line'}
              onChange={() => setMode('line')}
            />
            {t('import.localLine')}
          </label>
          <label>
            <input
              type="radio"
              name="splitmode"
              checked={mode === 'blank'}
              onChange={() => setMode('blank')}
            />
            {t('import.localBlank')}
          </label>
          <button className="kj-btn" onClick={() => run((text) => localSplit(text, mode))}>
            {t('import.run')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
