// ルールブックの役の一覧（日本式）と番の一覧（中国式の四川・香港・国標）。花札の役一覧と同じ形：名前と翻・番（右）・説明・牌の並びの例。
// いまのルールで付かない役は灰色（ローカル役の「なし」・一発なし・人和なし など）。鳴いたときの翻は喰いタンの値も見る。

import type { CSSProperties, ReactNode } from 'react';
import type { Rules } from '../engine/rules';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { shownGroups } from '../rulebook/example';
import type { YakuId } from '../engine/yaku';
import { JP_SECTIONS, JP_YAKU, isLocalYaku, membersOf, type JpYakuEntry, type YakuExample } from '../rulebook/jpYaku';
import { cnFansOf, type CnFanEntry, type CnScoring } from '../rulebook/cnFan';
import { MCR_FAN_LIST } from '../rulebook/mcrFan';
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

function Example({ ex, rules }: { ex: YakuExample; rules: Rules }) {
  const groups = shownGroups(ex);
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

/** 一覧の 1 行：名前と値（右）・説明・補足・牌の並び。off＝いまのルールで付かない（灰色） */
function Row({ ids, name, value, off, text, note, ex, rules }: { ids: readonly string[]; name: string; value: string; off: boolean; text: string; note?: ReactNode; ex: YakuExample; rules: Rules }) {
  // data-ids＝この行の役の id（アシストモードの役名から、この行へ送るため）
  return (
    <div className={`rb-row${off ? ' off' : ''}`} data-ids={ids.join(' ')}>
      <div className="rb-row-head">
        <span className="rb-name">{name}</span>
        <span className="rb-val">{value}</span>
      </div>
      <p className="rb-cond">{text}</p>
      {note}
      <Example ex={ex} rules={rules} />
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
                <Row
                  key={e.id}
                  ids={membersOf(e)}
                  name={nameOf(e)}
                  value={st.off ? t('rbOff') : value(e, st.openHan)}
                  off={st.off}
                  text={e.text[lang]}
                  note={
                    locals.length > 1 && (
                      <p className="rb-cond rb-state">{t('rbLocalState', { list: locals.map((id) => `${yakuName(id)} ${t(jpYakuOn(id, v) ? 'rbOnWord' : 'rbOffWord')}`).join(t('rbJoin')) })}</p>
                    )
                  }
                  ex={e.ex}
                  rules={rules}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

type CnValues = Extract<Rules, { family: 'cn' }>['values'];

/** 字牌を使う番（字牌「なし」のルールでは付かない）。香港と国標 */
const HONOR_FANS: ReadonlySet<string> = new Set([
  'dragon', 'wind', 'huayao', 'hunyise', 'xiaosanyuan', 'dasanyuan', 'ziyise', 'xiaosixi', 'dasixi', 'shisanyao',
  'dasixiG', 'dasanyuanG', 'shisanyaoG', 'xiaosixiG', 'xiaosanyuanG', 'ziyiseG', 'hunyaojiu', 'qixingbukao', 'quanbukao', 'sanfengke', 'wumenqi', 'shuangjianke', 'jianke', 'quanfengke', 'menfengke', 'hunyiseG',
]);

/** いまのルールでその番が付くか（七対子・嶺上・杠上炮・搶槓・天糊地糊・字牌・花牌の項目） */
export function cnFanOn(id: string, v: CnValues): boolean {
  if (id === 'qidui' || id === 'qiduiG' || id === 'lianqidui') return v.qidui === 'on';
  if (id === 'gangkai' || id === 'gangkaiHk' || id === 'ganggang') return v.rinshan === 'on';
  if (id === 'gangpao') return v.gangshangpao === 'on';
  if (id === 'qianggang' || id === 'qianggangHk' || id === 'qiangganghe') return v.chankan === 'on';
  if (id === 'tianhu' || id === 'dihu') return v.tenhou === 'on';
  if (id === 'huapai') return v.flower === 'on';
  if (HONOR_FANS.has(id)) return v.honors === 'on';
  return true;
}

/** 一覧の 1 行ぶん（四川・香港・国標で同じ形） */
type FanRow = Pick<CnFanEntry, 'fan' | 'each' | 'limit' | 'text' | 'ex'> & { id: string; also?: readonly string[] };

/** 番の一覧（四川・香港・国標）。番数ごとにまとめる。四川・香港は小さい番から（香港の例牌は最後に別の見出し）、国標は公式の表と同じく大きい番から（Q8=A） */
export function CnFanList({ t, lang, rules, scoring }: { t: T; lang: BaseLang; rules: Extract<Rules, { family: 'cn' }>; scoring: CnScoring | 'mcr' }) {
  const v = rules.values;
  const list: readonly FanRow[] = scoring === 'mcr' ? MCR_FAN_LIST : cnFansOf(scoring);
  const members = (e: FanRow) => [e.id, ...(e.also ?? [])];
  const fanName = (id: string) => t(`cnFan_${id}` as MessageKey);
  const sections = [...new Set(list.filter((e) => !e.limit).map((e) => e.fan))].sort((a, b) => (scoring === 'mcr' ? b - a : a - b));
  const value = (e: FanRow) => (e.each ? t(scoring === 'mcr' ? 'rbFanPerFlower' : 'rbFanEach', { n: e.fan }) : t('rbFanN', { n: e.fan }));
  const rows = (es: readonly FanRow[]) =>
    es.map((e) => {
      const off = !members(e).some((id) => cnFanOn(id, v));
      return <Row key={e.id} ids={members(e)} name={members(e).map(fanName).join(t('rbJoin'))} value={off ? t('rbOff') : value(e)} off={off} text={e.text[lang]} ex={e.ex} rules={rules} />;
    });
  const limits = list.filter((e) => e.limit);
  return (
    <div className="rb-yaku">
      <p className="rb-legend">{t('rbLegend')}</p>
      {sections.map((n) => (
        <section key={n}>
          <h4 className="rb-sec">{t('rbFanSec', { n })}</h4>
          {rows(list.filter((e) => !e.limit && e.fan === n))}
        </section>
      ))}
      {limits.length > 0 && (
        <section>
          <h4 className="rb-sec">{t('rbSecLimit')}</h4>
          {rows(limits)}
        </section>
      )}
    </div>
  );
}
