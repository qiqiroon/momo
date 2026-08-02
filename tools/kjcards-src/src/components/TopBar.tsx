import { useRef } from 'react';
import { useBoard } from '../store/board';
import { useT } from '../i18n/store';
import { APP_VERSION } from '../types';
import { downloadBoard, parseBoardJson } from '../lib/storage';
import { LangSwitcher } from './LangSwitcher';

export function TopBar() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const addCard = useBoard((s) => s.addCard);
  const addGroup = useBoard((s) => s.addGroup);
  const resetBoard = useBoard((s) => s.resetBoard);

  const onAddCard = () => {
    const jitter = () => 60 + Math.floor(Math.random() * 220);
    addCard({ pos: { x: jitter(), y: jitter() } });
  };
  const onAddGroup = () => {
    const jitter = () => 40 + Math.floor(Math.random() * 160);
    addGroup({ pos: { x: jitter(), y: jitter() } });
  };

  const onSave = () => downloadBoard(useBoard.getState().toBoard());

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const res = parseBoardJson(text);
    if (!res.ok || !res.board) {
      window.alert(res.error ?? 'Load failed.');
      return;
    }
    if (window.confirm(t('confirm.load'))) useBoard.getState().loadBoard(res.board);
  };

  return (
    <header className="kj-topbar">
      <div className="kj-brand">
        <span className="kj-logo">MOMO KJCards</span>
        <span className="kj-ver">{APP_VERSION}</span>
      </div>
      <div className="kj-topbar-actions">
        <button className="kj-btn" onClick={onAddCard}>
          ＋{t('topbar.newCard')}
        </button>
        <button className="kj-btn" onClick={onAddGroup}>
          ▢{t('topbar.newGroup')}
        </button>
        <span className="kj-sep" />
        <button className="kj-btn" onClick={onSave}>
          {t('topbar.save')}
        </button>
        <button className="kj-btn" onClick={() => fileRef.current?.click()}>
          {t('topbar.load')}
        </button>
        <button
          className="kj-btn kj-btn-ghost"
          onClick={() => {
            if (window.confirm(t('confirm.reset'))) resetBoard();
          }}
        >
          {t('topbar.reset')}
        </button>
        <span className="kj-sep" />
        <LangSwitcher />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={onLoadFile}
        />
      </div>
    </header>
  );
}
