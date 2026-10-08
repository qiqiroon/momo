// 卓の画面。受け取るのは席 0 から見える局面（view）だけ。
// 広い画面＝正方形の卓（自分が手前・下家が右・対面が奥・上家が左）。
// 狭い画面＝横に 4 列（下家→対面→上家→自分の順＝打つ順に上から下へ流れる）＋手牌。

import { Fragment, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { HIDDEN, type Seat } from '../engine/events';
import { furitenOf } from '../engine/furiten';
import { finalResult } from '../engine/final';
import { nextStep } from '../engine/game';
import type { Action } from '../engine/round';
import type { ScoreResult } from '../engine/score';
import { liveWallLeft, type GameState, type OpenMeld } from '../engine/state';
import { isRed, kindOf, type TileId } from '../engine/tiles';
import { HUMAN } from '../game/useTable';
import { translate, type Lang, type MessageKey } from '../i18n/strings';
import { DraggableDialog } from './DraggableDialog';
import { Tile } from './Tile';
import { HAND_ROW, handRowUnits, handTileWidth, riverRows, riverTileWidth } from './squareLayout';
import type { Rules } from '../engine/rules';

interface Props {
  /** 横4列で並べるか（false＝正方形の卓）。どちらにするかは useLayout が決める */
  narrow: boolean;
  view: GameState;
  legal: Action[];
  lang: Lang;
  onChoose: (a: Action) => void;
  /** 次の局へ（局が終わったとき） */
  onNext: () => void;
  /** 新しい対局（対局が終わったとき） */
  onNewGame: () => void;
}

/** 自分から見た位置（0＝自分・1＝下家・2＝対面・3＝上家） */
const relOf = (seat: number): number => (seat - HUMAN + 4) % 4;
const seatAt = (rel: number): Seat => ((rel + HUMAN) % 4) as Seat;

/** 手牌の並べ替え：種類順、同じ種類なら背番号順 */
const sortTiles = (tiles: readonly TileId[]) => tiles.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);

