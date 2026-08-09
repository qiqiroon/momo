/**
 * 共通ダイアログ（第3分冊 12.1）
 *
 * モーダルとし、背後のビューへの操作を遮断する。フォーカスを内側へ閉じ込め、
 * 開いた時点で既定ボタンへフォーカスを与える。`Esc` は破壊的操作では取り消しとして働く。
 */

import { useCallback, useEffect, useRef } from 'react';

export interface DialogAction {
  label: string;
  onSelect(): void;
  /** 破壊的操作である（既定ボタンにしない・Esc で選ばれない） */
  destructive?: boolean;
}

export interface DialogProps {
  title: string;
  body?: string;
  children?: React.ReactNode;
  /** 表示順に並べる。既定ボタンは `defaultIndex` で指す */
  actions: readonly DialogAction[];
  /** 開いた時点でフォーカスするボタン。`Esc` でもこれが選ばれる（12.1） */
  defaultIndex: number;
}

const FOCUSABLE = 'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, body, children, actions, defaultIndex }: DialogProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const defaultRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    defaultRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        actions[defaultIndex]?.onSelect();
        return;
      }
      if (event.key !== 'Tab') return;

      // フォーカスをダイアログ内に閉じ込める（12.1）
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    },
    [actions, defaultIndex],
  );

  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <h2 className="dialog-title">{title}</h2>
        {/* **中身だけを送れる箱に入れる**（C-208）。携帯の横画面は高さが狭く、
            素直に積むと下のボタンが画面の外へ落ちて、見えも押せもしなくなる。
            送るのを中身に限れば、ボタンは常に見える位置に残る */}
        {(body !== undefined || children !== undefined) && (
          <div className="dialog-content">
            {body !== undefined && <p className="dialog-body">{body}</p>}
            {children}
          </div>
        )}
        <div className="dialog-actions">
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              ref={index === defaultIndex ? defaultRef : undefined}
              className={action.destructive ? 'btn btn-danger' : 'btn'}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
