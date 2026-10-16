// 対局中のメニュー（段階10・利用者指示 10-15）：今までの「中断」のボタンを「メニュー」に替え、押すと選ぶ窓を出す。
// 中身＝対局を中断／CPU に任せる（任せている間は「席を返してもらう」）／ほかの人を CPU に切り替える（ホストだけ）／ルールブック／キャンセル。
// 見た目は歯車の設定の窓（sound-backdrop・sound-panel）にそろえる。
import { useState } from 'react';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

export interface MenuSeat {
  seat: number;
  name: string;
  /** 接続が切れている（ホストは 3 分待たずに切り替えられる＝10-15 利用者指示） */
  away: boolean;
}

export interface GameMenuProps {
  t: T;
  onQuit?: () => void;
  onBook?: () => void;
  /** オンライン：自分の席の CPU 任せ（無ければ出さない） */
  cpu?: { proxy: boolean; pending: boolean; onYield: () => void; onReclaim: () => void };
  /** オンラインのホスト：ほかの人の席を CPU に切り替える（CPU に任されていない人の席だけ） */
  take?: { seats: MenuSeat[]; onTake: (seat: number) => void };
  /** オンラインのホスト：観戦者（段階10の3）。観戦を許す・断る（断ると見ている人にも出てもらう）と、観戦者のキック */
  watch?: { allow: boolean; spectators: { id: string; name: string }[]; onAllow: (v: boolean) => void; onKick: (id: string) => void };
  /** ボタンにつける見た目（置き場所ごとに違う） */
  className?: string;
}

export function GameMenu({ t, onQuit, onBook, cpu, take, watch, className = '' }: GameMenuProps) {
  const [open, setOpen] = useState<'main' | 'take' | 'watch' | null>(null);
  const close = () => setOpen(null);
  const run = (f: () => void) => () => {
    close();
    f();
  };
  return (
    <>
      <button type="button" className={`icon-btn layout-btn menu-btn ${className}`} onClick={() => setOpen('main')} aria-haspopup="dialog">
        {t('menu')}
      </button>
      {open && (
        <div className="sound-backdrop" role="dialog" aria-modal="true" aria-label={t('menu')} onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="sound-panel game-menu">
            {open === 'main' ? (
              <>
                <h2>{t('menu')}</h2>
                {onQuit && (
                  <button type="button" className="btn-secondary" onClick={run(onQuit)}>
                    {t('menuQuit')}
                  </button>
                )}
                {cpu &&
                  (cpu.proxy ? (
                    <button type="button" className="btn-secondary" disabled={cpu.pending} onClick={run(cpu.onReclaim)}>
                      {t(cpu.pending ? 'menuReclaimWait' : 'menuReclaim')}
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary" onClick={run(cpu.onYield)}>
                      {t('menuYield')}
                    </button>
                  ))}
                {take && (
                  <button type="button" className="btn-secondary" onClick={() => setOpen('take')}>
                    {t('menuTake')}
                  </button>
                )}
                {watch && (
                  <button type="button" className="btn-secondary" onClick={() => setOpen('watch')}>
                    {t('menuWatch')}
                  </button>
                )}
                {onBook && (
                  <button type="button" className="btn-secondary" onClick={run(onBook)}>
                    {t('rbOpen')}
                  </button>
                )}
                <button type="button" className="btn-secondary menu-cancel" onClick={close}>
                  {t('menuCancel')}
                </button>
              </>
            ) : open === 'watch' && watch ? (
              <>
                <h2>{t('menuWatch')}</h2>
                <label className="ol-check">
                  <input type="checkbox" checked={watch.allow} onChange={(e) => watch.onAllow(e.target.checked)} />
                  <span>{t('olAllowSpectators')}</span>
                </label>
                <p>{t('olAllowSpectatorsDesc')}</p>
                {watch.spectators.length === 0 && <p>{t('olNoSpectatorsYet')}</p>}
                {watch.spectators.map((s) => (
                  <button key={s.id} type="button" className="btn-secondary" onClick={() => watch.onKick(s.id)}>
                    {t('menuWatchKick', { name: s.name })}
                  </button>
                ))}
                <button type="button" className="btn-secondary menu-cancel" onClick={() => setOpen('main')}>
                  {t('menuCancel')}
                </button>
              </>
            ) : (
              <>
                <h2>{t('menuTakeTitle')}</h2>
                {take && take.seats.length === 0 && <p>{t('menuTakeNone')}</p>}
                {take?.seats.map((s) => (
                  <button key={s.seat} type="button" className="btn-secondary" onClick={run(() => take.onTake(s.seat))}>
                    {s.away ? t('menuTakeAway', { name: s.name }) : s.name}
                  </button>
                ))}
                <button type="button" className="btn-secondary menu-cancel" onClick={() => setOpen('main')}>
                  {t('menuCancel')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
