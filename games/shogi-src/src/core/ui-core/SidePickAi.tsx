/**
 * 対 AI 対局の先後選択 (Phase 3-1 追補)。
 *
 * **ネット対戦の部屋 (S05) にある先後選択をそのまま持ってきたもの**
 * (ユーザー指示 2026-08-15)。カード 3 枚 (先手／後手／おまかせ)・振り駒の枠・
 * その下の状態メッセージまで、見た目と文言は部屋側と同じものを使う。
 * スタイルも共通の `.side-pick` / `.side-card` / `.furigoma` をそのまま使う。
 *
 * 部屋との違いは 1 つだけ:**相手が AI なので、乱数の公平性の手続きが要らない**。
 * 人どうしの振り駒は「先に決めた値を隠して見せ合う」やり方で、どちらも結果を
 * ごまかせないようにしている。相手が AI ならごまかす相手がいないので、
 * その場で 5 枚を振るだけにした。表 (歩) が 3 枚以上ならあなたが先手
 * (付録 D-5 §4.2 の決め方と同じ)。
 */

import { useEffect, useRef, useState } from 'react';

export type AiSideChoice = 'sente' | 'gote' | 'random';

/** 振り駒 1 回ぶんの結果。 */
export interface FurigomaDraw {
  /** 5 枚それぞれの表裏 (true = 表＝歩)。 */
  faceUps: boolean[];
  /** あなたが先手か。表が 3 枚以上で true (5 枚なので同数は起きない)。 */
  youAreSente: boolean;
}

export function drawFurigoma(random: () => number = Math.random): FurigomaDraw {
  const faceUps = Array.from({ length: 5 }, () => random() < 0.5);
  const faceUpCount = faceUps.filter((x) => x).length;
  return { faceUps, youAreSente: faceUpCount >= 3 };
}

interface SidePickAiProps {
  t: (key: string) => string;
  choice: AiSideChoice | null;
  onChoice: (choice: AiSideChoice) => void;
  /** 振り駒の結果 (おまかせのときだけ)。未決着なら null。 */
  draw: FurigomaDraw | null;
  /** 振り駒アニメ中か。 */
  spinning: boolean;
  /** 効果音など、押したときに親でやりたいこと。 */
  onBeforeChoice?: () => void;
}

