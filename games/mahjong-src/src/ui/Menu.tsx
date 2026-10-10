// トップ画面（モード選択）と、そこから入る画面（CPU と対局・対局の再生）。
// 見た目は MOMO Shogi のモード選択（features/matchmaking/ui/MenuScreen.tsx の ModeRow）にならう。
// 将棋の駒の形の絵の代わりに、牌（ピンズ）の絵を使う（2026-10-09 利用者指示）。

import { useState, type ReactNode } from 'react';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { RuleSettings, loadRuleChoice, saveRuleChoice, type RuleChoice } from './RuleSettings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** 牌の絵（ピンズなど）。対局で使う牌と同じ絵・同じ厚み */
export function TileIcon({ code }: { code: string }) {
  return (
    <span className="tile mode-tile" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}tiles/${code}.svg`} alt="" draggable={false} />
    </span>
  );
}

interface RowProps {
  tile: string;
  name: string;
  desc: string;
  disabled?: boolean;
  open?: boolean;
  onClick: () => void;
}

/** メニューの1行：左に牌・真ん中に名前と説明・右に矢印 */
export function ModeRow({ tile, name, desc, disabled, open, onClick }: RowProps) {
  return (
    <button type="button" className={`mode-row${disabled ? ' disabled' : ''}${open ? ' open' : ''}`} disabled={disabled} onClick={onClick}>
      <TileIcon code={tile} />
      <span className="mode-body">
        <span className="mode-name">{name}</span>
        <span className="mode-desc">{desc}</span>
      </span>
      <span className="mode-arrow" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

/** モード選択へ戻るボタン（「← 戻る」。見出しと見分けがつくよう、ボタンの形で操作の行に置く＝利用者指示 10-09） */
export function BackButton({ t, onClick }: { t: T; onClick: () => void }) {
  return (
    <button type="button" className="btn-secondary back-btn" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t('backBtn')}
    </button>
  );
}

/** 画面の見出し */
export function ScreenHead({ title }: { title: string }) {
  return (
    <div className="screen-head">
      <h2>{title}</h2>
    </div>
  );
}

/** ほかの MOMO のゲームと同じフッター（このアプリについて・MOMO Works へのリンク） */
export function SiteFooter({ t, children }: { t: T; children?: ReactNode }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        {children}
        <h2>{t('footerAbout')}</h2>
        <p>{t('footerDesc')}</p>
        {/* MOMO Works へのリンクは一番下（利用者指示 10-09） */}
        <div className="foot-links">
          <a href="../../">{t('footerTop')}</a>
          <a href="../../games/">{t('footerGames')}</a>
          <a href="../../tools/">{t('footerTools')}</a>
        </div>
      </div>
    </footer>
  );
}

// ---- CPU と対局：ルールを選んで始める（段階6の6a-2・選び方は RuleSettings） ----

/** CPU と対局：ルールセットと個別設定を選んでから始める。選んだルールは端末に覚える */
export function CpuSetup({ t, lang, onBack, onStart }: { t: T; lang: BaseLang; onBack: () => void; onStart: (c: RuleChoice) => void }) {
  const [choice, setChoice] = useState<RuleChoice>(loadRuleChoice);
  const change = (c: RuleChoice) => {
    setChoice(c);
    saveRuleChoice(c);
  };
  return (
    <>
      <ScreenHead title={t('menuCpu')} />
      {/* 対局を始めるは見出しのすぐ下（ルールの設定を開いても隠れない）。戻るはその右 */}
      <div className="screen-actions">
        <button type="button" className="btn-primary btn-start" onClick={() => onStart(choice)}>
          {t('start')}
        </button>
        <BackButton t={t} onClick={onBack} />
      </div>
      <RuleSettings t={t} lang={lang} choice={choice} onChange={change} />
    </>
  );
}

// ---- 対局の再生（再生する・前回の対局を保存する） ----

export interface DriveEntry {
  id: string;
  name: string;
}

interface ReplayHubProps {
  t: T;
  hasLast: boolean;
  note: string;
  onBack: () => void;
  onPlayLast: () => void;
  onPlayFile: () => void;
  /** Google ドライブの一覧を読む（失敗したら投げる） */
  listDrive: () => Promise<DriveEntry[]>;
  onPlayDrive: (id: string) => void;
  onSaveFile: () => void;
  onSaveDrive: () => void;
}

/** 再生・保存の行を押すと、その下に「どこから／どこへ」を出す */
export function ReplayHub({ t, hasLast, note, onBack, onPlayLast, onPlayFile, listDrive, onPlayDrive, onSaveFile, onSaveDrive }: ReplayHubProps) {
  const [open, setOpen] = useState<'play' | 'save' | null>(null);
  const [drive, setDrive] = useState<{ state: 'idle' | 'loading' | 'done' | 'error'; files: DriveEntry[]; why: string }>({ state: 'idle', files: [], why: '' });
  const toggle = (k: 'play' | 'save') => setOpen(open === k ? null : k);
  const readDrive = async () => {
    setDrive({ state: 'loading', files: [], why: '' });
    try {
      setDrive({ state: 'done', files: await listDrive(), why: '' });
    } catch (e) {
      setDrive({ state: 'error', files: [], why: (e as Error).message });
    }
  };
  return (
    <>
      <ScreenHead title={t('menuReplay')} />
      <div className="screen-actions">
        <BackButton t={t} onClick={onBack} />
      </div>
      <div className="mode-list">
        <ModeRow tile="4p" name={t('replayPlay')} desc={t('replayPlayDesc')} open={open === 'play'} onClick={() => toggle('play')} />
        {open === 'play' && (
          <div className="mode-choices">
            <button type="button" className="choice-btn" disabled={!hasLast} onClick={onPlayLast}>
              {t('srcLast')}
            </button>
            <button type="button" className="choice-btn" onClick={onPlayFile}>
              {t('srcFile')}
            </button>
            <button type="button" className="choice-btn" onClick={() => void readDrive()}>
              {t('srcDrive')}
            </button>
            {!hasLast && <p className="choice-note">{t('noLastGame')}</p>}
            {drive.state === 'loading' && <p className="choice-note">{t('driveLoading')}</p>}
            {drive.state === 'error' && <p className="choice-note">{t('driveFailed', { why: drive.why })}</p>}
            {drive.state === 'done' && drive.files.length === 0 && <p className="choice-note">{t('driveEmpty')}</p>}
            {drive.state === 'done' && drive.files.length > 0 && (
              <ul className="drive-list">
                {drive.files.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="link-btn" onClick={() => onPlayDrive(f.id)}>
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ModeRow tile="5p" name={t('replaySave')} desc={t('replaySaveDesc')} open={open === 'save'} onClick={() => toggle('save')} />
        {open === 'save' && (
          <div className="mode-choices">
            <button type="button" className="choice-btn" disabled={!hasLast} onClick={onSaveFile}>
              {t('srcFile')}
            </button>
            <button type="button" className="choice-btn" disabled={!hasLast} onClick={onSaveDrive}>
              {t('srcDrive')}
            </button>
            {!hasLast && <p className="choice-note">{t('noLastGame')}</p>}
          </div>
        )}
      </div>
      {note && <p className="hint save-note">{note}</p>}
    </>
  );
}
