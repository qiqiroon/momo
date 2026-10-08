// 卓の画面。受け取るのは席 0 から見える局面（view）だけ。
// 広い画面＝正方形の卓（自分が手前・下家が右・対面が奥・上家が左）。
// 狭い画面＝横に 4 列（下家→対面→上家→自分の順＝打つ順に上から下へ流れる）＋手牌。

import { Fragment, useState, type CSSProperties, type PointerEvent } from 'react';
import { HIDDEN, type Seat } from '../engine/events';
import { furitenOf } from '../engine/furiten';
import type { Action } from '../engine/round';
import type { ScoreResult } from '../engine/score';
import { liveWallLeft, type GameState } from '../engine/state';
import { kindOf, type TileId } from '../engine/tiles';
import { HUMAN } from '../game/useTable';
import { translate, type Lang, type MessageKey } from '../i18n/strings';
import { Tile } from './Tile';
import { useNarrow } from './useNarrow';
import { HAND_ROW, handRowUnits, handTileWidth, riverRows, riverTileWidth } from './squareLayout';

interface Props {
  view: GameState;
  legal: Action[];
  lang: Lang;
  onChoose: (a: Action) => void;
  onAgain: () => void;
}

/** 自分から見た位置（0＝自分・1＝下家・2＝対面・3＝上家） */
const relOf = (seat: number): number => (seat - HUMAN + 4) % 4;
const seatAt = (rel: number): Seat => ((rel + HUMAN) % 4) as Seat;

/** 手牌の並べ替え：種類順、同じ種類なら背番号順 */
const sortTiles = (tiles: readonly TileId[]) => tiles.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);

