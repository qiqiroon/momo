import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n/store';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="kj-modal-backdrop" onClick={onClose}>
      <div
        className={`kj-modal${wide ? ' kj-modal-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kj-modal-head">
          <h3>{title}</h3>
          <button className="kj-btn kj-btn-ghost" onClick={onClose}>
            {t('modal.close')}
          </button>
        </div>
        <div className="kj-modal-body">{children}</div>
      </div>
    </div>
  );
}
