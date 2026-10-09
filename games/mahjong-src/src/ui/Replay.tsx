// 牌譜の再生（段階4の 4）。出来事の列を対局と同じ apply で当てはめ直し、全員の手牌を表向きにした卓を出す。
// 1 手＝ツモ・打牌・鳴き・カン・アガリ・流局の宣言・途中流局・対局の終わり（返事の「見送る」やドラをめくるだけの出来事は、次の手に含める）。
// 局の頭＝配り終えたところ（最初のツモの直前）。

import { useMemo, useState } from 'react';
import type { Envelope } from '../engine/events';
import { apply, initialState, type GameState } from '../engine/state';
import { translate, type Lang, type MessageKey } from '../i18n/strings';
import { Table } from './Table';

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
  const clamp = (n: number) => Math.max(0, Math.min(steps.length - 1, n));
  const go = (n: number) => setAt(clamp(n));
  /** 今の位置から動く（続けて押しても押した回数だけ動く） */
  const move = (d: number) => setAt((a) => clamp(a + d));
  const curHand = handStarts.filter((h) => h <= at).length - 1;
  const view = states[at];

  return (
    <div className="replay">
      <Table narrow={narrow} view={view} legal={[]} lang={lang} onChoose={() => {}} onNext={() => {}} onNewGame={() => {}} replay />
      <div className="replay-bar">
        <div className="replay-row">
          <button type="button" className="btn-primary" onClick={() => go(handStarts[curHand - 1] ?? 0)} disabled={curHand <= 0}>
            {t('replayPrevHand')}
          </button>
          <button type="button" className="btn-primary" onClick={() => go(handStarts[curHand + 1] ?? steps.length - 1)} disabled={curHand + 1 >= handStarts.length}>
            {t('replayNextHand')}
          </button>
          <span className="replay-pos">{t('replayPos', { n: at + 1, total: steps.length })}</span>
          <button type="button" className="btn-primary btn-replay-exit" onClick={onExit}>
            {t('replayExit')}
          </button>
        </div>
        <div className="replay-row">
          <button type="button" className="btn-primary" onClick={() => go(0)} disabled={at === 0}>
            {t('replayStart')}
          </button>
          <button type="button" className="btn-primary btn-replay-back" onClick={() => move(-1)} disabled={at === 0}>
            {t('replayBack')}
          </button>
          <button type="button" className="btn-primary btn-replay-step" onClick={() => move(1)} disabled={at === steps.length - 1}>
            {t('replayStep')}
          </button>
          <button type="button" className="btn-primary" onClick={() => go(steps.length - 1)} disabled={at === steps.length - 1}>
            {t('replayEnd')}
          </button>
        </div>
      </div>
    </div>
  );
}
