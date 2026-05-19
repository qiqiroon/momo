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
    const validIns  = ['normal', 'doubleIn'];
    // inRule は省略可（省略時 = 'normal'）
    const inOk = (rule.inRule === undefined) || validIns.includes(rule.inRule);
    return validScores.includes(rule.startScore) && validOuts.includes(rule.outRule) && inOk;
  }
  if (rule.type === 'countup') {
    const validRounds = [4, 8, 12];
    return validRounds.includes(rule.rounds);
  }
  // v1.5: ラウンド・ザ・クロック
  if (rule.type === 'rtc') {
    return true;  // 追加オプションなし
  }
  // v1.5: スタンダードクリケット
  if (rule.type === 'cricket') {
    return true;  // 追加オプションなし
  }
  return false;
}

// ルール識別子から表示名を生成 (i18n は呼び出し側で行う)
export function ruleId(rule) {
  if (!rule) return 'unknown';
  if (rule.type === '01') return `01-${rule.startScore}-${rule.outRule}`;
  if (rule.type === 'countup') return `countup-${rule.rounds}`;
  if (rule.type === 'rtc') return 'rtc';
  if (rule.type === 'cricket') return 'cricket';
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
      // v1.94 (v1.4): ダブルインで開始した場合 false、最初の D/DBULL 投擲で true
      started: (rule.inRule !== 'doubleIn'),
      turnShots: [],     // 現在のターンの shot 配列（最大3個）
      history: [],       // 完了したターンの配列
      dartCount: 0,
      turnIndex: 1,
      finished: false,
    };
  }
  // v1.5: ラウンド・ザ・クロック
  if (rule.type === 'rtc') {
    return {
      rule,
      nextTarget: 1,
      cleared: [],
      turnShots: [],
      history: [],
      dartCount: 0,
      turnIndex: 1,
      finished: false,
    };
  }
  // v1.5: スタンダードクリケット (対戦のみ、両プレイヤー分の state を別途持つ)
  if (rule.type === 'cricket') {
    return {
      rule,
      marks: { 15:0, 16:0, 17:0, 18:0, 19:0, 20:0, bull:0 },  // 自分の mark
      score: 0,                                                // 自分の累積得点
      turnShots: [],
      history: [],
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
  const t = state.rule && state.rule.type;
  if (t === 'countup') return applyShotCountup(state, shot);
  if (t === 'rtc')     return applyShotRtc(state, shot);
  if (t === 'cricket') return applyShotCricket(state, shot);
  return applyShot01(state, shot);
}

// ----- 01 系 (シングル/ダブル/マスター 共通) -----
function applyShot01(state, shot) {
  const outRule = (state.rule && state.rule.outRule) || 'single';
  const inRule  = (state.rule && state.rule.inRule)  || 'normal';

  // v1.94 (v1.4): ダブルイン — 最初の有効投擲が D/DBULL でないと得点開始しない
  //   未開始時の投擲は得点 0 として記録し、ターン終了は通常通り進行
  if (inRule === 'doubleIn' && !state.started) {
    const isDoubleHit = (shot.kind === 'D' || shot.kind === 'DBULL');
    if (!isDoubleHit) {
      const zeroShot = { ...shot, value: 0 };
      state.turnShots.push(zeroShot);
      state.dartCount++;
      if (state.turnShots.length >= 3) {
        const lastShots = [...state.turnShots];
        state.history.push({ shots: lastShots, bust: false, ended: 'normal' });
        state.turnShots = [];
        state.turnIndex++;
        return { state, turnEnded: true, finished: false, bust: false, hatTrick: false };
      }
      return { state, turnEnded: false, finished: false, bust: false, hatTrick: false };
    }
    // D/DBULL を当てた → 得点開始
    state.started = true;
  }

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

// ----- ラウンド・ザ・クロック (SPEC 3.6) -----
//   1→20 を順番に当てる。S/D/T どれでも OK
//   20 をクリアした投擲で finished=true
function applyShotRtc(state, shot) {
  let advanced = false;
  // shot.segment が現在の nextTarget なら進める (S/D/T いずれでも OK、MISS は不可)
  if ((shot.kind === 'S' || shot.kind === 'D' || shot.kind === 'T')
      && shot.segment === state.nextTarget) {
    state.cleared.push(state.nextTarget);
    state.nextTarget++;
    advanced = true;
  }
  state.turnShots.push(shot);
  state.dartCount++;

  // 20 まで全部クリアで finished
  if (state.nextTarget > 20) {
    const lastShots = [...state.turnShots];
    state.history.push({ shots: lastShots, bust: false, ended: 'finish' });
    state.turnShots = [];
    state.finished = true;
    return { state, turnEnded: true, finished: true, bust: false, hatTrick: false };
  }

  if (state.turnShots.length >= 3) {
    const lastShots = [...state.turnShots];
    state.history.push({ shots: lastShots, bust: false, ended: 'normal' });
    state.turnShots = [];
    state.turnIndex++;
    return { state, turnEnded: true, finished: false, bust: false, hatTrick: false };
  }
  return { state, turnEnded: false, finished: false, bust: false, hatTrick: false };
}

// ----- スタンダードクリケット (SPEC 3.7) -----
//   15-20 + bull を 3 mark でクローズ
//   クローズ済 + 相手未クローズなら得点
//   ※ 対戦時の「相手」は呼び出し側 (darts-app.js) が _oppState の marks を見て判定する必要があるため、
//      ここでは「自分の mark/score 更新」のみ行い、得点判定は呼び出し側で行う
//      → opts.oppMarks を渡すことで判定可能にする
function applyShotCricket(state, shot, opts) {
  const oppMarks = (opts && opts.oppMarks) || {};
  // 対象セグメント判定
  let segKey = null;
  let markCount = 0;
  if (shot.kind === 'DBULL')       { segKey = 'bull'; markCount = 2; }
  else if (shot.kind === 'BULL')   { segKey = 'bull'; markCount = 1; }
  else if (shot.segment >= 15 && shot.segment <= 20) {
    segKey = shot.segment;
    markCount = (shot.kind === 'T') ? 3 : (shot.kind === 'D') ? 2 : 1;
  }

  if (segKey !== null) {
    const before = state.marks[segKey] || 0;
    const closeRemain = Math.max(0, 3 - before);
    const used = Math.min(markCount, closeRemain);
    state.marks[segKey] = before + used;
    const excess = markCount - used;

    // 余り mark を得点に (相手が未クローズの場合のみ)
    if (excess > 0 && (oppMarks[segKey] || 0) < 3) {
      const segValue = (segKey === 'bull')
        ? 25  // 1 mark あたり 25 点(BULL)、DBULL hit で markCount=2 = 50 点扱い
        : segKey;
      state.score += segValue * excess;
    }
  }
  state.turnShots.push(shot);
  state.dartCount++;

  // 終了判定: 自分が全 7 セグメントクローズ かつ 得点 ≧ 相手の得点
  //   呼び出し側で _gameState.allClosed && _gameState.score >= _oppState.score を判定
  //   ここでは finished フラグは立てない (呼び出し側が判定)
  if (state.turnShots.length >= 3) {
    const lastShots = [...state.turnShots];
    state.history.push({ shots: lastShots, bust: false, ended: 'normal' });
    state.turnShots = [];
    state.turnIndex++;
    return { state, turnEnded: true, finished: false, bust: false, hatTrick: false };
  }
  return { state, turnEnded: false, finished: false, bust: false, hatTrick: false };
}

// クリケット用ヘルパー: 全クローズ判定
export function cricketAllClosed(state) {
  if (!state || !state.marks) return false;
  return [15,16,17,18,19,20,'bull'].every(k => (state.marks[k] || 0) >= 3);
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
//   01: remaining、countup: total、rtc: nextTarget、cricket: score
export function currentScore(state) {
  if (!state) return 0;
  const t = state.rule && state.rule.type;
  if (t === 'countup') return state.total;
  if (t === 'rtc')     return state.nextTarget;
  if (t === 'cricket') return state.score;
  return state.remaining;
}