export function Table({ narrow, view, legal, lang, onChoose, onNext, onNewGame }: Props) {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  const windOf = (seat: number) => t(`wind${(seat - view.dealer + 4) % 4}` as MessageKey);
  const nameOf = (seat: number) => (seat === HUMAN ? t('you') : t('cpu', { n: relOf(seat) }));
  const roundLabel = t('round', { wind: t(`roundWind${Math.floor(Math.max(0, view.roundIndex) / 4) % 3}` as MessageKey), n: (Math.max(0, view.roundIndex) % 4) + 1 });
  const left = Math.max(0, liveWallLeft(view));
  /** 持ち点（3 桁区切り） */
  const pointsOf = (seat: number) => <span className="points">{view.scores[seat].toLocaleString('en-US')}</span>;
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
  /** 最終得点の表示（千点＝1。小数は 1 桁まで） */
  const fmt = (n: number) => signed(Math.round(n * 10) / 10);
  const sticks = <span className="sticks">{t('honbaKyotaku', { h: view.honba, k: view.kyotaku })}</span>;
  const playing = view.phase !== 'ended';
  // 直前に切った人（その河の最後の牌に印を付ける）
  const lastDiscarder = view.phase === 'draw' ? (view.turn + 3) % 4 : view.phase === 'claim' && view.claim ? view.claim.from : -1;

  // 自分のフリテン（手牌が見えるのは自分だけなので、出すのも自分の分だけ）。局の途中だけ出す
  const furiten = view.phase === 'draw' || view.phase === 'discard' || view.phase === 'claim' ? furitenOf(view, HUMAN) : null;
  const furitenCauses = new Set(furiten?.causes ?? []);

  /** 横に曲げて置く河の位置：リーチの宣言牌。鳴かれて河から消えたら、次に切った牌を曲げる */
  const riichiShown = (seat: number) => {
    let at = view.riichiAt[seat];
    if (at === null) return null;
    while (view.calledAway[seat].includes(at)) at++;
    return at;
  };
  /** 河に見えている牌（鳴かれて持っていかれた牌は消す） */
  const riverTiles = (seat: number) =>
    view.discards[seat].map((id, i) => ({ id, i })).filter(({ i }) => !view.calledAway[seat].includes(i));

  /** 河の牌の印：直前に切られた牌・リーチの宣言牌（横に曲げる）・自分のフリテンの元になっている牌 */
  const riverClass = (seat: number, i: number) =>
    [
      seat === lastDiscarder && i === view.discards[seat].length - 1 ? 'last' : '',
      riichiShown(seat) === i ? 'riichi-tile' : '',
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
      {riverTiles(seat).map(({ id, i }) => (
        <Tile key={i} id={id} rules={view.rules} className={riverClass(seat, i)} />
      ))}
    </div>
  );
  /** 鳴いた面子の並び（最初に鳴いた面子を右端に置く＝実際の卓と同じ） */
  const meldsOf = (seat: number, className = '') =>
    view.melds[seat].length > 0 && (
      <span className={`melds ${className}`}>
        {view.melds[seat]
          .slice()
          .reverse()
          .map((m, i) => (
            <MeldView key={i} meld={m} seat={seat} rules={view.rules} />
          ))}
      </span>
    );

  // 狭い画面の自分の手牌の列の長さ（横幅いっぱいに収める）
  const narrowUnits = handRowUnits(view.hands[HUMAN].length, view.drawn[HUMAN] !== null, view.melds[HUMAN]);
  const hand = <MyHand view={view} legal={legal} lang={lang} onChoose={onChoose} melds={meldsOf(HUMAN)} />;

  // ドラ表示牌（めくられた順）
  const indicators = view.doraIndicators.length > 0 && (
    <span className="dora-ind">
      <span className="dora-ind-label">{t('doraIndicator')}</span>
      {view.doraIndicators.map((id) => (
        <Tile key={id} id={id} rules={view.rules} className="mini" />
      ))}
    </span>
  );

  // アガった人（ツモは 1 人・ロンは 1〜3 人）。手牌はアガリ牌を除いた形で並べ、アガリ牌を少し離して置く
  const r = view.result;
  const wins =
    r?.type === 'tsumo'
      ? [{ seat: r.seat, hand: view.hands[r.seat].filter((x) => x !== r.winTile), winTile: r.winTile, ura: r.ura, score: r.score, title: t('resultTsumo', { name: nameOf(r.seat) }) }]
      : r?.type === 'ron'
        ? r.wins.map((w) => ({ seat: w.seat, hand: view.hands[w.seat], winTile: r.winTile, ura: w.ura, score: w.score, title: t('resultRon', { name: nameOf(w.seat), from: nameOf(r.from) }) }))
        : [];
  // 局が終わったあと：次に起きること（オーラスでトップの親がやめるか選ぶ・次の局・対局の終わり）
  const step = view.phase === 'ended' ? nextStep(view) : null;
  const yameMine = legal.filter((a) => a.type === 'yame');
  const result = (view.phase === 'ended' || view.phase === 'gameover') && r && (
    <DraggableDialog className="result">
      {view.phase === 'gameover' && view.gameOver && (
        <>
          <p className="result-title game-over-title">{t('gameOverTitle')}</p>
          <p className="game-over-reason">{t(`gameEnd_${view.gameOver}` as MessageKey)}</p>
          {/* 順位と最終得点（素点・ウマ・オカの内訳） */}
          <table className="final-list">
            <thead>
              <tr>
                <th />
                <th />
                <th>{t('finalPoints')}</th>
                <th>{t('finalBase')}</th>
                <th>{t('finalUma')}</th>
                <th>{t('finalOka')}</th>
                <th>{t('finalTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {finalResult(view).map((row) => (
                <tr key={row.seat} className={`final-rank-${row.rank}`}>
                  <td>{t('finalRank', { n: row.rank })}</td>
                  <th>{nameOf(row.seat)}</th>
                  <td>{(row.points + row.kyotaku).toLocaleString('en-US')}</td>
                  <td>{fmt(row.base)}</td>
                  <td>{fmt(row.uma)}</td>
                  <td>{row.oka ? fmt(row.oka) : ''}</td>
                  <td className="final-total">{fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint no-money">{t('noMoney')}</p>
        </>
      )}
      {r.type === 'exhaust' && <p className="result-title">{t('resultExhaust')}</p>}
      {r.type === 'tripleRon' && <p className="result-title">{t('resultTripleRon')}</p>}
      {r.type === 'abort' && <p className="result-title">{t(`resultAbort_${r.reason}`, { name: r.seat === undefined ? '' : nameOf(r.seat) })}</p>}
      {r.type === 'abort' && r.reason === 'kyushu' && r.seat !== undefined && (
        <div className="result-hand">
          {sortTiles(view.hands[r.seat]).map((id) => (
            <Tile key={id} id={id} rules={view.rules} />
          ))}
        </div>
      )}
      {wins.map((won) => (
        <Fragment key={won.seat}>
          <p className="result-title">{won.title}</p>
          <div className="result-hand">
            {sortTiles(won.hand).map((id) => (
              <Tile key={id} id={id} rules={view.rules} />
            ))}
            <span className="drawn-gap" />
            <Tile id={won.winTile} rules={view.rules} className="win-tile" />
            {meldsOf(won.seat)}
          </div>
          {won.ura.length > 0 && (
            <span className="dora-ind">
              <span className="dora-ind-label">{t('uraIndicator')}</span>
              {won.ura.map((id) => (
                <Tile key={id} id={id} rules={view.rules} className="mini" />
              ))}
            </span>
          )}
          <ScoreView score={won.score} lang={lang} />
        </Fragment>
      ))}
      {r.type === 'exhaust' &&
        r.nagashi?.map((seat) => (
          <p key={seat} className="result-title">
            {t('resultNagashi', { name: nameOf(seat) })}
          </p>
        ))}
      {/* 点の動きと、動いたあとの持ち点（流局は下の表に出す） */}
      {r.type !== 'exhaust' && view.settlement && (
        <table className="points-list">
          <tbody>
            {[0, 1, 2, 3].map((rel) => {
              const seat = seatAt(rel);
              return (
                <tr key={rel}>
                  <th>
                    <b>{windOf(seat)}</b> {nameOf(seat)}
                  </th>
                  <td className="points-delta">{signed(view.settlement![seat])}</td>
                  <td className="points-after">{view.scores[seat].toLocaleString('en-US')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {r.type === 'exhaust' && (
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
                    <td className="exhaust-pay">{signed(pay)}</td>
                    <td className="points-after">{view.scores[seat].toLocaleString('en-US')}</td>
                  </tr>
                  {r.tenpai[seat] && (
                    <tr className="exhaust-hand-row">
                      <td colSpan={4}>
                        <div className="exhaust-hand">
                          {sortTiles(view.hands[seat]).map((id) => (
                            <Tile key={id} id={id} rules={view.rules} className="mini" />
                          ))}
                          {meldsOf(seat)}
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
      {view.phase === 'gameover' ? (
        <button type="button" className="btn-primary btn-new-game" onClick={onNewGame}>
          {t('newGame')}
        </button>
      ) : yameMine.length > 0 ? (
        <div className="yame-choice">
          <p className="hint">{t('yameHint')}</p>
          {yameMine.map((a, i) =>
            a.type === 'yame' ? (
              <button key={i} type="button" className={`btn-primary btn-yame-${a.stop ? 'stop' : 'go'}`} onClick={() => onChoose(a)}>
                {t(a.stop ? 'yameStop' : 'yameGo')}
              </button>
            ) : null,
          )}
        </div>
      ) : step?.type === 'yame' ? (
        <p className="hint">{t('yameWait', { name: nameOf(step.seat) })}</p>
      ) : (
        <button type="button" className="btn-primary btn-next" onClick={onNext}>
          {t(step?.type === 'end' ? 'gameOverTitle' : 'nextHand')}
        </button>
      )}
    </DraggableDialog>
  );

  if (narrow) {
    return (
      <div className="lanes-wrap felt" style={{ '--hand-units': narrowUnits } as CSSProperties}>
        <div className="lanes-info">
          <span className="round-label">{roundLabel}</span>
          <span className="wall-left">{t('wallLeft', { n: left })}</span>
          {sticks}
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
                  {pointsOf(seat)}
                  {riichiMark(seat)}
                  {seat !== HUMAN && (
                    <span className="lane-count">
                      <Tile id={HIDDEN} rules={view.rules} className="mini" />×{view.hands[seat].length}
                    </span>
                  )}
                  {seat !== HUMAN && meldsOf(seat, 'lane-melds')}
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
    const units = handRowUnits(view.hands[seat].length, seat === HUMAN && view.drawn[seat] !== null, view.melds[seat]);
    return handTileWidth(units, rel === 0 ? HAND_ROW.me : HAND_ROW.other);
  });
  const riverTw = riverTileWidth(handWidths);
  const cq = (n: number) => ({ '--tw': `${n.toFixed(2)}cqw` }) as CSSProperties;

  const squareRiver = (seat: number) => (
    <div className="river-rows">
      {riverRows(riverTiles(seat)).map((row, r) => (
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
          {sticks}
          {indicators}
          {[0, 1, 2, 3].map((rel) => {
            const seat = seatAt(rel);
            return (
              <span key={rel} className={`center-wind rel-${rel}${view.turn === seat && playing ? ' is-turn' : ''}`}>
                <b>{windOf(seat)}</b> {nameOf(seat)} {pointsOf(seat)}
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
            {meldsOf(seatAt(rel))}
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

/**
 * 鳴いた面子 1 組。鳴いた牌は横に曲げ、曲げる位置で誰から鳴いたかを示す（上家＝左・対面＝真ん中・下家＝右）。
 * 大明槓は 4 枚（下家からは右端）。加槓は鳴いた牌の隣に足した牌も曲げる。暗槓は両端を伏せる
 */
function MeldView({ meld, seat, rules }: { meld: OpenMeld; seat: number; rules: Rules | null }) {
  if (meld.type === 'ankan') {
    // 赤5があれば表に見える真ん中へ
    const tiles = meld.tiles.slice().sort((a, b) => Number(rules !== null && isRed(b, rules)) - Number(rules !== null && isRed(a, rules)));
    const shown = [HIDDEN, tiles[0], tiles[1], HIDDEN];
    return (
      <span className="meld meld-ankan">
        {shown.map((id, i) => (
          <Tile key={i} id={id} rules={rules} />
        ))}
      </span>
    );
  }
  const rel = (meld.from - seat + 4) % 4; // 1＝下家 2＝対面 3＝上家
  const turned = new Set([meld.called, meld.added].filter((x): x is TileId => x !== undefined && x !== null));
  const others = meld.tiles.filter((t) => !turned.has(t));
  const at = rel === 3 ? 0 : rel === 2 ? 1 : others.length;
  const order = [...others];
  order.splice(at, 0, ...turned);
  return (
    <span className={`meld meld-${meld.type}`}>
      {order.map((id) => (
        <Tile key={id} id={id} rules={rules} className={turned.has(id) ? 'called-tile' : ''} />
      ))}
    </span>
  );
}

/** 自分の手牌。マウスは 1 回押すと切る／指は 1 回目で浮かせ、2 回目で切る（押し間違いを防ぐ） */
function MyHand({ view, legal, lang, onChoose, melds }: { view: GameState; legal: Action[]; lang: Lang; onChoose: (a: Action) => void; melds: ReactNode }) {
  const [raised, setRaised] = useState<TileId | null>(null);
  // リーチを押したあと＝切る牌を選んでいるところ（もう一度押すとやめる）
  const [riichiPick, setRiichiPick] = useState(false);
  const myTurn = legal.length > 0;
  const drawn = view.drawn[HUMAN];
  const mine = view.hands[HUMAN];
  const rest = sortTiles(drawn === null ? mine : mine.filter((x) => x !== drawn));
  const canTsumo = legal.some((a) => a.type === 'tsumo');
  const canKyushu = legal.some((a) => a.type === 'kyushu');
  // 切られた牌でロン・チー・ポンできるときだけボタンを出す（できないときは自動で見送る）
  const canRon = legal.some((a) => a.type === 'ron');
  const calls = legal.filter((a) => a.type === 'chi' || a.type === 'pon' || (a.type === 'kan' && a.kan === 'minkan'));
  const replying = canRon || calls.length > 0;
  // 自分の番のカン（暗槓・加槓）。押すとその場でカンする
  const ownKans = legal.filter((a) => a.type === 'kan' && a.kan !== 'minkan');
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
        {canKyushu && (
          <>
            <button type="button" className="btn-primary btn-kyushu" onClick={() => onChoose({ type: 'kyushu' })}>
              {translate(lang, 'kyushu')}
            </button>
            <span className="hint">{translate(lang, 'kyushuHint')}</span>
          </>
        )}
        {replying && (
          <>
            {canRon && (
              <button type="button" className="btn-primary btn-ron" onClick={() => onChoose({ type: 'ron' })}>
                {translate(lang, 'ron')}
              </button>
            )}
            {/* チー・ポン・カンは手牌から出す牌を見せる（同じ牌で組み合わせが複数あるときも選べる） */}
            {calls.map((a, i) =>
              a.type === 'chi' || a.type === 'pon' || a.type === 'kan' ? (
                <button key={i} type="button" className={`btn-primary btn-call btn-${a.type}`} onClick={() => onChoose(a)}>
                  {translate(lang, a.type)}
                  <span className="call-tiles">
                    {sortTiles(a.tiles).map((id) => (
                      <Tile key={id} id={id} rules={view.rules} className="mini" />
                    ))}
                  </span>
                </button>
              ) : null,
            )}
            <button type="button" className="btn-primary btn-pass" onClick={() => onChoose({ type: 'pass' })}>
              {translate(lang, 'pass')}
            </button>
            <span className="hint">{translate(lang, canRon ? 'ronHint' : 'callHint')}</span>
          </>
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
        {ownKans.map((a, i) =>
          a.type === 'kan' ? (
            <button key={`kan${i}`} type="button" className="btn-primary btn-call btn-kan" onClick={() => onChoose(a)}>
              {translate(lang, 'kan')}
              <span className="call-tiles">
                <Tile id={a.tiles[0]} rules={view.rules} className="mini" />
              </span>
            </button>
          ) : null,
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
        {melds}
      </div>
    </div>
  );
}
