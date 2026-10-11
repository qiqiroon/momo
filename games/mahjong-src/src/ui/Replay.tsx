// 牌譜の再生（段階4の 4）。出来事の列を対局と同じ apply で当てはめ直し、全員の手牌を表向きにした卓を出す。
// 1 手＝ツモ・打牌・鳴き・カン・アガリ・流局の宣言・途中流局・対局の終わり（返事の「見送る」やドラをめくるだけの出来事は、次の手に含める）。
// 局の頭＝配り終えたところ（最初のツモの直前）。

import { useEffect, useMemo, useState } from 'react';
import type { Envelope } from '../engine/events';
import { apply, initialState, type GameState } from '../engine/state';
import { translate, type Lang, type MessageKey } from '../i18n/strings';
import { Table } from './Table';

/** 自動再生の速さ（将棋の感想戦と同じ並び・押すたびに次へ） */
const SPEEDS = [1, 2, 0.5] as const;
/** 速さ 1× のときの 1 手の間 */
const AUTO_MS = 1000;

const STEP_TYPES = new Set(['draw', 'discard', 'call', 'kan', 'tsumo', 'ron', 'exhaust', 'declare', 'kyushu', 'yame', 'gameEnd']);

/** 1 手ごとの位置（出来事の列の何番目まで当てはめた局面か）と、局の頭の位置 */
export function replaySteps(events: readonly Envelope[]): { steps: number[]; handStarts: number[] } {
  const steps: number[] = [];
  const handStarts: number[] = [];
  let dealing = false;
  events.forEach((e, i) => {
    if (e.ev.type === 'roundStart') dealing = true;
    // 配り終えたところ＝次がその局の最初のツモ
    if (dealing && events[i + 1]?.ev.type === 'draw') {
      dealing = false;
      handStarts.push(steps.length);
      steps.push(i);
      return;
    }
    if (STEP_TYPES.has(e.ev.type)) {
      // 返事（見送る）が続くなら、それを含めたところで止める＝鳴き・ロンの結果まで見える
      let j = i;
      while (events[j + 1] && (events[j + 1].ev.type === 'pass' || events[j + 1].ev.type === 'doraReveal')) j++;
      if (steps[steps.length - 1] !== j) steps.push(j);
    }
  });
  if (steps.length === 0 || steps[steps.length - 1] !== events.length - 1) steps.push(events.length - 1);
  return { steps, handStarts };
}

interface Props {
  events: readonly Envelope[];
  narrow: boolean;
  lang: Lang;
  onExit: () => void;
}

export function Replay({ events, narrow, lang, onExit }: Props) {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  const { steps, handStarts } = useMemo(() => replaySteps(events), [events]);
  // 局面は手の位置ごとに作っておく（出来事は数千なので、前から順に当てはめて控える）
  const states = useMemo(() => {
    const out: GameState[] = [];
    let s = initialState();
    let k = 0;
    events.forEach((e, i) => {
      s = apply(s, e);
      while (k < steps.length && steps[k] === i) {
        out.push(s);
        k++;
      }
    });
    return out;
  }, [events, steps]);
  const [at, setAt] = useState(handStarts[0] ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const last = steps.length - 1;
  const clamp = (n: number) => Math.max(0, Math.min(last, n));
  /** 手で動かしたら自動再生は止める（将棋の感想戦と同じ） */
  const go = (n: number) => {
    setPlaying(false);
    setAt(clamp(n));
  };
  /** 今の位置から動く（続けて押しても押した回数だけ動く） */
  const move = (d: number) => {
    setPlaying(false);
    setAt((a) => clamp(a + d));
  };
  // 自動再生：速さに合わせて 1 手ずつ進み、最後で自分から止まる
  useEffect(() => {
    if (!playing) return;
    if (at >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setAt((a) => clamp(a + 1)), AUTO_MS / speed);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, at, speed, last]);
  const curHand = handStarts.filter((h) => h <= at).length - 1;
  const view = states[at];

  return (
    <div className="replay">
      <Table narrow={narrow} view={view} legal={[]} lang={lang} onChoose={() => {}} onNext={() => {}} onNewGame={() => {}} replay />
      {/* 再生の操作（将棋の感想戦にならう）：|◀ 前の局 ◀ 自動 速さ ▶ 次の局 ▶| ＋手の位置のつまみ */}
      <div className="playbar">
        <div className="btns">
          <button type="button" className="pb" title={t('replayStart')} aria-label={t('replayStart')} disabled={at === 0} onClick={() => go(0)}>
            |◀
          </button>
          <button type="button" className="pb" title={t('replayPrevHand')} aria-label={t('replayPrevHand')} disabled={curHand <= 0} onClick={() => go(handStarts[curHand - 1] ?? 0)}>
            ◀◀
          </button>
          <button type="button" className="pb" title={t('replayBack')} aria-label={t('replayBack')} disabled={at === 0} onClick={() => move(-1)}>
            ◀
          </button>
          <button
            type="button"
            className={`pb auto${playing ? ' playing' : ''}`}
            disabled={last <= 0}
            onClick={() => {
              if (playing) return setPlaying(false);
              // 最後から始めたら最初へ巻き戻す
              if (at >= last) setAt(0);
              setPlaying(true);
            }}
          >
            {playing ? `⏸ ${t('replayStop')}` : `▶ ${t('replayAuto')}`}
          </button>
          <button type="button" className="pb spd" title={t('replaySpeed')} aria-label={t('replaySpeed')} onClick={() => setSpeed((cur) => SPEEDS[(SPEEDS.indexOf(cur as 1) + 1) % SPEEDS.length])}>
            {speed === 0.5 ? '0.5×' : `${speed}×`}
          </button>
          <button type="button" className="pb" title={t('replayStep')} aria-label={t('replayStep')} disabled={at === last} onClick={() => move(1)}>
            ▶
          </button>
          <button type="button" className="pb" title={t('replayNextHand')} aria-label={t('replayNextHand')} disabled={curHand + 1 >= handStarts.length} onClick={() => go(handStarts[curHand + 1] ?? last)}>
            ▶▶
          </button>
          <button type="button" className="pb" title={t('replayEnd')} aria-label={t('replayEnd')} disabled={at === last} onClick={() => go(last)}>
            ▶|
          </button>
        </div>
        <div className="track">
          <input type="range" min={0} max={Math.max(last, 1)} value={at} disabled={last <= 0} aria-label={t('replayPos', { n: at + 1, total: steps.length })} onChange={(e) => go(Number(e.target.value))} />
          <span className="plycnt">{t('replayPos', { n: at + 1, total: steps.length })}</span>
          <button type="button" className="pb exit" onClick={onExit}>
            {t('replayExit')}
          </button>
        </div>
      </div>
    </div>
  );
}
