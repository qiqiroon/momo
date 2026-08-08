/**
 * トースト（第3分冊 11.5）
 *
 * 一時的な通知。既定 3秒で自動的に消え、手動でも閉じられる。
 */

import { useEffect } from 'react';
import { t } from '../../../i18n/locale';
import { TOAST_DEBUG_DURATION_MS, TOAST_DURATION_MS } from '../../config';

export type ToastKind = 'error' | 'warn' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  /** 文言はキーで持つ。表示中に言語を切り替えても追従させるため（14.4） */
  messageKey: string;
  /**
   * 失敗の中身（C-168）。`?debug=1` のときだけ入る。
   * **キーではなく生の文字列で持つ。**原因を突き止めるための控えであり、
   * 猫語や他言語に化けては用を成さないためである。
   */
  detail?: string;
}

export interface ToastProps {
  items: readonly ToastItem[];
  onDismiss(id: number): void;
}

export function Toast({ items, onDismiss }: ToastProps): React.ReactElement | null {
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((item) =>
      // 中身を添えたものは読み終える前に消えては困るので、長めに出す（C-168）
      setTimeout(() => onDismiss(item.id), item.detail ? TOAST_DEBUG_DURATION_MS : TOAST_DURATION_MS),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [items, onDismiss]);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`toast toast-${item.kind}`}
          onClick={() => onDismiss(item.id)}
        >
          {t(item.messageKey)}
          {item.detail !== undefined && <span className="toast-detail">{item.detail}</span>}
        </button>
      ))}
    </div>
  );
}
