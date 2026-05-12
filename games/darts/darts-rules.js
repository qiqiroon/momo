// MOMO Darts - ルールエンジン（SPEC 3章 / 10章）
// 段階2-F: 501 シングルアウトの純粋ロジック
//   - board 定数 + scoreFromImpactSVG(): 着弾位置 → スコア
//   - applyShot(state, shot): 状態遷移
//   - バースト判定・FINISH 演出は段階2-C-C で追加予定

// ======================================================================
// 標準ダーツボード（SPEC 3.4 / render との単一情報源）
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
// スコア計算: SVG board-local 座標（中央=原点、Y下向き）→ スコア
// ======================================================================
export function scoreFromImpactSVG(impactSVG) {
  if (!impactSVG) return { value: 0, kind: 'MISS', segment: 0, label: 'MISS' };
  const r = Math.hypot(impactSVG.x, impactSVG.y);

  // 中央から外へ向かってリング判定
  if (r <= R_INNER_BULL) return { value: 50, kind: 'DBULL', segment: 50, label: 'BULL' };
  if (r <= R_OUTER_BULL) return { value: 25, kind: 'BULL',  segment: 25, label: '25' };
  if (r > R_DOUBLE_OUT)  return { value: 0,  kind: 'MISS',  segment: 0,  label: 'MISS' };

  // セグメント番号（時計位置）の判定
  // SVG: atan2(y, x) で右=0°、下=90°、左=±180°、上=-90°
  // render は center = -90 + i*18 で配置 → 上 (i=0) = -90°、右 (i=5) = 0°
  let angle = Math.atan2(impactSVG.y, impactSVG.x) * 180 / Math.PI;
  // 上を 0 に
  let adj = angle + 90;
  if (adj < 0) adj += 360;
  if (adj >= 360) adj -= 360;
  // セグメント中心が i*18 になるよう +9 シフトしてから 18 で割る
  let shifted = adj + 9;
  if (shifted >= 360) shifted -= 360;
  const segIdx = Math.floor(shifted / 18) % 20;
  const segNum = SEGMENT_NUMBERS[segIdx];

  // リング判定（ボード本体は 4 リング）
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
// 501 シングルアウト 状態管理
// ======================================================================
export function createInitialState() {
  return {
    rule: '501-single-out',
    remaining: 501,
    turnStartRemaining: 501,
    turnShots: [],     // 現在のターンの shot 配列（最大3個）
    history: [],       // 完了したターンの配列
    dartCount: 0,
    turnIndex: 1,
    finished: false,
  };
}

// state を更新（in-place）、戻り値で結果も返す
//   shot: scoreFromImpactSVG の結果
//   戻り値: { state, turnEnded, finished, bust }
export function applyShot(state, shot) {
  if (state.finished) {
    return { state, turnEnded: false, finished: true, bust: false };
  }
  const newRemaining = state.remaining - shot.value;

  // FINISH チェック（段階2-F では仮実装、段階2-F-C で FINISH 演出を追加）
  if (newRemaining === 0) {
    state.remaining = 0;
    state.turnShots.push(shot);
    state.dartCount++;
    const finishedTurn = { shots: [...state.turnShots], bust: false, ended: 'finish' };
    state.history.push(finishedTurn);
    state.turnShots = [];
    state.finished = true;
    return { state, turnEnded: true, finished: true, bust: false };
  }

  // バースト判定（段階2-F では未実装、段階2-F-C で追加予定）
  // 現状: 負になっても残点は更新せず、ターン継続
  if (newRemaining < 0) {
    // とりあえずスコアは記録するが remaining は据え置き
    state.turnShots.push(shot);
    state.dartCount++;
    if (state.turnShots.length >= 3) {
      const endedTurn = { shots: [...state.turnShots], bust: false, ended: 'normal-overflow' };
      state.history.push(endedTurn);
      state.turnShots = [];
      state.turnIndex++;
      state.turnStartRemaining = state.remaining;
      return { state, turnEnded: true, finished: false, bust: false };
    }
    return { state, turnEnded: false, finished: false, bust: false };
  }

  // 通常: 残点を減らす
  state.remaining = newRemaining;
  state.turnShots.push(shot);
  state.dartCount++;
  if (state.turnShots.length >= 3) {
    const endedTurn = { shots: [...state.turnShots], bust: false, ended: 'normal' };
    state.history.push(endedTurn);
    state.turnShots = [];
    state.turnIndex++;
    state.turnStartRemaining = state.remaining;
    return { state, turnEnded: true, finished: false, bust: false };
  }
  return { state, turnEnded: false, finished: false, bust: false };
}

// 現在のターンの合計得点
export function turnTotal(state) {
  return state.turnShots.reduce((a, s) => a + s.value, 0);
}
