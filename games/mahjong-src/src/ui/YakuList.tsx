// ルールブックの役の一覧（日本式）。花札の役一覧と同じ形：役の名前と翻（右）・説明・牌の並びの例。
// いまのルールで付かない役は灰色（ローカル役の「なし」・一発なし・人和なし など）。鳴いたときの翻は喰いタンの値も見る。

import type { CSSProperties } from 'react';
import type { Rules } from '../engine/rules';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { shownGroups } from '../rulebook/example';
import type { YakuId } from '../engine/yaku';
import { JP_SECTIONS, JP_YAKU, isLocalYaku, membersOf, type JpYakuEntry } from '../rulebook/jpYaku';
import { Tile } from './Tile';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;
type JpValues = Extract<Rules, { family: 'jp' }>['values'];

/** いまのルールでその役が付くか（ローカル役の「なし」・一発なし・人和なし・大七星はダブル役満も要る） */
export function jpYakuOn(id: YakuId, v: JpValues): boolean {
  if (isLocalYaku(id)) return v[id] === 'on' && (id !== 'daichisei' || v.doubleYakuman === 'on');
  if (id === 'ippatsu') return v.ippatsu === 'on';
  if (id === 'jinho') return v.jinho !== 'none';
  return true;
}

/** 行の状態：まとめた役が 1 つも付かなければ off。鳴いたときの翻（0＝門前だけ・喰いタンの値も見る） */
export function jpYakuState(e: JpYakuEntry, v: JpValues): { off: boolean; openHan: number } {
  const off = !membersOf(e).some((id) => jpYakuOn(id, v));
  const openHan = e.id === 'tanyao' ? (v.kuitan === 'on' ? 1 : 0) : (e.openHan ?? e.han);
  return { off, openHan };
}

/** 1 行に並べる幅（牌の枚数ぶん）。横に倒した牌は 0.5 枚・面子の間と牌の間のすき間は 0.4 枚ぶん・端の余り 1 枚ぶんを足す。
 *  14 枚の手（5 組）より小さくはしない＝ふつうの手はどれも同じ大きさ */
function unitsOf(groups: ReturnType<typeof shownGroups>): number {
  const tiles = groups.reduce((a, g) => a + g.tiles.length + g.tiles.filter((x) => x.called).length * 0.5, 0);
  return Math.max(17, tiles + groups.length * 0.4 + 1);
}

function Example({ e, rules }: { e: JpYakuEntry; rules: Rules }) {
  const groups = shownGroups(e.ex);
  return (
    <div className="rb-tiles" style={{ '--u': unitsOf(groups).toFixed(2) } as CSSProperties}>
      {groups.map((g, i) => (
        <span key={i} className={`rb-grp${g.meld ? ' rb-meld' : ''}${g.key ? '' : ' rb-dim'}`}>
          {g.tiles.map((x, j) => (
            <Tile key={j} id={x.id} rules={rules} className={`${x.called ? 'called-tile' : ''}${x.win ? ' rb-win' : ''}`} />
          ))}
        </span>
      ))}
    </div>
  );
}

export function JpYakuList({ t, lang, rules }: { t: T; lang: BaseLang; rules: Extract<Rules, { family: 'jp' }> }) {
  const v = rules.values;
  const yakuName = (id: YakuId) => t(`yaku_${id}` as MessageKey, { wind: '' }).trim();
  const nameOf = (e: JpYakuEntry) => (e.nameKey ? t(e.nameKey) : membersOf(e).map(yakuName).join(t('rbJoin')));
  const value = (e: JpYakuEntry, openHan: number) => {
    if (e.id === 'jinho' && v.jinho === 'mangan') return t('rbMangan');
    if (e.yakuman) return t(e.yakuman === 2 || (e.id === 'daisuushii' && v.doubleYakuman === 'on') ? 'yakuman2' : 'limit_yakuman');
    const han = t('hanN', { n: e.han });
    if (openHan === 0) return t('rbClosedOnly', { han });
    if (openHan < e.han) return t('rbOpenHan', { han, open: t('hanN', { n: openHan }) });
    return han;
  };
  return (
    <div className="rb-yaku">
      <p className="rb-legend">{t('rbLegend')}</p>
      {JP_SECTIONS.map((sec) => {
        const list = JP_YAKU.filter((e) => e.section === sec);
        if (list.length === 0) return null;
        return (
          <section key={sec}>
            <h4 className="rb-sec">{t(`rbSec_${sec}` as MessageKey)}</h4>
            {list.map((e) => {
              const st = jpYakuState(e, v);
              // まとめた行のローカル役は、名前ごとにいまのルールで付くかを書く
              const locals = membersOf(e).filter(isLocalYaku);
              return (
                <div key={e.id} className={`rb-row${st.off ? ' off' : ''}`}>
                  <div className="rb-row-head">
                    <span className="rb-name">{nameOf(e)}</span>
                    <span className="rb-val">{st.off ? t('rbOff') : value(e, st.openHan)}</span>
                  </div>
                  <p className="rb-cond">{e.text[lang]}</p>
                  {locals.length > 1 && (
                    <p className="rb-cond rb-state">{t('rbLocalState', { list: locals.map((id) => `${yakuName(id)} ${t(jpYakuOn(id, v) ? 'rbOnWord' : 'rbOffWord')}`).join(t('rbJoin')) })}</p>
                  )}
                  <Example e={e} rules={rules} />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
