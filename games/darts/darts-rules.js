// MOMO Darts - ルールエンジン（SPEC 3章 / 10章）
// v1.87 (v1.3): 01 (6 持ち点 × 3 アウトルール) + カウントアップ対応にリファクタリング
//   - createInitialState(rule) で rule オプション受け取り
//   - rule = { type:'01'|'countup', startScore?, outRule?, rounds? }
//   - applyShot は rule.type で内部 dispatch
//   - scoreFromImpactSVG は引き続きルール非依存

// ======================================================================
// 標準ダーツボード（SPEC 3.5 / render との単一情報源）
// ======================================================================
export const R_BORDER       = 112;
export const R_NUMBERS      = 106;
export const R_DOUBLE_OUT   = 100;
export const R_DOUBLE_IN    = 95.3;
export const R_TRIPLE_OUT   = 62.9;
export const R_TRIPLE_IN    = 58.2;
export const R_OUTER_BULL   = 9.4;
export const R_INNER_BULL   = 3.7;

// 12時方向から時計回り
export const SEGMENT_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// ======================================================================
// スコア計算: SVG board-local 座標（中央=原点、Y下向き）→ スコア（ルール非依存）
// ======================================================================
export function scoreFromImpactSVG(impactSVG) {
  if (!impactSVG) return { value: 0, kind: 'MISS', segment: 0, label: 'MISS' };
  const r = Math.hypot(impactSVG.x, impactSVG.y);

  // 中央から外へ向かってリング判定
  if (r <= R_INNER_BULL) return { value: 50, kind: 'DBULL', segment: 50, label: 'BULL' };
  if (r <= R_OUTER_BULL) return { value: 25, kind: 'BULL',  segment: 25, label: '25' };
  if (r > R_DOUBLE_OUT)  return { value: 0,  kind: 'MISS',  segment: 0,  label: 'MISS' };

  // セグメント番号（時計位置）の判定
  let angle = Math.atan2(impactSVG.y, impactSVG.x) * 180 / Math.PI;
  let adj = angle + 90;
  if (adj < 0) adj += 360;
  if (adj >= 360) adj -= 360;
  let shifted = adj + 9;
  if (shifted >= 360) shifted -= 360;
  const segIdx = Math.floor(shifted / 18) % 20;
  const segNum = SEGMENT_NUMBERS[segIdx];

  let kind, mult;
  if (r <= R_TRIPLE_IN) {
    kind = 'S'; mult = 1;    // インナーシングル
  } else if (r <= R_TRIPLE_OUT) {
    kind = 'T'; mult = 3;    // トリプル
  } else if (r <= R_DOUBLE_IN) {
    kind = 'S'; mult = 1;    // アウターシングル
  } else {
    kind = 'D'; mult = 2;    // ダブル
  }

  return {
    value: segNum * mult,
    kind,
    segment: segNum,
    label: `${kind}${segNum}`,
  };
}

// ======================================================================
// ルール識別子のデフォルト（SPEC 3.2 v1.3）
// ======================================================================
export const DEFAULT_RULE = { type: '01', startScore: 501, outRule: 'single' };

export function isValidRule(rule) {
  if (!rule || typeof rule !== 'object') return false;
  if (rule.type === '01') {
    const validScores = [301, 501, 701, 901, 1101, 1501];
    const validOuts = ['single', 'double', 'master'];
    return validScores.includes(rule.startScore) && validOuts.includes(rule.outRule);
  }
  if (rule.type === 'countup') {
    return typeof rule.rounds === 'number' && rule.rounds > 0;
  }
  return false;
}

// ルール識別子から表示名を生成 (i18n は呼び出し側で行う)
export function ruleId(rule) {
  if (!rule) return 'unknown';
  if (rule.type === '01') return `01-${rule.startScore}-${rule.outRule}`;
  if (rule.type === 'countup') return `countup-${rule.rounds}`;
  return 'unknown';
}

// ======================================================================
// 初期状態（rule によって構造が変わる）
// ======================================================================
export function createInitialState(rule) {
  rule = isValidRule(rule) ? rule : DEFAULT_RULE;
  if (rule.type === '01') {
    return {
      rule,
      remaining: rule.startScore,
      turnStartRemaining: rule.startScore,
      turnShots: [],     // 現在のターンの shot 配列（最大3個）
      history: [],       // 完了したターンの配列
      dartCount: 0,
      turnIndex: 1,
      finished: false,
    };
  }
  // countup
  return {
    rule,
    total: 0,             // 累積得点
    turnShots: [],
    history: [],
    dartCount: 0,
    turnIndex: 1,
    finished: false,
  };
}

// ======================================================================
// applyShot（ルール別 dispatch）
//   戻り値: { state, turnEnded, finished, bust, hatTrick }
// ======================================================================
export function applyShot(state, shot) {
  if (state.finished) {
    return { state, turnEnded: false, finished: true, bust: false, hatTrick: false };
  }
  if (state.rule && state.rule.type === 'countup') {
    return applyShotCountup(state, shot);
  }
  return applyShot01(state, shot);
}

