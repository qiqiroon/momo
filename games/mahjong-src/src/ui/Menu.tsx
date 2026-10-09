// トップ画面（モード選択）と、そこから入る画面（CPU と対局・対局の再生）。
// 見た目は MOMO Shogi のモード選択（features/matchmaking/ui/MenuScreen.tsx の ModeRow）にならう。
// 将棋の駒の形の絵の代わりに、牌（ピンズ）の絵を使う（2026-10-09 利用者指示）。

import { useState, type ReactNode } from 'react';
import type { MessageKey } from '../i18n/strings';

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

/** モード選択へ戻るボタン（家の絵） */
export function HomeButton({ t, onClick }: { t: T; onClick: () => void }) {
  return (
    <button type="button" className="back-btn" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t('backToMenu')}
    </button>
  );
}

/** 画面の見出し（左に戻るボタン） */
export function ScreenHead({ t, title, onBack }: { t: T; title: string; onBack: () => void }) {
  return (
    <div className="screen-head">
      <HomeButton t={t} onClick={onBack} />
      <h2>{title}</h2>
    </div>
  );
}

/** ほかの MOMO のゲームと同じフッター（このアプリについて・MOMO Works へのリンク） */
export function SiteFooter({ t, children }: { t: T; children?: ReactNode }) {
  return (
    <footer className="site-footer">
      {children}
      <h2>{t('footerAbout')}</h2>
      <p>{t('footerDesc')}</p>
      <div className="foot-links">
        <a href="../../">{t('footerTop')}</a>
        <a href="../../games/">{t('footerGames')}</a>
        <a href="../../tools/">{t('footerTools')}</a>
      </div>
    </footer>
  );
}

// ---- ルールセット（見本 settings.html の TIERS と同じ並び） ----

type SetTag = 'net' | 'intl';
const TIERS: { label: MessageKey; sets: [string, SetTag?][] }[] = [
  { label: 'tierJp', sets: [['general'], ['ml'], ['tenhou', 'net'], ['saikoui'], ['npm'], ['kenko'], ['rmu'], ['jpml'], ['mu'], ['wrc', 'intl'], ['ema', 'intl']] },
  { label: 'tierCn', sets: [['sichuan'], ['mcr'], ['hk']] },
];

/** 今の段階で対局できるセット（ほかは段階6で動くようにする＝押しても変わらない） */
const PLAYABLE = new Set(['general']);

/** CPU と対局：ルールセットを選んでから始める */
export function CpuSetup({ t, onBack, onStart }: { t: T; onBack: () => void; onStart: () => void }) {
  const [preset, setPreset] = useState('general');
  return (
    <>
      <ScreenHead t={t} title={t('menuCpu')} onBack={onBack} />
      <section className="gset">
        <h3>{t('ruleSet')}</h3>
        <details className="about-sets">
          <summary>{t('aboutSets')}</summary>
          <p className="guide">{t('aboutSetsText')}</p>
        </details>
        <div className="sets">
          {TIERS.map((tier) => (
            <div className="tier" key={tier.label}>
              <span>{t(tier.label)}</span>
              <span className="seg">
                {tier.sets.map(([id, tag]) => (
                  <button
                    type="button"
                    key={id}
                    className={`${preset === id ? 'on' : ''}${tag ? ` tagged` : ''}`}
                    data-tag={tag ? t(tag === 'net' ? 'tagNet' : 'tagIntl') : undefined}
                    onClick={() => PLAYABLE.has(id) && setPreset(id)}
                  >
                    {t(`set_${id}` as MessageKey)}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>
      <button type="button" className="btn-primary btn-start" onClick={onStart}>
        {t('start')}
      </button>
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
      <ScreenHead t={t} title={t('menuReplay')} onBack={onBack} />
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
