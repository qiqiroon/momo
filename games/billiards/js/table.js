/**
 * MOMO Billiards — 台定義データ
 * 仕様書 momo_billiards_spec.md 第3章（台形状仕様）
 *
 * 第1段階の実装対象は A-01 標準長方形の2バリエーション（ポケットあり／キャロム版）。
 * 3.7節のとおり「同一の物理エンジン＋台定義データ」という構造を採るため、
 * 形状ごとの分岐はこのファイルのデータだけで表す。エンジンは形状を知らない。
 *
 * 座標系（10.2.2節）
 *   長軸を X 軸・外接矩形の中心を原点・フット側を +X とする。単位は mm。
 *   A-01 は 2540 × 1270 mm なので X は ±1270、Y は ±635。
 *   基準スポットは (L/4, 0) = (635, 0)。現実の9フィート台のフットスポットと一致する。
 *
 * ポケットは6個（コーナー4＋サイド2）。3.4.2節 D363 による。
 *   3.5.1節の表には旧規定の「4個（四隅）」が残っているが、
 *   D363 を根拠に 3.4.2節を正とした（引継ぎ文書 3.3節「6ポケット化の波及」）。
 */
const BilliardsTable = (() => {
  'use strict';

  const R = 28.575;                 // 標準玉半径 mm（3.2.1節）
  const D = R * 2;                  // 標準玉直径 57.15 mm
  const MOUTH = 114.30;             // ポケット口径（3.4.1節）
  const PLAY_W = 2540.0;            // 長軸方向のプレイ面
  const PLAY_H = 1270.0;            // 短軸方向のプレイ面
  const HX = PLAY_W / 2, HY = PLAY_H / 2;
  const CUSHION_TOP = 63.5;         // クッション上端の高さ（5.3.4節）。玉の直径 57.15 より高い
  const CUSHION_W = 45;             // クッション上面の幅（描画と着地判定に使う）

  // ポケット口の開き。コーナーは2辺にまたがるため、サイドより広く取る。
  const GAP_CORNER = 66.0;
  const GAP_SIDE = MOUTH / 2;       // 57.15

  function seg(x1, y1, x2, y2) { return { x1, y1, x2, y2 }; }

  // ポケットあり版のクッション（ポケット口で途切れる）
  function railsPocket() {
    const m = GAP_CORNER, s = GAP_SIDE;
    return [
      // 長辺 y = +HY（上）／y = -HY（下）：サイドポケットで2本に割れる
      seg(-HX + m, HY, -s, HY), seg(s, HY, HX - m, HY),
      seg(-HX + m, -HY, -s, -HY), seg(s, -HY, HX - m, -HY),
      // 短辺 x = ±HX
      seg(HX, -HY + m, HX, HY - m),
      seg(-HX, -HY + m, -HX, HY - m),
    ];
  }

  // キャロム版（3.6節）：外形は同一、ポケットが無くクッションが連続する
  function railsCarom() {
    return [
      seg(-HX, HY, HX, HY),
      seg(-HX, -HY, HX, -HY),
      seg(HX, -HY, HX, HY),
      seg(-HX, -HY, -HX, HY),
    ];
  }

  function pockets() {
    return [
      { id: 'CL', x: -HX, y: -HY, r: 63 }, { id: 'CR', x: -HX, y: HY, r: 63 },
      { id: 'SL', x: 0, y: -HY, r: 58 }, { id: 'SR', x: 0, y: HY, r: 58 },
      { id: 'FL', x: HX, y: -HY, r: 63 }, { id: 'FR', x: HX, y: HY, r: 63 },
    ];
  }

  /**
   * 台定義データを1つ作る。
   * @param {boolean} hasPockets ポケットあり版なら true、キャロム版なら false
   */
  function make(hasPockets) {
    return {
      shape: 'A-01',
      name: 'A-01',
      hasPockets: !!hasPockets,
      halfW: HX, halfH: HY,
      ballR: R,
      rails: hasPockets ? railsPocket() : railsCarom(),
      pockets: hasPockets ? pockets() : [],
      cushionTop: CUSHION_TOP,
      cushionWidth: CUSHION_W,
      // 10.2.2節：長軸・フット側・基準スポット
      longAxis: 'x',
      footDirection: +1,
      spot: { x: PLAY_W / 4, y: 0 },        // (635, 0)
      headSpot: { x: -PLAY_W / 4, y: 0 },   // ヘッド側の対称点
      center: { x: 0, y: 0 },
      // 物性値（3.7節・5.3.4節）。通常モードでの台ごとの差は微差に留める
      cushionRestitution: 0.86,
      clothSlide: 0.20,     // 滑り摩擦係数
      clothRoll: 0.010,     // 転がり抵抗
      clothSpin: 0.011,     // 縦軸まわり（サイドスピン）の減衰
      clothRestitution: 0.45, // 着地時のバウンド（5.8.3節）
    };
  }

  /** ダイヤ形ラック（G-01 ナインボール）。1番を先頭・9番を中央（7.3.1節）。 */
  function rackDiamond(table, nums) {
    // 行構成 1-2-3-2-1。先頭をフットスポットに置き、フット側（+X）へ広げる。
    const gap = D + 0.15;                 // 玉どうしをわずかに離して初期めり込みを防ぐ
    const dx = gap * Math.sqrt(3) / 2;
    const rows = [1, 2, 3, 2, 1];
    const order = [nums[0], nums[1], nums[2], nums[3], nums[8], nums[4], nums[5], nums[6], nums[7]];
    // order: 先頭=1番、中央（3行目の真ん中）=9番。残りは番号順に詰める。
    const out = []; let k = 0;
    for (let r = 0; r < rows.length; r++) {
      const n = rows[r];
      for (let i = 0; i < n; i++) {
        out.push({
          num: order[k++],
          x: table.spot.x + dx * r,
          y: (i - (n - 1) / 2) * gap,
        });
      }
    }
    return out;
  }

  /** 三角ラック（G-02 エイトボール／G-03 ポケット・ローテーション）。 */
  function rackTriangle(table, nums, centerNum) {
    const gap = D + 0.15;
    const dx = gap * Math.sqrt(3) / 2;
    const cells = [];
    for (let r = 0; r < 5; r++) for (let i = 0; i <= r; i++) {
      cells.push({ x: table.spot.x + dx * r, y: (i - r / 2) * gap, row: r, idx: i });
    }
    // 中央（3行目の真ん中＝index 4）に centerNum を置く。それ以外は番号順。
    const centerCell = 4;
    const rest = nums.filter(n => n !== centerNum);
    const out = [];
    for (let c = 0; c < cells.length; c++) {
      const num = (c === centerCell) ? centerNum : rest.shift();
      out.push({ num, x: cells[c].x, y: cells[c].y });
    }
    return out;
  }

  /**
   * キャロム版の定位置（10.2.5節）。赤2個は共通の的球、手玉は人数分の色。
   * @param {number} players 参加人数（手玉の数）
   */
  function caromPositions(table, players) {
    const reds = [
      { key: 'red1', x: table.spot.x, y: 0 },
      { key: 'red2', x: 0, y: 0 },
    ];
    const cues = [];
    const span = 212;   // 手玉どうしの間隔
    const base = table.headSpot.x;
    for (let i = 0; i < players; i++) {
      const offset = (i - (players - 1) / 2) * span;
      cues.push({ key: 'cue' + i, x: base, y: offset });
    }
    return { reds, cues };
  }

  return {
    R, D, MOUTH, PLAY_W, PLAY_H, HX, HY, CUSHION_TOP,
    make, rackDiamond, rackTriangle, caromPositions,
  };
})();

if (typeof window !== 'undefined') window.BilliardsTable = BilliardsTable;