// ----- 01 系 (シングル/ダブル/マスター 共通) -----
function applyShot01(state, shot) {
  const outRule = (state.rule && state.rule.outRule) || 'single';
  const newRemaining = state.remaining - shot.value;

  // === FINISH (0 ぴったり、アウトルール違反は BUST) ===
  if (newRemaining === 0) {
    if (!isValidFinish(shot, outRule)) {
      return doBust01(state, shot);
    }
    return doFinish01(state, shot);
  }

  // === BUST (0 未満) ===
  if (newRemaining < 0) {
    return doBust01(state, shot);
  }

  // === 1 残し → ダブル/マスター時は即バースト（ダブル不可能） ===
  if (newRemaining === 1 && (outRule === 'double' || outRule === 'master')) {
    return doBust01(state, shot);
  }

  // === 通常進行 ===
  state.remaining = newRemaining;
  state.turnShots.push(shot);
  state.dartCount++;
  if (state.turnShots.length >= 3) {
    const lastShots = [...state.turnShots];
    state.history.push({
      shots: lastShots, bust: false, ended: 'normal',
    });
    state.turnShots = [];
    state.turnIndex++;
    state.turnStartRemaining = state.remaining;
    const hatTrick = lastShots.every((s) => s.kind === 'DBULL');
    return { state, turnEnded: true, finished: false, bust: false, hatTrick };
  }
  return { state, turnEnded: false, finished: false, bust: false, hatTrick: false };
}

// 最後の投擲がアウトルールに沿うか（SPEC 3.3）
function isValidFinish(shot, outRule) {
  if (outRule === 'single') return true;
  if (outRule === 'double') return shot.kind === 'D' || shot.kind === 'DBULL';
  if (outRule === 'master') return shot.kind === 'D' || shot.kind === 'T' || shot.kind === 'DBULL';
  return true;
}

function doFinish01(state, shot) {
  state.remaining = 0;
  state.turnShots.push(shot);
  state.dartCount++;
  state.history.push({
    shots: [...state.turnShots], bust: false, ended: 'finish',
  });
  state.turnShots = [];
  state.finished = true;
  return { state, turnEnded: true, finished: true, bust: false, hatTrick: false };
}

function doBust01(state, shot) {
  state.turnShots.push(shot);
  state.dartCount++;
  state.history.push({
    shots: [...state.turnShots], bust: true, ended: 'bust',
  });
  state.turnShots = [];
  state.remaining = state.turnStartRemaining;
  state.turnIndex++;
  return { state, turnEnded: true, finished: false, bust: true, hatTrick: false };
}

// ----- カウントアップ (SPEC 3.4) -----
//   バースト・フィニッシュなし、3 投で 1 ラウンド完了、rounds 達成で finished
function applyShotCountup(state, shot) {
  state.total += shot.value;
  state.turnShots.push(shot);
  state.dartCount++;

  if (state.turnShots.length >= 3) {
    const lastShots = [...state.turnShots];
    state.history.push({
      shots: lastShots, bust: false, ended: 'normal',
    });
    state.turnShots = [];
    state.turnIndex++;
    const hatTrick = lastShots.every((s) => s.kind === 'DBULL');
    const targetRounds = (state.rule && state.rule.rounds) || 8;
    if (state.history.length >= targetRounds) {
      state.finished = true;
      return { state, turnEnded: true, finished: true, bust: false, hatTrick };
    }
    return { state, turnEnded: true, finished: false, bust: false, hatTrick };
  }
  return { state, turnEnded: false, finished: false, bust: false, hatTrick: false };
}

// ======================================================================
// その他ユーティリティ
// ======================================================================

// 称号判定（1人プレイ完走時、SPEC 10.8 / 12.x）— 01 系のみ
//   カウントアップでは getAchievementCountup(total) を使う
export function getAchievement(dartCount) {
  if (dartCount <= 9)  return { rank: 'PERFECT', emoji: '🎯', label: '9 ダーツ ゲーム！パーフェクト！' };
  if (dartCount <= 15) return { rank: 'GREAT',   emoji: '⭐', label: 'GREAT!' };
  if (dartCount <= 24) return { rank: 'GOOD',    emoji: '✨', label: 'GOOD!' };
  return { rank: 'REGULAR', emoji: '🎯', label: 'FINISH!' };
}

// カウントアップ用の称号（総得点ベース、24 投時の理論最大は 24×60=1440、平均的に 300〜600 が普通）
export function getAchievementCountup(total) {
  if (total >= 900) return { rank: 'PERFECT',  emoji: '🎯', label: 'AMAZING!' };
  if (total >= 600) return { rank: 'GREAT',    emoji: '⭐', label: 'GREAT!' };
  if (total >= 400) return { rank: 'GOOD',     emoji: '✨', label: 'GOOD!' };
  return { rank: 'REGULAR', emoji: '🎯', label: 'COMPLETE!' };
}

// 現在のターンの合計得点
export function turnTotal(state) {
  return state.turnShots.reduce((a, s) => a + s.value, 0);
}

// 現在のスコア表示用値（UI が rule.type で分岐する代わりに使う）
//   01: remaining、countup: total
export function currentScore(state) {
  if (!state) return 0;
  if (state.rule && state.rule.type === 'countup') return state.total;
  return state.remaining;
}
