// トップ画面（モード選択）と、そこから入る画面（CPU と対局・対局の再生）。
// 見た目は MOMO Shogi のモード選択（features/matchmaking/ui/MenuScreen.tsx の ModeRow）にならう。
// 将棋の駒の形の絵の代わりに、牌（ピンズ）の絵を使う（2026-10-09 利用者指示）。

import { loadStrength, saveStrength, STRENGTH_LABEL, type Strength } from '../cpu/strength';
import { StrengthPicker } from './StrengthPicker';
import { useState, type ReactNode } from 'react';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { RuleSettings, loadRuleChoice, saveRuleChoice, type RuleChoice } from './RuleSettings';
import type { SameWall } from '../kifu/same';
import { LinkCopy } from './LinkCopy';

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

// ---- リンクで届いたルール（段階6の6c・Q40＝A） ----

/** リンクで届いたルールを見せ、CPU と対局かオンラインの部屋を作るかを選んでもらう。選ぶと端末の控えに入る。choice が null なら読めなかった */
export function RuleLinkScreen({ t, lang, choice, onCpu, onOnline, onCancel }: { t: T; lang: BaseLang; choice: RuleChoice | null; onCpu: () => void; onOnline: () => void; onCancel: () => void }) {
  return (
    <>
      <ScreenHead title={t('rlTitle')} />
      {choice ? (
        <>
          <p className="guide">{t('rlGuide')}</p>
          <div className="screen-actions rl-actions">
            <button type="button" className="btn-primary" onClick={onCpu}>
              {t('rlCpu')}
            </button>
            {/* 中国式はオンライン対局にまだ対応していない＝CPU と対局だけ */}
            {!choice.cn && (
              <button type="button" className="btn-primary" onClick={onOnline}>
                {t('rlOnline')}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {t('rlCancel')}
            </button>
          </div>
          <RuleSettings t={t} lang={lang} choice={choice} readOnly cnOk />
        </>
      ) : (
        <>
          <p className="guide">{t('rlBroken')}</p>
          <div className="screen-actions">
            <BackButton t={t} onClick={onCancel} />
          </div>
        </>
      )}
    </>
  );
}

// ---- CPU と対局：ルールを選んで始める（段階6の6a-2・選び方は RuleSettings） ----

/** CPU と対局：CPU の強さとルール（セットと個別設定）を選んでから始める。どちらも端末に覚える */
export function CpuSetup({ t, lang, onBack, onStart }: { t: T; lang: BaseLang; onBack: () => void; onStart: (c: RuleChoice) => void }) {
  const [choice, setChoice] = useState<RuleChoice>(loadRuleChoice);
  const [strength, setStrength] = useState<Strength>(loadStrength);
  const change = (c: RuleChoice) => {
    setChoice(c);
    saveRuleChoice(c);
  };
  const changeStrength = (s: Strength) => {
    setStrength(s);
    saveStrength(s);
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
      <StrengthPicker t={t} value={strength} onChange={changeStrength} />
      <RuleSettings t={t} lang={lang} choice={choice} onChange={change} share cnOk />
    </>
  );
}

// ---- 対局の再生（再生する・最後に打った・開いた対局を保存する） ----

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
  /** 最後に打った・開いた対局のリンク（#kifu=…）を作る（作れなければ投げる） */
  /** 牌譜のリンク（中国式の対局はまだ作れない＝null で押せない） */
  makeLink: (() => Promise<string>) | null;
  /** 最後に打った・開いた対局の「同じ山で勝負」のリンク（#same=…）。CPU と対局でなければ null */
  makeSameLink: (() => string) | null;
}

/** 同じ山で勝負のリンクを開いた人：ルールと送った人の成績を見せ、同じ山で CPU と打つ。sw が null なら読めなかった */
export function SameWallScreen({ t, lang, sw, onStart, onCancel }: { t: T; lang: BaseLang; sw: SameWall | null; onStart: () => void; onCancel: () => void }) {
  return (
    <>
      <ScreenHead title={t('sameTitle')} />
      {sw ? (
        <>
          <p className="guide">{t('sameGuide')}</p>
          {sw.result && <p className="guide same-result">{t('sameTheirResult', { rank: sw.result.rank, total: (sw.result.total > 0 ? '+' : '') + sw.result.total.toFixed(1) })}</p>}
          <p className="guide same-strength">{t('sameStrength', { s: STRENGTH_LABEL[sw.strength] })}</p>
          {sw.online && <p className="guide same-online">{t('sameOnlineNote')}</p>}
          {/* 山が分かってしまうので公平性は無い（利用者指示 10-11）。同意は求めない */}
          <p className="guide same-fair" role="note">
            {t('sameStartWarn')}
          </p>
          <div className="screen-actions">
            <button type="button" className="btn-primary btn-start" onClick={onStart}>
              {t('sameStart')}
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {t('rlCancel')}
            </button>
          </div>
          <RuleSettings t={t} lang={lang} choice={sw.choice} readOnly cnOk />
        </>
      ) : (
        <>
          <p className="guide">{t('sameBroken')}</p>
          <div className="screen-actions">
            <BackButton t={t} onClick={onCancel} />
          </div>
        </>
      )}
    </>
  );
}


/** 再生・保存の行を押すと、その下に「どこから／どこへ」を出す */
export function ReplayHub({ t, hasLast, note, onBack, onPlayLast, onPlayFile, listDrive, onPlayDrive, onSaveFile, onSaveDrive, makeLink, makeSameLink }: ReplayHubProps) {
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
            {/* 保存先の 4 行：何のための保存かを 2 行目に書き添える */}
            <button type="button" className="choice-btn with-desc" disabled={!hasLast} onClick={onSaveFile}>
              <span className="choice-label">{t('srcFile')}</span>
              <span className="choice-desc">{t('saveFileDesc')}</span>
            </button>
            <button type="button" className="choice-btn with-desc" disabled={!hasLast} onClick={onSaveDrive}>
              <span className="choice-label">{t('srcDrive')}</span>
              <span className="choice-desc">{t('saveDriveDesc')}</span>
            </button>
            <LinkCopy t={t} label={t('srcLink')} desc={t('kifuLinkDesc')} disabled={!hasLast || !makeLink} make={() => makeLink!()} done="kifuLinkCopied" />
            <LinkCopy t={t} label={t('srcSame')} desc={t('sameLinkDesc')} disabled={!hasLast || !makeSameLink} make={() => makeSameLink!()} done="sameCopied" warn="sameWarn" />
            {!hasLast && <p className="choice-note">{t('noLastGame')}</p>}
          </div>
        )}
      </div>
      {note && <p className="hint save-note">{note}</p>}
    </>
  );
}
