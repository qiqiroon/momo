// 鳴ける牌の予告の帯（段階5の4c・工程表 v0.03 段階5・利用者決定 Q1=A）。オンラインだけ。
// ほかの人の番のあいだ、手牌の上の細い帯に「いま鳴ける牌」を小さく並べ、牌ごとに ロン／ポン／チー の印を付ける。
// 押すたびに「その場で聞く → 鳴く → 見送る」（ポンもカンもできる牌は「その場で聞く → ポン → カン → 見送る」）。
// チーは「上家のときだけ」と添える。組み合わせが何通りもある牌は、押すと一覧が出て選ぶ（選ばなければ「その場で聞く」）。

import { useState } from 'react';
import type { MessageKey } from '../i18n/strings';
import type { OnlineTable } from '../online/table';
import { nextPon, nextRon, type ChiPick, type PonPick, type RonPick } from '../online/presets';
import { Tile } from './Tile';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** 種類の牌の絵（赤5でない 1 枚） */
const idOf = (kind: number) => kind * 4 + 1;

export function CallStrip({ t, table }: { t: T; table: OnlineTable }) {
  const [picking, setPicking] = useState<number | null>(null);
  const v = table.view;
  const me = table.mySeat;
  if (me === null || table.dealing) return null;
  // 自分が切る番は出さない（ほかの人の番のあいだだけ）
  if (!['draw', 'discard', 'claim'].includes(v.phase) || (v.phase === 'discard' && v.turn === me)) return null;
  const list = table.callables();
  if (list.length === 0) return null;
  /** 選んだことの印：？＝その場で聞く／○＝鳴く（ポン・カンはその字）／×＝見送る */
  const mark = (p: RonPick | PonPick | ChiPick | undefined): string =>
    p === undefined || p === 'ask' ? '？' : p === 'no' ? '×' : p === 'kan' ? t('psKanShort') : p === 'pon' ? t('psPonShort') : '○';
  const state = (p: RonPick | PonPick | ChiPick | undefined) => (p === undefined || p === 'ask' ? 'ask' : p === 'no' ? 'no' : 'yes');
  return (
    <div className="call-strip" aria-label={t('psTitle')}>
      <span className="call-strip-title">{t('psTitle')}</span>
      <span className="call-strip-legend">{t('psLegend')}</span>
      {list.map((c) => {
        const p = table.presets.get(c.kind) ?? {};
        const set = (next: typeof p) => table.setPreset(c.kind, { ...p, ...next });
        return (
          <span key={c.kind} className="ps-tile">
            <Tile id={idOf(c.kind)} rules={v.rules} className="mini" />
            {c.ron && (
              <button type="button" className={`ps-chip ps-${state(p.ron)}`} title={t('ron')} onClick={() => set({ ron: nextRon(p.ron) })}>
                {t('psRonShort')}
                {mark(p.ron)}
              </button>
            )}
            {c.pon && (
              <button type="button" className={`ps-chip ps-${state(p.pon)}`} title={t(c.kan ? 'psPonKan' : 'pon')} onClick={() => set({ pon: nextPon(p.pon, c.kan) })}>
                {t(c.kan ? 'psPonKanShort' : 'psPonShort')}
                {p.pon === 'pon' || p.pon === 'kan' ? '' : mark(p.pon)}
              </button>
            )}
            {c.chi.length > 0 && (
              <button
                type="button"
                className={`ps-chip ps-${state(p.chi)}`}
                title={t('chi')}
                onClick={() => {
                  if (c.chi.length > 1) return setPicking(picking === c.kind ? null : c.kind);
                  // 組み合わせが 1 通り：聞く → 鳴く → 見送る
                  const cur = p.chi;
                  set({ chi: cur === undefined || cur === 'ask' ? { with: c.chi[0] } : typeof cur === 'object' ? 'no' : 'ask' });
                }}
              >
                {t('psChiShort')}
                {mark(p.chi)}
                {c.chi.length > 1 && typeof p.chi === 'object' && (
                  <span className="ps-with">
                    <Tile id={idOf(p.chi.with[0])} rules={v.rules} className="mini" />
                    <Tile id={idOf(p.chi.with[1])} rules={v.rules} className="mini" />
                  </span>
                )}
              </button>
            )}
            {picking === c.kind && (
              <span className="ps-pick">
                {c.chi.map(([a, b]) => (
                  <button
                    type="button"
                    key={`${a}-${b}`}
                    className="ps-chip"
                    onClick={() => {
                      set({ chi: { with: [a, b] } });
                      setPicking(null);
                    }}
                  >
                    <Tile id={idOf(a)} rules={v.rules} className="mini" />
                    <Tile id={idOf(b)} rules={v.rules} className="mini" />
                  </button>
                ))}
                <button
                  type="button"
                  className="ps-chip"
                  onClick={() => {
                    set({ chi: 'no' });
                    setPicking(null);
                  }}
                >
                  {t('psNo')}
                </button>
                <button
                  type="button"
                  className="ps-chip"
                  onClick={() => {
                    set({ chi: 'ask' });
                    setPicking(null);
                  }}
                >
                  {t('psAsk')}
                </button>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