export function SidePickAi({ t, choice, onChoice, draw, spinning, onBeforeChoice }: SidePickAiProps) {
  const pick = (c: AiSideChoice) => {
    onBeforeChoice?.();
    onChoice(c);
  };

  const showFurigoma = choice === 'random';

  // 振り駒の結果テキスト (部屋側と同じ文言を使う。相手＝AI なので「相手が先手！」でよい)
  const resultText = (() => {
    if (!draw) return '';
    const faceUpCount = draw.faceUps.filter((x) => x).length;
    const faceDownCount = draw.faceUps.length - faceUpCount;
    if (draw.youAreSente) return t('s06.frFaceUpYou').replace('{n}', String(faceUpCount));
    return t('s06.frFaceDownOpp').replace('{n}', String(faceDownCount));
  })();

  // 状態メッセージ (部屋側の 5 段階のうち、対 AI で起こりうる 3 段階だけ)
  const message: { text: string; kind: 'prompt' | 'rolling' | 'resolved' } = (() => {
    if (choice === null) return { text: t('s06.sidePromptChoose'), kind: 'prompt' };
    if (choice === 'sente') return { text: t('s06.sideYouSente'), kind: 'resolved' };
    if (choice === 'gote') return { text: t('s06.sideYouGote'), kind: 'resolved' };
    if (spinning || !draw) return { text: t('s06.frRolling'), kind: 'rolling' };
    return { text: draw.youAreSente ? t('s06.sideYouSente') : t('s06.sideYouGote'), kind: 'resolved' };
  })();

  return (
    <>
      <div className="section-label">{t('s06.lblSide')}</div>
      <div className="side-pick">
        <SideCard
          label={t('s06.sideNameS')}
          desc={t('s06.sideDescS')}
          glyph="先"
          mine={choice === 'sente'}
          mineText={t('s06.mineLabel')}
          onClick={() => pick('sente')}
        />
        <SideCard
          label={t('s06.sideNameG')}
          desc={t('s06.sideDescG')}
          glyph="後"
          mine={choice === 'gote'}
          mineText={t('s06.mineLabel')}
          onClick={() => pick('gote')}
        />
        <SideCard
          label={t('s06.sideNameR')}
          desc={t('s06.sideDescR')}
          glyph="？"
          mine={choice === 'random'}
          mineText={t('s06.mineLabel')}
          onClick={() => pick('random')}
        />
      </div>

      {/* 振り駒アニメ（おまかせのときだけ表示） */}
      <div className={`furigoma${showFurigoma ? ' show' : ''}`}>
        <div className="fg-row">
          {Array.from({ length: 5 }).map((_, i) => {
            const finalFaceUp = draw ? draw.faceUps[i] : true;
            const inlineStyle = !spinning && draw && !finalFaceUp ? { transform: 'rotateX(180deg)' } : undefined;
            return (
              <div key={i} className={`fg-piece${spinning ? ' spin' : ''}`}>
                <div className="fg-inner" style={inlineStyle}>
                  <div className="fg-face">
                    <span>歩</span>
                  </div>
                  <div className="fg-face back">
                    <span>と</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={`fg-result${draw && !spinning ? ' win' : ''}`}>
          {spinning || !draw ? t('s06.frRolling') : resultText}
        </div>
      </div>

      {message.kind === 'prompt' ? (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--orange-light)',
            border: '1px solid var(--orange)',
            borderRadius: 8,
            background: 'var(--bg-selected)',
          }}
        >
          {message.text}
        </div>
      ) : message.kind === 'rolling' ? (
        <div style={{ marginTop: 10, padding: '8px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {message.text}
        </div>
      ) : (
        <div style={{ marginTop: 10, padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {message.text}
        </div>
      )}
    </>
  );
}

/**
 * 部屋側の SideCard をそのまま持ってきたもの。相手の選択を示す印は、
 * 相手が AI で「相手も選ぶ」という場面が無いので落としてある。
 */
function SideCard({
  label,
  desc,
  glyph,
  mine,
  mineText,
  onClick,
}: {
  label: string;
  desc: string;
  glyph: string;
  mine: boolean;
  mineText: string;
  onClick: () => void;
}) {
  const cls = ['side-card'];
  if (mine) cls.push('on', 'mine');
  return (
    <button type="button" className={cls.join(' ')} onClick={onClick}>
      <div className="side-glyph">
        <span>{glyph}</span>
      </div>
      <div className="sc-name">{label}</div>
      <div className="sc-desc">{desc}</div>
      <span className="sc-label mine">{mineText}</span>
      <span className="sc-mine">
        <svg viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    </button>
  );
}

/**
 * おまかせを押したときに振り駒を回す。押し直すと振り直す (付録 D-5 §4.2)。
 * 回っている最中の押し直しは受け付けない (連打で結果が飛ぶのを防ぐ)。
 */
export function useFurigoma(choice: AiSideChoice | null): {
  draw: FurigomaDraw | null;
  spinning: boolean;
  roll: () => void;
} {
  const [draw, setDraw] = useState<FurigomaDraw | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // おまかせ以外を選んだら振り駒の結果は捨てる (部屋側と同じ)
  useEffect(() => {
    if (choice !== 'random') {
      setDraw(null);
      setSpinning(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [choice]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const roll = () => {
    if (spinning) return;
    const result = drawFurigoma();
    setDraw(result);
    setSpinning(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSpinning(false), 1000);
  };

  return { draw, spinning, roll };
}
