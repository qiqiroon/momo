/**
 * MOMO Billiards — 盤面イベント層（仕様書 5.3.1節・第6章）
 *
 * 第5章5.3.2節は「通常モードとは、変則モード層と盤面イベント層が
 * 何もしない状態のことである」と定めている。したがってモードの違いは
 * **分岐ではなく、この層が働くか働かないか**で表す。
 * app.js や rules.js に「異常モードなら〜」と書き始めたら、その設計は崩れている。
 *
 * ★engine.js はギミックの名前を1つも知らない。
 *   台の形と同じで、engine の中に形状名やギミック名の分岐を書き始めたら
 *   設計が壊れかけている合図（このフォルダの案内書 §5）。
 *   engine が呼ぶのは apply() ひとつだけで、中身は全部こちらが持つ。
 *
 * ★抽選は必ず共有シードの乱数（game.rng）から引き、玉が転がっている最中には引かない。
 *   転がりの途中で引くと、AIの読み・リプレイ・観戦の追いつきが同じ乱数列を消費できず、
 *   決定論（5.2節）が壊れる。引くのは「ゲーム開始時・ターン開始時・ショット開始時」の3か所だけ。
 */
const BilliardsField = (() => {
  'use strict';

  /*
   * 採用ギミック8種（6.5.2節）。door は盤面イベント層の3つの入口（6.10.1節）。
   *   force   … 外力の注入
   *   state   … 状態の書き換え
   *   terrain … 可変地形の設置
   */
  const ALL = [
    { id: 'F-01', door: 'force' },     // 地震
    { id: 'F-03', door: 'force' },     // 台の傾き
    { id: 'F-05', door: 'force' },     // ブラックホール
    { id: 'F-06', door: 'force' },     // 突風
    { id: 'F-07', door: 'terrain' },   // 水たまり
    { id: 'F-08', door: 'terrain' },   // 氷の領域
    { id: 'F-11', door: 'state' },     // 番号シャッフル
    { id: 'B-08', door: 'state' },     // テレポートポケット
  ];
  const ALL_IDS = ALL.map(g => g.id);
  const DOOR = {}; ALL.forEach(g => { DOOR[g.id] = g.door; });

  /*
   * ★**実装が済んだギミックだけをここに並べる。**
   *   選択画面のグレーはこの一覧から決まる。仕様書 11.2.3節の「段階の割り当て」（app.js の STAGE）は
   *   *どの段階でやる予定か* を書いた表であって、*もう入っているか* ではない。
   *   段階の表を見てグレーを決めると、ギミックを1つ足すたびに2か所を直すことになり、
   *   片方を書き忘れれば「入っているのに選べない」か「無いのに選べる」になる。
   *   ルール（RULE_IDS）・台形状（SHAPE_IDS）と同じ形にしてある。
   */
  const IDS = ['F-01', 'F-03', 'F-07', 'F-08'];

  /** 同時に選べる数の上限（6.5.1節）。既定は3種で確定値。apocalypse だけ引き上げる（付録B.2節送り） */
  const PICK_MAX = 3;
  const PICK_MAX_APOCALYPSE = 5;        // 暫定。付録B.2節で詰める

  /*
   * ───────── 地震（F-01）─────────
   *
   * やることは1つだけ＝**転がっている玉へ、揺れの向きの行ったり来たりする加速度を足す**（6.6.2節）。
   * 向きも位相も**全球で共通**なので、盤面全体が同じ瞬間に同じ側へ押される。
   *
   * ★**静止球には足さない／空中の玉にも足さない。**傾きとまったく同じ条件である（6.2.3節・D192）。
   *   「揺れているのに止まっている玉がある」のは非現実だが、ターンが終わることのほうを取る。
   *
   * ★**傾きのときの心配（強くすると玉が止まらない）は、地震には当てはまらない。**
   *   傾きは向きが一定なので氷の上で加速し続けたが、**地震は半周期ごとに押し返す。**
   *   実測（第57セッション・氷が台の3分の1）でも、安全弁が働いた割合は地震なしと変わらなかった
   *   （氷だけ 2/116 ⇔ 氷＋地震 0/95）。**だから強さは効き目だけで決めてよい。**
   */
  const QUAKE = {
    /*
     * 揺れの加速度の山 mm/s^2（付録B送り）。1500 は実測＝止まる場所が 208mm（玉3.6個ぶん）動く。
     * 利用者判断（第57セッション）＝「傾きと同じくらい」。
     *
     * ★**効き目を決めるのは 振幅 ÷ 振動数 だけ**である（実測：振幅800の1Hz＝268mm と
     *   振幅1600の2Hz＝284mm がほぼ同じ）。**振動数を動かすときは振幅も一緒に動かす。**
     */
    amp: 1500,
    /*
     * 振動数 Hz（付録B送り）。★物理には効かない（上を見よ）ので、**見た目で決めた値**。
     * 1Hz は「1回押された」に見え、4Hz は細かすぎて震えに見える。2Hz が「ゆすられている」に見える。
     */
    freq: 2,
    /*
     * 揺れの弱まり方（付録B送り）＝この秒数で e分の1になる。利用者判断＝「2秒ほどで収まる」。
     * ★弱めない（ずっと同じ強さで揺れる）と、**画面が7〜10秒揺れ続ける**ことになる。
     *   氷と重ねたときも、弱めないほうだけ安全弁が働く局が増えた（5/86 ⇔ 弱めれば 0/95）。
     */
    decay: 2,
    /*
     * ★**常時の揺れの強さ**（撞いた瞬間に対する割合）。利用者判断・第57セッション。
     *
     *   地震は**撞いた瞬間だけの出来事ではなく、鳴り続けている状況**である。
     *   ゼロまで弱まらず、この割合で揺れ続ける。撞くと山まで跳ね上がり、
     *   decay 秒かけてここへ戻る。
     * ★**狙っている最中も揺れる**のはこの値があるからで、
     *   3Dの構え画面が揺れるのも同じ理由（3Dは構える段でしか描かれない）。
     * ★**この揺れは玉にも効く。**見えているのに効かない揺れを作らない。
     * ★**0.25 では「普段の揺れが不自然」だった**（利用者指摘）。ずっと同じ強さで
     *   きっちり揺れ続けるので、地震というより機械の振動に見える。**5分の1にした上で、
     *   下の wander でゆっくり増減させる。**
     */
    ambient: 0.05,
    /*
     * ★**常時の揺れは一定にしない**（利用者指示・第57セッション）。
     *   ambient を中心に**この割合だけ上下へ、ゆっくり**行き来する（0.5＝±50%）。
     * ★**0 にはしない。**「静止はせず」が指示なので、下限は ambient の半分で止まる。
     */
    wander: 0.5,
    /*
     * 揺らぎの遅さ（秒）。★**互いに割り切れない2つの周期を重ねる。**
     *   1つだと同じ波がくり返して機械的に見え、
     *   毎コマ乱数を引くとがたつく（5.2.4節が演出用の乱数をPRNGから取ることを禁じてもいる）。
     */
    wanderSec: [7.3, 3.1],
    /** apocalypse は強度だけを引き上げる（6.2.5節）。傾きと同じ倍率にそろえてある */
    apo: 1.8,
    /*
     * ★**画面の揺れだけを大きく見せる倍率**（利用者判断・第57セッション）。
     *
     *   物理どおりに描くと、台は**±9.5mm しか動かない**（画面で2px）。
     *   玉が玉3.5個ぶんもずれるのは、この小さな揺れが数秒ぶん積み重なるからで、
     *   **一瞬の見た目が小さいのは正しい。**正しいが、地震だと分からない。
     *   そこで**見せるほうだけ大きくする**＝「台の揺れ」ではなく
     *   「揺すられている自分から見た揺れ」を描く、という見立てである。
     * ★倍率は**画面上で何画素動くか**から決めた（利用者判断）。
     *   標準長方形では 1270mm が 306px＝0.24 px/mm なので、
     *   6倍で**常時が 7px・撞いた瞬間が 27px**（端から端）になる。
     *   **玉の動きはこの値に一切影響されない。**
     * ★**倍率はここ1つだけ。**画面側に別の式を書かない（見えている揺れと
     *   効いている揺れが、直しても片方だけ古くなる）。
     */
    view: 6,
    /*
     * ★**玉ひとつひとつのぶれ**（利用者指示・第57セッション）。
     *   **描くときだけ**のもので、本当の位置は動かさない（累積しない）。
     *   中身は下の jitterLag（すべり）と jitterDrift（位置がずれる）の2つ。
     */
    /*
     * ★**ぶれの中身を2つに分ける**（利用者指摘・第57セッション）。
     *
     *   最初は「その場で震える」＋「だんだん位置が変わる」で作ったが、
     *   **「玉が台の揺れにぴったり付いて動いていて、地震の影響を受けて見えない」**
     *   という指摘を受けた。**そのとおりだった。**
     *   その場の震えは台の揺れと無関係な向き・速さなので、
     *   **「台についていっていない」という見え方にはならない。**
     *
     *   本物は逆である。**激しく揺れる台の上で玉はすべり、台ほど動かない。**
     *   だから、**台の揺れそのものを打ち消す向きへ**ずらす。
     *
     *   ・**すべり** … 台の揺れに対してついていかない割合。**台と同じ速さ・同じ向きの軸**で効く
     *   ・**位置がずれる** … すべった結果、玉が少しずつ別の場所へ移っていく
     */
    /*
     * 台の揺れのうち、玉がついていかない割合（0.6＝台の4割しか動かない）。
     * ★**ここが小さいと「台に貼り付いて動いている」ようにしか見えない**（利用者指摘）。
     *   台のずれ（山で 57mm）に対して 0.6 なので、玉は台に対して 34mm ほど逆へずれる。
     */
    jitterLag: 0.6,
    /** だんだん位置が変わるぶん（台の揺れ幅に対する割合） */
    jitterDrift: 0.55,
    /*
     * ★**位置がずれるぶんは、大半を「全球そろって」にする。**
     *   玉ごとにばらばらへ大きく動かすと、**隣どうしが重なって見える**
     *   （ラックは玉の直径ぴったりで並んでいる）。そろって動けば大きくずらしても重ならず、
     *   **「盤面全体が同じ向きへ押される」（D54）とも合う。**
     */
    driftCommon: 0.75,     // 全球そろって動く重み
    driftPer: 0.25,        // 玉ごとにばらつく重み
    /** 位置がずれる速さ（揺れの振動数に対する倍率）。2Hzで周期1.5秒ほど */
    driftRate: [0.33, 0.43],
    /*
     * ★**すべり方は玉ごとに少し変える**（この割合だけ上下する）。
     *   全球まったく同じにすると、**台の揺れが小さくなっただけ**に見えてしまう。
     */
    lagSpread: 0.35,
  };

  /*
   * ───────── 台の傾き（F-03）─────────
   *
   * やることは1つだけ＝**転がっている玉へ、傾き方向の一定の加速度を足す**（6.6.3節）。
   *
   * ★**静止球には足さない。**これがこのギミックの要である（6.2.3節）。
   *   傾きは1ゲーム中ずっと残るので、静止球にも足すと玉が永久に転がり続け、
   *   **全球停止が原理的に成立しなくなる**＝ターンが終わらない。
   *   「傾いた台の上で玉が止まっている」のは非現実だが、
   *   これはプレイヤーが自分で選んだ乖離として許容されている（D362）。
   * ★空中の玉にも足さない（D192）。傾きは台を介して伝わる力なので、浮いた玉には届かない。
   *
   * ★**強さは、氷の上の減速（7.1 mm/s^2）より大きい。**
   *   つまり氷と一緒に選ぶと、氷の上では下り方向へ加速し続ける玉が出る。
   *   実測では120局に1つ、40秒たっても止まらない玉が出た。
   *   **これを避けられる強さ（5未満）では、ずれが玉0.5個ぶんで傾きが分からない。**
   *   そこで強さは効くほうを取り、止まらない玉は engine 側の安全弁（10.9.5節）で受ける。
   *   仕様書も傾きと氷の組合せを名指しでその節に挙げている。
   */
  const TILT = {
    /*
     * 傾きの加速度 mm/s^2（付録B送り）。★角度ではなく加速度で持つ。
     * 効くのは重力の斜面成分 g·sinθ だけなので、角度を持つと使うたびに換算が要る。
     * 50 は 0.29°に当たる。実測＝止まる場所が 198mm（玉3.5個ぶん）動く。利用者判断（第56セッション）。
     */
    accel: 50,
    /*
     * 方向の抽選範囲（付録B送り）＝**8方位**。全方位から連続で引かない。
     * 傾きは1ゲーム中維持され、プレイヤーが「この台は右下へ転がりやすい」と
     * 覚えて使う対象である（6.6.3節）。8方位なら矢印と言葉で言い切れる。
     */
    dirs: 8,
    /** apocalypse は強度だけを引き上げる（6.2.5節）。上限は無いので素直に倍率 */
    apo: 1.8,
  };

  /*
   * ───────── 可変地形（F-07 水たまり／F-08 氷の領域）─────────
   *
   * 物理は**専用の処理を持たない**（5.11.1節）。「氷の上では摩擦が低い」とは、
   * その場所で摩擦係数の値が小さいという意味でしかない。
   * そこで、ゴルフ型の砂や池と同じ「台面の一部だけ摩擦の違う場所」＝**区画**（5.3.4節・D430）
   * として台へ渡す。engine 側に地形の名前は1つも出てこない。
   *
   * ★下の数値はどれも**付録B送り**（6.12節）＝実際に玉を転がして詰めるもの。
   *   いまの値は暫定である。**5.11.2節の絶対制約だけは破れない**
   *   ＝摩擦係数は0であってはならない（0にすると玉が止まらず、ターンが終わらない）。
   */
  const CLOTH_SLIDE = 0.20, CLOTH_ROLL = 0.010;   // 台の標準値（table.js）。比べるための目安

  const TERRAIN = {
    // 水たまり＝摩擦の増大。ゴルフの池ほど重くはしない（あちらは「入ったら止まる」ための値）
    water: { count: 2, size: 5.0, slide: 0.45, roll: 0.055, apo: 1.6 },
    /*
     * 氷＝摩擦の大幅な低下。**ゼロにはしない**（6.6.7節）。
     *
     * ★**利用者の指示で、台に占める割合を 30〜40%、摩擦を出せるかぎり低くした**（第55セッション）。
     *   ・広さ … **効き目のほとんどは、摩擦ではなく広さから来る**
     *     （5% で 92mm → 35% で 561mm。そこから摩擦を最小まで下げて 656mm）。
     *   ・★**同じ大きさをたくさんではなく、大きさのちがうものを数個**（第55セッションの利用者指示）。
     *     **大きさを毎回ばらばらに引くと、局ごとの割合が 24〜49% まで散る**（大きいものばかり引く局が出る）。
     *     そこで**配る面積（share）を先に決め、それを count 個へランダムな比で分ける**。
     *     こうすると**大きさは1:2ほどばらつくのに、割合は 29〜42% に収まる**（実測）。
     *   ・摩擦 … **apocalypse でちょうど下限に届く値**を通常の値とした。
     *     apocalypse は強度だけを引き上げる決まり（6.2.5節）なので、通常の値を下限に置くと
     *     **apocalypse で下げる余地が無くなり、難易度の差が消える。**
     *     そこで下限 × 1.8 を通常とし、apocalypse で下限ちょうどになるようにしてある。
     */
    ice: { count: 6, share: 0.38, spread: 8, slide: 0.009, roll: 0.00072, apo: 1 / 1.8 },
  };
  const TERRAIN_GAP = 40;        // **種類が違う**地形のあいだに空ける最小の隙間（mm）。付録B送り
  /*
   * ★同じ種類どうしは**縁は重なってよいが、芯は重ねない**（第55セッション）。
   *   ただ「重なってよい」だけにすると**同じ場所に何枚も積み重なって面積が無駄になる**。
   *   中心どうしを半径の合計の この割合 だけ離すと、6個でも 30〜40% に届く
   *   （離さないと20個必要だった）。付録B送り。
   */
  const SAME_NEAR = 0.7;
  /*
   * 置き場所を1つ探すのに試す回数。
   * ★400では**星型で6個目が見つからない局が160局に1つ**出た（腕が細く、
   *   水と先に置いた氷を避けると残りが狭い）。**探しに行く回数を増やすだけで解ける。**
   *   ここで縮める段を増やすと、**玉より小さい氷**ができてしまう。
   */
  const PLACE_TRIES = 1500;
  /*
   * ★入らないときは、**その1個だけを縮めて**入れる（利用者判断・第54セッション）。
   *
   *   星型は腕が細く、3個置いた時点で4個目を置ける場所が**1点も残らない**（実測）。
   *   台の面積は8形状そろえてあるのに、置ける場所の広さは形でまるで違う
   *   （外接矩形に対して 標準長方形 59.5% ／ 十字 15.7% ／ 星型 9.1%）。
   *   ・全部の台を小さくすると、7形状の効きまで薄くなる
   *   ・台の太さに比例させると、輪が長くて4個入るドーナツまで縮む
   *   そこで「入らなかったものだけ縮める」。7形状は 5.0 倍のまま1ミリも変わらず、
   *   星型だけ置いた地形の3割ほどが縮む（平均 4.55 倍）。
   */
  const PLACE_SHRINK = [1, 0.8, 0.65, 0.5];

  /** そのギミックが置く地形の種類 */
  const TERRAIN_OF = { 'F-07': 'water', 'F-08': 'ice' };

  /**
   * 地形を1つ置ける場所を探す（6.7.1節）。
   *
   * ★**輪郭は控えている半径よりふくらむ**ので、盤面の内側かどうかは
   *   「ふくらんだあとの大きさ」で見る。ふくらむ前の半径で見ると、
   *   見えている縁が台からはみ出す（第53セッションで砂について直したのと同じ話）。
   * ★玉は避けない（6.7.1節）。開始直後のブレイクで散るため実害が無い。
   * ★乱数は共有シードから引く。ここで Math.random を使うと、通信対戦の相手と
   *   観戦者が別々の地形の盤面を見ることになる。
   *
   * ★**離すのは種類が違うものだけ。同じ種類どうしは重なってよい**（6.7.1節・D448）。
   *   「重ならない」という決まりの理由は**水と氷が重なった場所の物性を定めなければならない**ことにあり、
   *   **氷と氷が重なってもそこは一様に氷のまま**なので、その理由は当てはまらない。
   *   重なりを許さないと、いくつ置こうとしても**台の 28% で頭打ちになる**（実測）。
   */
  function findSpot(rng, table, r, placed, kind) {
    const T = BilliardsTable;
    const grown = r * T.GOLF_BLOB_MAX;
    for (let i = 0; i < PLACE_TRIES; i++) {
      const x = (rng() * 2 - 1) * table.halfW;
      const y = (rng() * 2 - 1) * table.halfH;
      if (T.clearance(table, x, y) < grown) continue;          // 輪郭ごと盤面の内側に収める
      let clash = false;
      for (const o of placed) {
        // 同じ種類＝縁は重なってよいが芯は重ねない／種類が違う＝輪郭ごと離す（D448）
        const need = (o.kind === kind)
          ? (r + o.r) * SAME_NEAR
          : grown + o.r * T.GOLF_BLOB_MAX + TERRAIN_GAP;
        if (Math.hypot(x - o.x, y - o.y) < need) { clash = true; break; }
      }
      if (!clash) return { x, y };
    }
    return null;
  }

  /**
   * 盤面のうち、実際に玉が転がれる広さ（外接矩形ではない）と、
   * **いちばん余裕のある場所の余白**。刻んで数えるので決定論。
   *
   * ★余白のほうも一緒に返すのは、**その台に入りきらない大きさを配らない**ため。
   *   細い台（星型の腕・十字）では、大きく配ってしまうと縮めても入らず、
   *   その1個が**丸ごと捨てられて個数が足りなくなる**（実測で160局に1局）。
   */
  function playArea(table) {
    const T = BilliardsTable;
    const NX = 120, NY = 60;
    let inside = 0, best = 0;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const x = (i + 0.5) / NX * 2 * table.halfW - table.halfW;
      const y = (j + 0.5) / NY * 2 * table.halfH - table.halfH;
      const c = T.clearance(table, x, y);
      if (c > 0) inside++;
      if (c > best) best = c;
    }
    return {
      area: inside / (NX * NY) * (2 * table.halfW) * (2 * table.halfH),
      room: best,
    };
  }

  /**
   * その種類の地形の半径を決める（大きい順）。
   *
   * ・**大きさが決まっているもの**（水たまり）… size をそのまま使う。全部同じ大きさ
   * ・**面積を配るもの**（氷）… 盤面の share だけの面積を count 個へランダムな比で分ける。
   *   ★**大きさを毎回ばらばらに引くのではない。**それだと局ごとの割合が散る（24〜49%）。
   *   合計を決めて配れば、**大きさはばらつくのに割合は収まる**（29〜42%）。
   */
  function radiiFor(spec, rng, table) {
    const T = BilliardsTable;
    if (spec.size != null) {
      const out = [];
      for (let i = 0; i < spec.count; i++) out.push(T.R * spec.size);
      return out;
    }
    const pa = playArea(table);
    const area = pa.area * spec.share;
    // ★その台に入りきる大きさで頭打ちにする（輪郭ごと入ること）
    const cap = pa.room / T.GOLF_BLOB_MAX;
    const w = []; let sum = 0;
    for (let i = 0; i < spec.count; i++) { const v = 1 + rng() * spec.spread; w.push(v); sum += v; }
    // 大きいものから置く。小さいものを先に置くと、大きいものの居場所が無くなる
    return w.map(v => Math.min(cap, Math.sqrt(area * (v / sum) / Math.PI))).sort((a, b) => b - a);
  }

  /**
   * 輪郭の形（出っぱりの数と振り分け）。
   * ★**ふくらみの合計（T.BLOB_WOBBLE）は変えない。**合計は置き場所の判定の前提なので、
   *   変えると台からのはみ出しの見方まで狂う。**振り分けと数だけを変える。**
   * ★形を持たせるのは**面積を配る種類だけ**。水たまりとゴルフの砂・池は従来どおりの形のまま。
   */
  function shapeOf(rng) {
    return {
      k1: 2 + Math.floor(rng() * 4),          // 大きな出っぱりの数 2〜5
      k2: 4 + Math.floor(rng() * 5),          // 小さな波の数 4〜8
      a1: 0.12 + rng() * 0.16,                // 振り分け（残りは自動で小さな波へ）
    };
  }

  /** ゲーム開始時に地形を配置する（6.7.1節）。異常モードは1ゲーム中これが変わらない */
  function placeTerrain(field, rng, table) {
    const out = [];
    ['F-07', 'F-08'].forEach(id => {
      if (!field.has(id)) return;
      const kind = TERRAIN_OF[id];
      const spec = TERRAIN[kind];
      const varied = spec.size == null;               // 面積を配る種類だけ、形もばらばらにする
      radiiFor(spec, rng, table).forEach(r0 => {
        // まずそのままの大きさで探し、入らなければ順に縮めて入れる
        for (const f of PLACE_SHRINK) {
          const r = r0 * f;
          const spot = findSpot(rng, table, r, out, kind);
          if (spot) {
            const h = { kind, x: spot.x, y: spot.y, r, blob: true };
            if (varied) Object.assign(h, shapeOf(rng));
            out.push(h);
            break;
          }
        }
        // いちばん小さくしても入らなければ、その1個は諦める
      });
    });
    return out;
  }

  /**
   * 台へ渡す区画（摩擦の違う場所）。engine はこれを見るだけで、地形の名前は知らない。
   * 難易度 apocalypse は**強度だけ**を引き上げる（6.2.5節）。
   */
  function patches(field) {
    if (!field || !field.game.terrain) return [];
    return field.game.terrain.map(h => {
      const spec = TERRAIN[h.kind];
      const k = field.apocalypse ? spec.apo : 1;
      // 摩擦は0にできない（5.11.2節）。下限を置いて必ず正にする
      /*
       * ★**輪郭の形（k1・k2・a1）も一緒に渡す。**落とすと物理だけが昔の形で判定し、
       *   **見えている縁と効いている縁がずれる**（第53でゴルフの砂について直したのと同じ話）。
       */
      return {
        x: h.x, y: h.y, r: h.r, blob: true,
        k1: h.k1, k2: h.k2, a1: h.a1,
        slide: Math.max(0.005, spec.slide * k),
        roll: Math.max(0.0004, spec.roll * k),
      };
    });
  }

  /**
   * 水で満たされたポケット（6.7.2節）。
   * **口径の一部が重なっただけでもポケット全体が水になる。**中途半端な水没は作らない。
   * 落球の挙動は変えない。変わるのは効果音だけ。
   * 氷は流れないので、この扱いはしない（重なった範囲だけが氷）。
   */
  function floodedPockets(field, table) {
    const out = {};
    if (!field || !field.game.terrain || !table.pockets) return out;
    const T = BilliardsTable;
    field.game.terrain.forEach(h => {
      if (h.kind !== 'water') return;
      table.pockets.forEach(pk => {
        if (out[pk.id]) return;
        // ポケットの口のどこか1点でも水に入っていれば、そのポケットは水で満たされる
        for (let a = 0; a < 12; a++) {
          const th = a / 12 * Math.PI * 2;
          if (T.blobContains(h, pk.x + Math.cos(th) * pk.r, pk.y + Math.sin(th) * pk.r)) { out[pk.id] = true; return; }
        }
        if (T.blobContains(h, pk.x, pk.y)) out[pk.id] = true;
      });
    });
    return out;
  }

  /** 番号を使わないルール（6.5.5節）。番号シャッフルはここでは働かない */
  const NO_NUMBER_RULES = ['G-04', 'G-06', 'G-09', 'G-11'];

  /**
   * そのギミックが選べない理由。選べるなら null。
   * 返すのは i18n のキーであって文言ではない（文言は i18n.js だけが持つ）。
   * @param {string} id  ギミックID
   * @param {{rule:string, hasPockets:boolean}} ctx いま選んでいるルールと台
   */
  function blockOf(id, ctx) {
    if (IDS.indexOf(id) < 0) return 'why.stage3';                       // まだ実装していない（11.6.1節）
    const c = ctx || {};
    if (id === 'F-11' && NO_NUMBER_RULES.indexOf(c.rule) >= 0) return 'why.gimNoNumber';
    if (id === 'B-08' && c.hasPockets === false) return 'why.gimNoPocket';
    return null;
  }

  /** いまのルール・台で実際に選べるギミック。異常モードが選べるかもここから決まる */
  function available(ctx) { return ALL_IDS.filter(id => !blockOf(id, ctx)); }

  /** 同時選択数の上限。難易度 apocalypse だけ引き上がる（6.2.5節） */
  function pickMax(difficulty) { return difficulty === 'apocalypse' ? PICK_MAX_APOCALYPSE : PICK_MAX; }

  /**
   * そのゲームで効くギミックを決める（6.5.3節・6.5.4節）。
   * 異常モード以外は null を返す＝**この層は何もしない**＝通常モードの定義（5.3.2節）。
   *
   * @param {object} spec {mode, gimmicks[], random, difficulty, rule, hasPockets, rng}
   * @returns {object|null} 盤面イベント層の状態
   */
  function create(spec) {
    if (!spec || spec.mode !== 'abnormal') return null;
    const ctx = { rule: spec.rule, hasPockets: spec.hasPockets };
    const pool = available(ctx);
    if (!pool.length) return null;
    const max = pickMax(spec.difficulty);
    let ids;
    if (spec.random) {
      /*
       * ランダムはゲーム開始時に1回だけ抽選し、そのゲーム中は同じ顔ぶれ（6.5.4節）。
       * 抽選は共有シードで引く。ここで Math.random を使うと、
       * 通信対戦の相手と観戦者が別々のギミックの盤面を見ることになる。
       */
      const rng = spec.rng || (() => 0.5);
      const bag = pool.slice();
      const n = Math.min(bag.length, 1 + Math.floor(rng() * max));
      ids = [];
      for (let i = 0; i < n; i++) ids.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
      ids.sort((a, b) => ALL_IDS.indexOf(a) - ALL_IDS.indexOf(b));
    } else {
      ids = (spec.gimmicks || []).filter(id => pool.indexOf(id) >= 0).slice(0, max);
    }
    if (!ids.length) return null;
    return {
      mode: 'abnormal',
      ids,
      apocalypse: spec.difficulty === 'apocalypse',
      has: id => ids.indexOf(id) >= 0,
      game: {},        // ゲーム開始時に決めたもの（地形・傾き）
      turn: {},        // ターン開始時に決めたもの（ブラックホール・テレポの対・シャッフル）
      shot: {},        // ショット開始時に決めたもの（地震の位相・突風）
    };
  }

  /*
   * ───────── 抽選の3か所 ─────────
   * どれも「盤面が止まっている時点」で呼ぶ。転がっている最中には呼ばない。
   * 第1段では中身が無い（口だけ通してある）。ギミックを足すたびにここへ書く。
   */

  /** ゲーム開始時（1ゲーム中不変のもの＝水たまり・氷・台の傾き） */
  function beginGame(field, rng, ctx) {
    if (!field) return;
    field.game = {};
    /*
     * 台の傾き（6.6.3節）。異常モードでは**ゲーム開始時に1回だけ**引き、1ゲーム中維持される。
     * ★ここで引くのは向きだけ。強さは定数なので抽選しない（引くと乱数列が伸びるだけで何も増えない）。
     */
    if (field.has('F-03')) {
      const k = Math.floor(rng() * TILT.dirs) % TILT.dirs;
      field.game.tilt = { k, dir: k * Math.PI * 2 / TILT.dirs, dirs: TILT.dirs };
    }
    /*
     * ★**地震の向きを、ここでも1つ引いておく。**
     *   地震はショット開始時に引き直すもの（下の beginShot）だが、
     *   **AIは撞く前に読む**ので、読みの時点では「1つ前のショットの向き」しか無い。
     *   1手目だけはそれも無く、**AIだけが地震の無い盤面を読む**ことになる（6.10.1節が名指しで戒める形）。
     *   ここで1つ用意しておけば、どの手でもAIは「地震のある盤面」を読む。
     * ★向きが本物と違うのは承知のうえである。**AIが本物の向きを先に知ると、
     *   人には出せない補正ができてしまう。**向きは毎回一様に引くので、有利にも不利にもならない。
     */
    if (field.has('F-01')) field.shot.quake = drawQuake(rng);
    const table = ctx && ctx.table;
    if (!table) return;
    field.game.terrain = placeTerrain(field, rng, table);
    field.game.flooded = floodedPockets(field, table);
  }

  /** ターン開始時（そのターンだけのもの＝ブラックホール・テレポの対・番号シャッフル） */
  function beginTurn(field, rng, ctx) {
    if (!field) return;
    field.turn = {};
  }

  /**
   * 揺れの向きを1つ引く（6.6.2節）。
   * ★**全方位から連続で引く。**傾きのように8方位へ丸めない（付録B送り・第57セッション）。
   *   丸める理由は傾きのほう＝「この台は右下へ転がりやすい」と覚えて使う対象だから、矢印と言葉で
   *   言い切れる形にする、というものだった。**地震は毎ショットの事故で、覚える対象ではない。**
   */
  function drawQuake(rng) {
    const dir = rng() * Math.PI * 2;
    return { dir, dx: Math.cos(dir), dy: Math.sin(dir) };
  }

  /** ショット開始時（そのショットだけのもの＝地震の向き・突風の向きと遅れ） */
  function beginShot(field, rng, ctx) {
    if (!field) return;
    field.shot = {};
    if (field.has('F-01')) field.shot.quake = drawQuake(rng);
  }

  /**
   * いまの揺れの強さ（加速度 mm/s^2）。**符号つき**で、正が揺れの向き。
   * 物理も画面もこの1つの式から出す。★2つ持つと、**見えている揺れと効いている揺れがずれる。**
   *
   * ★位相は shotTick から作る＝**ショットが始まった瞬間が押し始め**。
   *   毎ショット位相を引き直すと、最初の半周期の押しと次の半周期の押し返しが打ち消し合って、
   *   **止まる場所が揺れの向きへまったく偏らなくなる**（実測：向きへ 0mm ⇔ 位相をそろえれば 30〜50mm）。
   *   6.6.2節は「盤面全体が同じ向きに押される現象として読める」ことを求めているので、そろえる。
   */
  /**
   * いまの揺れの強さ（加速度の山 mm/s^2）。**符号を持たない大きさだけ。**
   *
   * @param {boolean} rolling 玉が転がっているか。false は「盤面が止まっている間の常時の揺れ」
   *
   * ★**物理も画面もここ1つから強さをもらう。**別々に持つと、
   *   強さを変えた日に片方だけ古くなる（見えている揺れと効いている揺れがずれる）。
   */
  /**
   * 常時の揺れの「ゆっくりした増減」（1を中心に 1±wander の間を行き来する）。
   *
   * ★**乱数を引かない。**割り切れない2つの周期を重ねると、くり返しに聞こえない
   *   ゆらぎになる。重みの合計を1にしてあるので、**必ず 1±wander の中に収まる**
   *   ＝下限は 1-wander で、**0 にはならない**（利用者指示「静止はせず」）。
   */
  function quakeWander(sec) {
    const [a, b] = QUAKE.wanderSec;
    const v = 0.6 * Math.sin(2 * Math.PI * (sec || 0) / a)
      + 0.4 * Math.sin(2 * Math.PI * (sec || 0) / b + 1.7);
    return 1 + QUAKE.wander * v;
  }

  /**
   * いまの揺れの強さ（加速度の山 mm/s^2）。**符号を持たない大きさだけ。**
   *
   * @param {boolean} rolling 玉が転がっているか。false は「盤面が止まっている間の常時の揺れ」
   * @param {number}  sec     ゆらぎ用の時計（秒）。物理はショットの時計から、画面は実時間から渡す
   *
   * ★**物理も画面もここ1つから強さをもらう。**別々に持つと、
   *   強さを変えた日に片方だけ古くなる（見えている揺れと効いている揺れがずれる）。
   * ★**ゆっくりした増減がかかるのは常時のぶんだけ。**撞いた瞬間の山まで揺らすと、
   *   同じ撞き方でも本震の強さが毎回変わってしまう。
   */
  function quakeLevel(field, shotTick, rolling, sec) {
    const q = field && field.shot && field.shot.quake;
    if (!q) return 0;
    const amp = QUAKE.amp * (field.apocalypse ? QUAKE.apo : 1);
    const base = QUAKE.ambient * quakeWander(sec);
    if (!rolling) return amp * base;
    // ★刻みの長さは engine の値をそのまま借りる。ここに 1/480 を書き写すと、
    //   刻みを変えた日に**片方だけ古くなる**（同じ表を2か所に持たない）
    const t = (shotTick || 0) * BilliardsEngine.DT;  // ショットが始まってからの秒数
    return amp * (base + (1 - QUAKE.ambient) * Math.exp(-t / QUAKE.decay));
  }

  /**
   * その刻みで玉へ足す加速度（符号つき）。正が揺れの向き。
   *
   * ★位相は shotTick から作る＝**ショットが始まった瞬間が押し始め**。
   *   毎ショット位相を引き直すと、最初の半周期の押しと次の半周期の押し返しが打ち消し合って、
   *   **止まる場所が揺れの向きへまったく偏らなくなる**（実測：向きへ 0mm ⇔ そろえれば 30〜50mm）。
   *   6.6.2節は「盤面全体が同じ向きに押される現象として読める」ことを求めているので、そろえる。
   * ★**転がっている玉にしか呼ばれない**ので、強さは常に rolling 側で取る。
   */
  function quakeAccel(field, shotTick) {
    const q = field && field.shot && field.shot.quake;
    if (!q) return 0;
    const t = (shotTick || 0) * BilliardsEngine.DT;
    // ★ゆらぎの時計も**ショットの時計から**渡す。実時間を渡すと物理が決定論でなくなる
    return quakeLevel(field, shotTick, true, t) * Math.sin(2 * Math.PI * QUAKE.freq * t);
  }

  /**
   * その1刻みで、その玉へ外力を加える（6.10.1節「外力の注入」）。
   *
   * ★engine.js の step() から**必ず1か所で**呼ばれる。呼ぶ側に書き足してはいけない。
   *   盤面を進める道は5本ある（主ループ・演出無しの一気走らせ・観戦者の追いつき・
   *   リプレイ・AIの読み）ので、呼ぶ側に書くと必ずどれかが抜け、
   *   たとえば「AIだけ地震の無い盤面を読む」という食い違いになる。
   *
   * ★実時間を見ない。揺れの位相はゲーム内の刻み数 tick から作る。
   *
   * 静止球に作用しない原則（6.2.3節）と空中の玉の扱い（6.2.4節）は
   * ギミックごとに違うので、判断はこの中で行う。engine には持ち込まない。
   *
   * @param {object} field
   * @param {object} b        玉
   * @param {number} tick     ゲーム内時間（刻み数。ゲーム開始から増え続ける）
   * @param {number} dt       1刻みの秒数
   * @param {object} table    台
   * @param {number} shotTick そのショットが始まってからの刻み数（全球停止で0に戻る）
   */
  function apply(field, b, tick, dt, table, shotTick) {
    if (!field) return false;
    let done = false;
    /*
     * F-01 地震（6.6.2節）。転がっている玉だけに、揺れの向きの行ったり来たりする加速度。
     * ★条件の2つは傾きと同じで、どちらも外せない（空中の玉＝D192／静止球＝6.2.3節）。
     * ★向きも位相も全球で共通なので、ここで玉ごとに何かを引いてはいけない。
     */
    if (field.shot.quake && b.z <= 0.01 && (b.vx !== 0 || b.vy !== 0)) {
      const a = quakeAccel(field, shotTick);
      b.vx += field.shot.quake.dx * a * dt;
      b.vy += field.shot.quake.dy * a * dt;
      done = true;
    }
    /*
     * F-03 台の傾き（6.6.3節）。転がっている玉だけに、傾き方向の一定の加速度。
     * ★条件の2つはどちらも外せない。
     *   b.z <= 0.01 … 空中の玉には効かない（D192）
     *   速度が0でない … 静止球は動き出さない＝全球停止が成立する（6.2.3節）
     */
    const tl = field.game.tilt;
    if (tl && b.z <= 0.01 && (b.vx !== 0 || b.vy !== 0)) {
      const a = TILT.accel * (field.apocalypse ? TILT.apo : 1);
      b.vx += Math.cos(tl.dir) * a * dt;
      b.vy += Math.sin(tl.dir) * a * dt;
      done = true;
    }
    return done;
  }

  /** いま効いている傾き（画面が矢印を出すために見る）。無ければ null */
  function tilt(field) { return (field && field.game && field.game.tilt) || null; }

  /**
   * いま台がどれだけ横へずれているか（mm）。画面を揺らすために見る。
   * 揺れていなければ null。
   *
   * ★**揺れ幅は目分量で決めない。**加速度が a·sin(ωt) なら、台の位置は -a/ω^2·sin(ωt) である。
   *   強さは物理と同じ quakeLevel からもらい、**見せるための倍率（QUAKE.view）だけを最後に掛ける。**
   *   こうすると、強さを変えたときに画面の揺れも必ず一緒に動く。
   *   （振幅1500・2Hz なら台は山で 9.5mm。画面はその3倍。常時はその4分の1）
   * ★静止球も台と一緒に画面上を動く。**台の上では動いていない**（6.6.2節「演出のみ」）。
   *
   * ★**位相だけは実時間の通し時計で回す**（now）。物理の位相はショットの時計から作るが、
   *   ショットとショットのあいだは**盤面が進まないのでその時計は止まる。**
   *   常時の揺れをそれで描くと、狙っている最中に画面が凍りつく。
   *   演出の時計は結果に影響しないので実時間でよい（5.2.4節が演出を決定論の外に置いている）。
   *
   * @param {number} shotTick そのショットが始まってからの刻み数
   * @param {number} now      実時間の通し時計（秒）
   * @param {boolean} rolling 玉が転がっているか
   */
  function quakeShift(field, shotTick, now, rolling) {
    const q = field && field.shot && field.shot.quake;
    if (!q) return null;
    const w = 2 * Math.PI * QUAKE.freq;
    const d = -quakeLevel(field, shotTick, rolling, now) / (w * w) * QUAKE.view
      * Math.sin(w * (now || 0));
    return { x: q.dx * d, y: q.dy * d, dir: q.dir, amount: d };
  }

  /**
   * その玉を**描くときだけ**足すぶれ（演出。利用者指示・第57セッション）。
   * 揺れていなければ null。
   *
   * ★**本当の位置は1ミリも動かさない。**だから、ぶれは何回描いても累積しない。
   *   玉の座標へ足し込むと、静止球が少しずつ流れていって全球停止が壊れる。
   * ★**乱数を引かない。**玉の番号から向きを作る。
   *   仕様書 5.2.4節は「演出用の乱数を共有シードのPRNGから取ってはならない」と定めており、
   *   かといって Math.random を毎コマ引くと**玉が痙攣して見える**（コマごとに向きが飛ぶ）。
   *   番号から作れば、玉ごとに違う向きで、なめらかに震える。
   * ★**「その場で震える」と「だんだん位置が変わる」を重ねる**（利用者指示「本物に寄せて」）。
   *   速い震えだけだと機械の振動に見える。**遅くて大きいほうを主にする。**
   * ★遅いほうも行って戻る波なので、**どれだけ長く揺れても玉が流れていくことはない。**
   */
  function quakeJitter(field, shotTick, now, rolling, ball) {
    const q = field && field.shot && field.shot.quake;
    if (!q) return null;
    const w = 2 * Math.PI * QUAKE.freq;
    const base = quakeLevel(field, shotTick, rolling, now) / (w * w) * QUAKE.view;
    const k = (ball && ball.id != null ? ball.id : 0) * 2.39996;   // 黄金角。玉ごとに変える
    const t = (now || 0) * w;

    /*
     * ①**すべり** ── 台の揺れを打ち消す向きへ、その割合だけ戻す。
     *   台がこちらへ動いた瞬間、玉は**そこまで付いていかない**。
     *   ★**台の揺れと同じ式・同じ向き・同じ位相**から作るのが要点である。
     *     別の向きや速さで震わせると、「台についていっていない」という見え方にはならない
     *     （最初にそれで作って、利用者から「地震の影響を受けて見えない」と指摘された）。
     * ★すべり方は玉ごとに少し変える。全球同じだと**台の揺れが小さくなっただけ**に見える。
     */
    const shift = -base * Math.sin(t);                       // = 台のずれ（quakeShift と同じ式）
    const lag = -shift * QUAKE.jitterLag * (1 + QUAKE.lagSpread * Math.sin(k * 1.7));

    /*
     * ②**だんだん位置が変わる** ── すべった結果、玉が少しずつ別の場所へ移る。
     *   ★行って戻る波なので、**どれだけ長く揺れても玉が流れていくことはない**（累積しない）。
     */
    const [d1, d2] = QUAKE.driftRate;
    const amt = base * QUAKE.jitterDrift;
    const dx = (Math.sin(t * d1) * QUAKE.driftCommon
      + Math.sin(t * d1 * 1.27 + k) * QUAKE.driftPer) * amt;
    const dy = (Math.sin(t * d2 + 1.1) * QUAKE.driftCommon
      + Math.sin(t * d2 * 1.19 + k * 1.3) * QUAKE.driftPer) * amt;

    return { x: q.dx * lag + dx, y: q.dy * lag + dy };
  }

  /** 画面が描くための地形の一覧（物理・ルールと同じものを見る） */
  function terrain(field) { return (field && field.game.terrain) || []; }
  /** その点がいずれかの地形の中か。中なら地形を返す（音と演出が使う） */
  function terrainAt(field, x, y) {
    const list = terrain(field);
    for (const h of list) if (BilliardsTable.blobContains(h, x, y)) return h;
    return null;
  }

  return {
    ALL_IDS, DOOR, IDS, PICK_MAX, TERRAIN, TILT, QUAKE, CLOTH_SLIDE, CLOTH_ROLL,
    blockOf, available, pickMax, create,
    beginGame, beginTurn, beginShot, apply,
    patches, terrain, terrainAt, floodedPockets, tilt,
    quakeLevel, quakeWander, quakeAccel, quakeShift, quakeJitter,
  };
})();

if (typeof window !== 'undefined') window.BilliardsField = BilliardsField;
