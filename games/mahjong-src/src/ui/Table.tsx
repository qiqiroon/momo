// 卓の画面。受け取るのは席 0 から見える局面（view）だけ。
// 広い画面＝正方形の卓（自分が手前・下家が右・対面が奥・上家が左）。
// 狭い画面＝横に 4 列（下家→対面→上家→自分の順＝打つ順に上から下へ流れる）＋手牌。

import { useState, type CSSProperties, type PointerEvent } from 'react';
import { HIDDEN, type Seat } from '../engine/events';
import type { Action } from '../engine/round';
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
  const winds = t('winds').split(',');
  const windOf = (seat: number) => winds[(seat - view.dealer + 4) % 4];
  const nameOf = (seat: number) => (seat === HUMAN ? t('you') : t('cpu', { n: relOf(seat) }));
  const roundLabel = t('round', { wind: t('roundWinds').split(',')[0], n: view.roundIndex + 1 });
  const left = Math.max(0, liveWallLeft(view));
  const playing = view.phase !== 'ended';
  // 直前に切った人（その河の最後の牌に印を付ける）
  const lastDiscarder = view.phase === 'draw' ? (view.turn + 3) % 4 : -1;

  const river = (seat: number) => (
    <div className="river">
      {view.discards[seat].map((id, i) => (
        <Tile key={i} id={id} rules={view.rules} className={seat === lastDiscarder && i === view.discards[seat].length - 1 ? 'last' : ''} />
      ))}
    </div>
  );

  const hand = <MyHand view={view} legal={legal} lang={lang} onChoose={onChoose} />;

  const result = view.phase === 'ended' && view.result && (
    <div className="result" role="dialog">
      <p className="result-title">
        {view.result.type === 'tsumo' ? t('resultTsumo', { name: nameOf(view.result.seat) }) : t('resultExhaust')}
      </p>
      {view.result.type === 'tsumo' && (
        <div className="result-hand">
          {sortTiles(view.hands[view.result.seat]).map((id) => (
            <Tile key={id} id={id} rules={view.rules} />
          ))}
        </div>
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
        </div>
        <div className="lanes">
          {[1, 2, 3, 0].map((rel) => {
            const seat = seatAt(rel);
            return (
              <section key={rel} className={`lane${view.turn === seat && playing ? ' is-turn' : ''}`}>
                <div className="lane-who">
                  <span className="lane-wind">{windOf(seat)}</span>
                  <span className="lane-name">{nameOf(seat)}</span>
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
            <Tile key={i} id={id} rules={view.rules} className={seat === lastDiscarder && i === view.discards[seat].length - 1 ? 'last' : ''} />
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
          {[0, 1, 2, 3].map((rel) => {
            const seat = seatAt(rel);
            return (
              <span key={rel} className={`center-wind rel-${rel}${view.turn === seat && playing ? ' is-turn' : ''}`}>
                <b>{windOf(seat)}</b> {nameOf(seat)}
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

/** 自分の手牌。マウスは 1 回押すと切る／指は 1 回目で浮かせ、2 回目で切る（押し間違いを防ぐ） */
function MyHand({ view, legal, lang, onChoose }: { view: GameState; legal: Action[]; lang: Lang; onChoose: (a: Action) => void }) {
  const [raised, setRaised] = useState<TileId | null>(null);
  const myTurn = legal.length > 0;
  const drawn = view.drawn[HUMAN];
  const mine = view.hands[HUMAN];
  const rest = sortTiles(drawn === null ? mine : mine.filter((x) => x !== drawn));
  const canTsumo = legal.some((a) => a.type === 'tsumo');

  const press = (id: TileId) => (e: PointerEvent) => {
    if (!myTurn) return;
    if (e.pointerType === 'mouse' || raised === id) {
      setRaised(null);
      onChoose({ type: 'discard', tile: id });
    } else {
      setRaised(id);
    }
  };

  const tile = (id: TileId) => (
    <button key={id} type="button" className={`hand-tile${raised === id ? ' raised' : ''}`} disabled={!myTurn} onPointerUp={press(id)}>
      <Tile id={id} rules={view.rules} />
    </button>
  );

  return (
    <div className={`my-hand${myTurn ? ' my-turn' : ''}`}>
      <div className="hand-actions">
        {canTsumo && (
          <button type="button" className="btn-primary" onClick={() => onChoose({ type: 'tsumo' })}>
            {translate(lang, 'tsumo')}
          </button>
        )}
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
