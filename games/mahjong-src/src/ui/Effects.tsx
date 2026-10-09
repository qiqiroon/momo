// 対局の演出の表示（訂正26100917）。花札のこいこいの演出（.koikoi-slide／.koikoi-flash）と勝ちのくす玉にならう。
// - リーチ：その人の手牌の高さで「リーチ」が左から右へ流れ、流れ終わったら中央に大きく出る
// - そのほか（ロン・ツモ・振り込み・勝利・対局終了）：中央に出る
// - 勝利：くす玉と紙吹雪（絵は花札の kusudama.png をそのまま指す＝同じ絵を 2 つ持たない）

import { useEffect, useState } from 'react';
import type { Banner } from '../audio/useGameEffects';
import { HUMAN } from '../game/useTable';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey) => string;

const TEXT: Record<Banner['kind'], MessageKey> = {
  riichi: 'riichi',
  ron: 'flashRon',
  tsumo: 'flashTsumo',
  dealIn: 'flashDealIn',
  win: 'flashWin',
  lose: 'flashLose',
};

/** 自分から見た位置（0＝自分・1＝下家・2＝対面・3＝上家） */
const relOf = (seat: number) => (seat - HUMAN + 4) % 4;

/** リーチした人の手牌の縦の真ん中（見つからなければ画面の真ん中） */
function handMiddle(seat: number): number {
  const rel = relOf(seat);
  const el =
    rel === 0
      ? document.querySelector('.my-hand')
      : (document.querySelector(`.seat-hand.rel-${rel}`) ?? document.querySelectorAll('.lanes .lane')[rel - 1] ?? null);
  const r = el?.getBoundingClientRect();
  return r ? r.top + r.height / 2 : window.innerHeight / 2;
}

const CONFETTI = ['#d8a838', '#ea580c', '#cf2b28', '#33aa99', '#5599ff', '#fff'];

export function Effects({ t, banner, kusudama }: { t: T; banner: Banner | null; kusudama: boolean }) {
  // リーチは「流れる」→「中央」の 2 段。ほかは中央だけ
  const [stage, setStage] = useState<'slide' | 'flash' | null>(null);
  const [top, setTop] = useState(0);
  useEffect(() => {
    if (!banner) return setStage(null);
    if (banner.kind === 'riichi' && banner.seat !== undefined) {
      setTop(handMiddle(banner.seat));
      setStage('slide');
      const a = window.setTimeout(() => setStage('flash'), 1000);
      const b = window.setTimeout(() => setStage(null), 2600);
      return () => (clearTimeout(a), clearTimeout(b));
    }
    setStage('flash');
    const id = window.setTimeout(() => setStage(null), 1800);
    return () => clearTimeout(id);
  }, [banner]);

  return (
    <>
      {banner && stage === 'slide' && (
        <div key={`s${banner.key}`} className="fx-slide" style={{ top }}>
          {t(TEXT[banner.kind])}
        </div>
      )}
      {banner && stage === 'flash' && (
        <div key={`f${banner.key}`} className={`fx-flash fx-${banner.kind}`}>
          {t(TEXT[banner.kind])}
        </div>
      )}
      {kusudama && (
        <div className="fx-kusudama" aria-hidden="true">
          <div className="fx-kusudama-art" />
          <div className="fx-confetti">
            {Array.from({ length: 64 }, (_, i) => (
              <span
                key={i}
                style={{
                  left: `${(i * 37) % 100}%`,
                  background: CONFETTI[i % CONFETTI.length],
                  animationDuration: `${1.9 + (i % 6) * 0.28}s`,
                  animationDelay: `${0.65 + (i % 12) * 0.11}s`,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
