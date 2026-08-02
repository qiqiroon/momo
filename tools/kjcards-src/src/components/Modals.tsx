import { useUI } from '../store/ui';
import { CardRequestModal } from './modals/CardRequestModal';
import { ImportModal } from './modals/ImportModal';
import { HandoffModal } from './modals/HandoffModal';

export function Modals() {
  const modal = useUI((s) => s.modal);
  const close = useUI((s) => s.closeModal);
  if (modal === 'cardRequest') return <CardRequestModal onClose={close} />;
  if (modal === 'import') return <ImportModal onClose={close} />;
  if (modal === 'handoff') return <HandoffModal onClose={close} />;
  return null;
}
