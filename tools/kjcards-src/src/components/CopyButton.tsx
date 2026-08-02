import { useState } from 'react';
import { useT } from '../i18n/store';

export function CopyButton({ getText }: { getText: () => string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // フォールバック（clipboard API 不可の環境）
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1500);
  };
  return (
    <button className="kj-btn kj-btn-accent" onClick={copy}>
      {done ? `✓ ${t('modal.copied')}` : t('modal.copy')}
    </button>
  );
}