export function Table({ view, legal, lang, onChoose, onAgain }: Props) {
  const narrow = useNarrow();
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  const windOf = (seat: number) => t(`wind${(seat - view.dealer + 4) % 4}` as MessageKey);
  const nameOf = (seat: number) => (seat === HUMAN ? t('you') : t('cpu', { n: relOf(seat) }));
  const roundLabel = t('round', { wind: t('roundWind0'), n: view.roundIndex + 1 });
  const left = Math.max(0, liveWallLeft(view));
  const playing = view.phase !== 'ended';
  // 直前に切った人（その河の最後の牌に印を付ける）
  const lastDiscarder = view.phase === 'draw' ? (view.turn + 3) % 4 : -1;

  // 自分のフリテン（手牌が見えるのは自分だけなので、出すのも自分の分だけ）。局の途中だけ出す
  const furiten = view.phase === 'draw' || view.phase === 'discard' ? furitenOf(view, HUMAN) : null;
  const furitenCauses = new Set(furiten?.causes ?? []);

  /** 河の牌の印：直前に切られた牌・リーチの宣言牌（横に曲げる）・自分のフリテンの元になっている牌 */
  const riverClass = (seat: number, i: number) =>
    [
      seat === lastDiscarder && i === view.discards[seat].length - 1 ? 'last' : '',
      view.riichiAt[seat] === i ? 'riichi-tile' : '',
      seat === HUMAN && furitenCauses.has(i) ? 'furiten-cause' : '',
    ]
      .filter(Boolean)
      .join(' ');
  const riichiMark = (seat: number) => (
    <>
      {view.riichi[seat] !== 'none' && <span className="riichi-mark">{t('riichi')}</span>}
      {seat === HUMAN && furiten && furiten.reasons.length > 0 && <span className="furiten-mark">{t('furiten')}</span>}
    </>
  );

  const river = (seat: number) => (
    <div className="river">
      {view.discards[seat].map((id, i) => (
        <Tile key={i} id={id} rules={view.rules} className={riverClass(seat, i)} />
      ))}
    </div>
  );

  const hand = <MyHand view={view} legal={legal} lang={lang} onChoose={onChoose} />;

  // ドラ表示牌（めくられた順）
  const indicators = view.doraIndicators.length > 0 && (
    <span className="dora-ind">
      <span className="dora-ind-label">{t('doraIndicator')}</span>
      {view.doraIndicators.map((id) => (
        <Tile key={id} id={id} rules={view.rules} className="mini" />
      ))}
    </span>
  );

  const won = view.result?.type === 'tsumo' ? view.result : null;
  const result = view.phase === 'ended' && view.result && (
    <div className="result" role="dialog">
      <p className="result-title">
        {won ? t('resultTsumo', { name: nameOf(won.seat) }) : t('resultExhaust')}
      </p>
      {won && (
        <div className="result-hand">
          {sortTiles(view.hands[won.seat].filter((x) => x !== won.winTile)).map((id) => (
            <Tile key={id} id={id} rules={view.rules} />
          ))}
          <span className="drawn-gap" />
          <Tile id={won.winTile} rules={view.rules} className="win-tile" />
        </div>
      )}
      {won && won.ura.length > 0 && (
        <span className="dora-ind">
          <span className="dora-ind-label">{t('uraIndicator')}</span>
          {won.ura.map((id) => (
            <Tile key={id} id={id} rules={view.rules} className="mini" />
          ))}
        </span>
      )}
      {won && <ScoreView score={won.score} lang={lang} />}
      {view.result.type === 'exhaust' && (
        <table className="exhaust-list">
          <tbody>
            {[0, 1, 2, 3].map((rel) => {
              const seat = seatAt(rel);
              const r = view.result?.type === 'exhaust' ? view.result : null;
              if (!r) return null;
              const pay = r.payments[seat];
              // テンパイの人の手牌は名前の行の下に 1 行で出す（携帯の幅でも横にはみ出さない）
              return (
                <Fragment key={rel}>
                  <tr className={r.tenpai[seat] ? 'is-tenpai' : ''}>
                    <th>
                      <b>{windOf(seat)}</b> {nameOf(seat)}
                    </th>
                    <td className="exhaust-state">{t(r.tenpai[seat] ? 'declareTenpai' : 'declareNoten')}</td>
                    <td className="exhaust-pay">{pay > 0 ? `+${pay}` : pay < 0 ? `−${-pay}` : '±0'}</td>
                  </tr>
                  {r.tenpai[seat] && (
                    <tr className="exhaust-hand-row">
                      <td colSpan={3}>
                        <div className="exhaust-hand">
                          {sortTiles(view.hands[seat]).map((id) => (
                            <Tile key={id} id={id} rules={view.rules} className="mini" />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      <button type="button" className="btn-primary" onClick={onAgain}>
        {t('again')}
      </button>
    </div>
  );

  if (narrow) {
    return (
      <div className="lanes-wrap felt">
        <div className="lanes-info">
          <span className="round-label">{roundLabel}</span>
          <span className="wall-left">{t('wallLeft', { n: left })}</span>
          {indicators}
        </div>
        <div className="lanes">
          {[1, 2, 3, 0].map((rel) => {
            const seat = seatAt(rel);
            return (
              <section key={rel} className={`lane${view.turn === seat && playing ? ' is-turn' : ''}`}>
                <div className="lane-who">
                  <span className="lane-wind">{windOf(seat)}</span>
                  <span className="lane-name">{nameOf(seat)}</span>
                  {riichiMark(seat)}
                  {seat !== HUMAN && (
                    <span className="lane-count">
                      <Tile id={HIDDEN} rules={view.rules} className="mini" />×{view.hands[seat].length}
                    </span>
                  )}
                </div>
                {river(seat)}
              </section>
            );
          })}
        </div>
        {hand}
        {result}
      </div>
    );
  }

  // 正方形の卓の大きさ（squareLayout.ts の決め方）
  const handWidths = [0, 1, 2, 3].map((rel) => {
    const seat = seatAt(rel);
    const units = handRowUnits(view.hands[seat].length, seat === HUMAN && view.drawn[seat] !== null);
    return handTileWidth(units, rel === 0 ? HAND_ROW.me : HAND_ROW.other);
  });
  const riverTw = riverTileWidth(handWidths);
  const cq = (n: number) => ({ '--tw': `${n.toFixed(2)}cqw` }) as CSSProperties;

  const squareRiver = (seat: number) => (
    <div className="river-rows">
      {riverRows(view.discards[seat].map((id, i) => ({ id, i }))).map((row, r) => (
        <div key={r} className="river-row">
          {row.map(({ id, i }) => (
            <Tile key={i} id={id} rules={view.rules} className={riverClass(seat, i)} />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div className="square-wrap">
      <div className="square felt">
        <div className="center-box">
          <span className="round-label">{roundLabel}</span>
          <span className="wall-left">{t('wallLeft', { n: left })}</span>
          {indicators}
          {[0, 1, 2, 3].map((rel) => {
            const seat = seatAt(rel);
            return (
              <span key={rel} className={`center-wind rel-${rel}${view.turn === seat && playing ? ' is-turn' : ''}`}>
                <b>{windOf(seat)}</b> {nameOf(seat)}
                {riichiMark(seat)}
              </span>
            );
          })}
        </div>
        {[0, 1, 2, 3].map((rel) => (
          <div key={rel} className={`seat-river rel-${rel}`} style={cq(riverTw)}>
            {squareRiver(seatAt(rel))}
          </div>
        ))}
        {[1, 2, 3].map((rel) => (
          <div key={rel} className={`seat-hand rel-${rel}`} style={cq(handWidths[rel])}>
            {view.hands[seatAt(rel)].map((id, i) => (
              <Tile key={i} id={id} rules={view.rules} />
            ))}
          </div>
        ))}
        <div className="seat-hand rel-0" style={cq(handWidths[0])}>
          {hand}
        </div>
        {result}
      </div>
    </div>
  );
}

/** アガリの役と点数。役の名前・翻、ドラの数、符と翻（または満貫などの段階）、支払い、合計 */
function ScoreView({ score, lang }: { score: ScoreResult; lang: Lang }) {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  const yakumanName = (n: number) => (n === 1 ? t('limit_yakuman') : n === 2 ? t('yakuman2') : n === 3 ? t('yakuman3') : t('yakumanN', { n }));
  const windName = (k: number) => t(`wind${k - 27}` as MessageKey);
  const rows: { name: string; value: string }[] = score.yaku.map((y) => ({
    name: t(`yaku_${y.id}` as MessageKey, { wind: '' }),
    value: y.yakuman > 0 ? yakumanName(y.yakuman) : t('hanN', { n: y.han }),
  }));
  // 場風・自風は何の風かを名前に入れる（役の判定は風の種類を持たないので、局面の風から出す）
  score.yaku.forEach((y, i) => {
    if (y.id === 'roundWind' || y.id === 'seatWind') rows[i].name = t(`yaku_${y.id}`, { wind: windName(score.winds[y.id]) });
  });
  for (const [key, n] of [['yakuDora', score.dora.dora], ['yakuAka', score.dora.aka], ['yakuUra', score.dora.ura]] as const) {
    if (n > 0) rows.push({ name: t(key), value: t('hanN', { n }) });
  }
  const level =
    score.limit === 'yakuman'
      ? yakumanName(score.yakuman)
      : score.limit === 'none'
        ? t('hanFu', { han: score.han, fu: score.fu })
        : `${t('hanFu', { han: score.han, fu: score.fu })}　${t(`limit_${score.limit}` as MessageKey)}`;
  const p = score.payment;
  const pay =
    p.type === 'ron'
      ? t('payRon', { amount: p.amount })
      : p.fromDealer === 0
        ? t('payTsumoDealer', { each: p.fromOthers })
        : t('payTsumoChild', { others: p.fromOthers, dealer: p.fromDealer });
  return (
    <div className="score">
      <table className="yaku-list">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th>{r.name}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="score-level">{level}</p>
      <p className="score-pay">{pay}</p>
      <p className="score-total">{t('totalPoints', { n: score.total })}</p>
    </div>
  );
}

/** 自分の手牌。マウスは 1 回押すと切る／指は 1 回目で浮かせ、2 回目で切る（押し間違いを防ぐ） */
function MyHand({ view, legal, lang, onChoose }: { view: GameState; legal: Action[]; lang: Lang; onChoose: (a: Action) => void }) {
  const [raised, setRaised] = useState<TileId | null>(null);
  // リーチを押したあと＝切る牌を選んでいるところ（もう一度押すとやめる）
  const [riichiPick, setRiichiPick] = useState(false);
  const myTurn = legal.length > 0;
  const drawn = view.drawn[HUMAN];
  const mine = view.hands[HUMAN];
  const rest = sortTiles(drawn === null ? mine : mine.filter((x) => x !== drawn));
  const canTsumo = legal.some((a) => a.type === 'tsumo');
  // 流局の宣言（テンパイを隠せるときだけボタンが出る。1 つしか言えないときは自動で言う）
  const declaring = view.phase === 'declare' && legal.length > 1;
  const riichiable = new Set(legal.flatMap((a) => (a.type === 'riichi' ? [a.tile] : [])));
  const discardable = new Set(legal.flatMap((a) => (a.type === 'discard' ? [a.tile] : [])));
  const picking = riichiPick && riichiable.size > 0;
  /** いま押せる牌（リーチの牌を選んでいるときは、リーチできる牌だけ） */
  const usable = (id: TileId) => (picking ? riichiable.has(id) : discardable.has(id));

  const press = (id: TileId) => (e: PointerEvent) => {
    if (!usable(id)) return;
    if (e.pointerType === 'mouse' || raised === id) {
      setRaised(null);
      setRiichiPick(false);
      onChoose(picking ? { type: 'riichi', tile: id } : { type: 'discard', tile: id });
    } else {
      setRaised(id);
    }
  };

  const tile = (id: TileId) => (
    <button key={id} type="button" className={`hand-tile${raised === id ? ' raised' : ''}`} disabled={!usable(id)} onPointerUp={press(id)}>
      <Tile id={id} rules={view.rules} />
    </button>
  );

  return (
    <div className={`my-hand${myTurn ? ' my-turn' : ''}`}>
      <div className="hand-actions">
        {canTsumo && (
          <button type="button" className="btn-primary btn-tsumo" onClick={() => onChoose({ type: 'tsumo' })}>
            {translate(lang, 'tsumo')}
          </button>
        )}
        {declaring && (
          <>
            <button type="button" className="btn-primary btn-tenpai" onClick={() => onChoose({ type: 'tenpai' })}>
              {translate(lang, 'declareTenpai')}
            </button>
            <button type="button" className="btn-primary btn-noten" onClick={() => onChoose({ type: 'noten' })}>
              {translate(lang, 'declareNoten')}
            </button>
            <span className="hint">{translate(lang, 'declareHint')}</span>
          </>
        )}
        {riichiable.size > 0 && (
          <button
            type="button"
            className={`btn-primary btn-riichi${picking ? ' active' : ''}`}
            onClick={() => {
              setRaised(null);
              setRiichiPick(!picking);
            }}
          >
            {translate(lang, picking ? 'riichiCancel' : 'riichi')}
          </button>
        )}
        {picking && <span className="hint">{translate(lang, 'riichiPick')}</span>}
        {raised !== null && myTurn && <span className="hint">{translate(lang, 'tapAgain')}</span>}
      </div>
      <div className="hand-row">
        {rest.map(tile)}
        {drawn !== null && <span className="drawn-gap" />}
        {drawn !== null && tile(drawn)}
      </div>
    </div>
  );
}
