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
  const IDS = ['F-01', 'F-03', 'F-05', 'F-06', 'F-07', 'F-08', 'F-11', 'B-08'];

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
   * ───────── 突風（F-06）─────────
   *
   * やることは1つだけ＝**ショットの途中で一度だけ、全球へ同じ向きの速度を足す**（6.6.5節）。
   * 加速度ではなく**速度そのもの**を1回加える。「一瞬・一回限り」がこのギミックの定義なので、
   * 続けて押すものにしてはいけない（D193・D203）。
   *
   * ★**条件が地震・傾きとちょうど逆である。**
   *   地震と傾きは「転がっている・盤面に接している」玉にしか効かないが、
   *   **突風は静止球にも空中の玉にも効く**（6.2.3節の例外2件のうちの1件／D192）。
   *   風は空気を介して届くので、台を介して伝わる力とは経路が違う、というのが理由である。
   *   **8種のうち空中の玉に効くのは突風だけ**なので、ここの条件を他からうつしてはいけない。
   *
   * ★**静止球を動かしてもターンは終わる。**一瞬で終わり持続しないので、
   *   押されて動き出した玉はふつうに摩擦で止まる（6.2.3節の但し書き）。
   *   ただし**止まるまでの時間はそのぶん延びる**ので、安全弁（20秒）との兼ね合いは実測で見る。
   */
  const GUST = {
    /*
     * 風速＝一度だけ加える速度 mm/s（付録B送り）。
     * ★**加速度ではない。**1刻みぶんの dt を掛けてはいけない（掛けると「弱い風が1瞬」になり何も起きない）。
     *
     * 200 は実測＝手玉の止まる場所が 247mm（玉4.3個ぶん）動く。利用者判断（第58セッション）。
     * 地震＝185mm（玉3.2個）／傾き＝198mm（玉3.5個）より**一段強い**という選び方である。
     *
     * ★風速を動かすときは**静止球のほうも一緒に見る。**突風は静止球も動かすので、
     *   この値は「毎ショット、ラック全体が風下へ何mm滑るか」でもある（200 で 109mm＝玉1.9個）。
     *   手玉の効き目だけを見て上げると、数手で盤面が散る。
     */
    speed: 200,
    /*
     * ショット後の遅れ（秒）（付録B送り）。
     * ★**0にしてはいけない。**ショットの時計は全球停止で0に戻るので、0だと
     *   **盤面が止まっている間じゅう毎刻み吹き続ける**＝玉が永久に動き、ターンが終わらない。
     *   下の gustTick で最低でも1刻みは空けてある。
     * 遅らせる理由は6.6.5節＝「撞いた瞬間には分からず、玉が走り出してから軌道が崩れる」体験を作るため。
     *
     * ★**上は 0.65 秒までしか伸ばせない。**実測（第58セッション）で
     *   **玉が空中に居るのは撞いてから 0〜0.73 秒の窓だけ**だった。
     *   これより遅らせると「突風だけが空中の玉に効く」（6.6.5節・D192）が**一度も起きない**
     *   ＝このギミックの見せ場が丸ごと死ぬ。0.3 は窓の真ん中である。
     */
    delay: 0.3,
    /*
     * 風の前線が進む速さ mm/s（付録B送り）。
     * ★**突風は「全球へ同時に」ではなく、風の前線が台を横切っていく。**
     *   玉は**前線が自分の場所に届いた刻み**に動き出す（利用者指示・第58セッション）。
     *
     * ★**この速さは、玉が出せる最高速より速くなければならない。**
     *   遅いと、風下へ走っている玉が前線から逃げ続けて**一度も風を受けない**か、
     *   クッションで戻ってきて**二度目を受ける**。
     *   速ければ「前線と玉の隔たり」が必ず広がる一方なので、**すれ違いは必ず1回だけ**になる。
     *   つまりこの値は見た目の問題ではなく、**「一回限り」を支えている値**である。
     *
     * 24000（24 m/s）は利用者判断＝**100%で撞いた手玉の初速（12 m/s）の2倍**
     * （「手玉を追い越して風で揺らせる程度」）。
     * 実測：台の対角 2840mm を **0.118秒**（毎秒60コマなら7コマ）で渡り、
     * いちばん風下の玉に届くのは撞いてから 0.418 秒＝空中の窓（0.73秒）の内側。
     */
    front: 24000,
    /*
     * 玉ごとの受け方のばらつき（0.25＝±25%）（付録B送り）。
     * ★全球がまったく同じ量だけ動くと、**ラックが隅形を保ったまま丸ごと滑り、不自然に見える**
     *   （実機で利用者から「ころがりが同じすぎて不自然」と指摘を受けた）。
     * 0.55 は実測＝触れ合わない玉を並べて、**玉ごとのちらばりが玉 1.1 個ぶん**、
     * いちばん動く玉と動かない玉の差が**玉 3.3 個ぶん**（±25% では 0.5 / 1.6 個だった）。
     */
    spread: 0.55,
    /*
     * 玉ごとの係数をいくつ引いておくか。
     * ★**玉の数によらず固定にする。**盤面に残っている玉の数だけ引く形にすると、
     *   玉が落ちて数が減った局面で**乱数列の進み方が変わり、AIの読み・リプレイ・観戦と食い違う。**
     */
    varyCount: 16,
    /*
     * 風の縞（画面の演出）。★**先頭の縞の先端が、そのまま物理の前線である。**
     *   別々に持つと「縞が通り過ぎたのに動かない玉」が出る。
     */
    /*
     * ★**縞は「風の線」であって「飛んでいく物」ではない。**
     *   最初は7本・長さ900mm（台の3分の1）で作ったが、利用者から
     *   「風が動いたように見えない。**白い小さなものが飛んでいくように見える**」
     *   と指摘を受けた。**短くて太い帯は「物体」に見える。**
     *   長く・細く・多くして、**画面を端から端まで貫く線**にする（利用者指示＝30本程度）。
     */
    /*
     * 帯の本数。★**見えている長さを伸ばしたぶんだけ増やす**（利用者指示）。
     *   帯は前線の後ろへ長く並ぶので、本数をそのままにすると**隔たりが開いてスカスカになる**。
     *   実際に描くのは「その瞬間に台の上にあるもの」だけなので、
     *   本数を増やしても一度に描く数は変わらない（30本前後）。
     */
    streaks: 320,
    /*
     * ★**縞は進む向きと直交する帯である**（利用者指示・第58セッション）。
     *   最初は**風の向きへ伸びた線**で作ったが、風が動いて見えなかった。
     *   風の前線は**進む向きと直角の線**なので、その向きの帯が流れてこそ
     *   「面が押し寄せてくる」見え方になる。
     *
     * 帯1本の**厚み**（進む向きの寸法 mm）。利用者指示で太くしてある。
     */
    streakThick: [180, 820],
    /*
     * ★**風が見えている長さ（秒）。音の長さと同じ値にする。**
     *   利用者から「風の絵と風の効果時間と音の長さ3つが同じ時間に見えない。
     *   絵が短く、音が長く」と指摘を受けた。実測では
     *   効果 2.1ms ⇔ 絵 669ms ⇔ 音 1440ms と、700倍の開きがあった。
     *   効果（一瞬）はそのままにし、**絵と音の2つをそろえる**という利用者判断。
     *
     *   0.75 は音素材の長さ。効果音ラボの素材は「びゅー」が2回入っているので、
     *   **1回目の終わり（谷は 0.65〜0.78秒）にかけて消える**よう切ってある。
     * ★**ここを変えるときは、音素材の長さも一緒に変えること。**片方だけ動かすと又ずれる。
     */
    showSec: 0.75,
    /*
     * 白の濃さ。★**太くするほど薄くする。**太い帯が重なると、1本あたりが同じ濃さでも
     *   画面はどんどん白くなる。利用者指示は「もっと太く、さらに透明度を上げてギリギリ見えるくらい」。
     */
    streakAlpha: 0.006,
    /** apocalypse は強度だけを引き上げる（6.2.5節）。回数は1回のまま（D222）。地震・傾きと同じ倍率 */
    apo: 1.8,
  };

  /**
   * 突風が吹く刻み（ショットの時計の値）。
   * ★**必ず1以上にする。**0だと盤面が止まっている間じゅう吹き続ける（GUST.delay の注記）。
   * ★刻みの長さは engine の値をそのまま借りる。ここに 1/480 を書き写すと、
   *   刻みを変えた日に片方だけ古くなる（同じ表を2か所に持たない）。
   */
  function gustTick() {
    return Math.max(1, Math.round(GUST.delay / BilliardsEngine.DT));
  }

  /**
   * 風軸（風の向き）に沿った座標。玉も前線もこの1本の目盛りで比べる。
   */
  function gustAxis(gu, x, y) { return x * gu.dx + y * gu.dy; }

  /**
   * 前線が出発する場所（風軸の座標）。台の**いちばん風上の隅**。
   *
   * ★ここだけは**外接矩形でよい**。「台の内側かどうか」を問う場面ではなく、
   *   「どの玉よりも風上にある点」が欲しいだけだからである。
   *   外接矩形の隅は必ずどの玉より風上にある（六角形でもL字でも）。
   */
  function gustStart(gu, table) {
    const cx = (table.center && table.center.x) || 0;
    const cy = (table.center && table.center.y) || 0;
    let s = Infinity;
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const v = gustAxis(gu, cx + i * table.halfW, cy + j * table.halfH);
        if (v < s) s = v;
      }
    }
    return s;
  }

  /**
   * その刻みの前線の位置（風軸の座標）。まだ吹いていなければ null。
   * ★**物理も画面もこの1つの式から位置をもらう。**
   */
  function gustFront(field, shotTick, table) {
    const gu = field && field.shot && field.shot.gust;
    if (!gu || !table) return null;
    const t = ((shotTick || 0) - gustTick()) * BilliardsEngine.DT;
    if (t < 0) return null;
    return gustStart(gu, table) + GUST.front * t;
  }

  /**
   * その玉が風を受ける強さの倍率（玉ごとのばらつき）。
   * ★乱数は**ショット開始時に共有シードから引いてある**。ここでは引かない。
   */
  function gustVary(gu, b) {
    if (!gu.vary || !gu.vary.length) return 1;
    const n = gu.vary.length;
    return gu.vary[((b.id % n) + n) % n];
  }

  /**
   * 風の縞（画面の演出）。先頭の1本の先端が物理の前線そのもの。
   * ★**乱数を引かない**（縞の並びは本数から作る）。毎コマ引くと縞がちらつく。
   * @returns {null|{dx,dy,px,py,heads:number[],half:number[],alpha:number[],len:number}}
   */
  function gustStreaks(field, shotTick, table) {
    const gu = field && field.shot && field.shot.gust;
    const head = gustFront(field, shotTick, table);
    if (head === null) return null;
    const span = Math.hypot(table.halfW * 2, table.halfH * 2);
    const start = gustStart(gu, table);
    /*
     * ★**帯が並ぶ長さは、「見えている長さ」から逆算する。**
     *   最後の帯が台を抜けたところで風は終わりだから、
     *   （台の差し渡し + 帯の並ぶ長さ）÷ 前線の速さ = showSec になるように取る。
     *   ★長さを mm で直書きしない。直書きすると、前線の速さや台の大きさを
     *   変えた日に**絵の長さだけが古くなり、音とずれる**。
     */
    const streakSpan = Math.max(600, GUST.front * GUST.showSec - span);
    if (head - streakSpan > start + span) return null;      // 最後の帯も抜けた
    /*
     * 風と直角の広がり。★**外接矩形の半対角まで取る。**
     *   風はどの向きにも向くので、半幅や半高さで止めると、
     *   斜めの風のときに**隅が縞の無いまま残る**。
     */
    const halfSpan = Math.hypot(table.halfW, table.halfH);
    const n = GUST.streaks;
    const cx = (table.center && table.center.x) || 0;
    const cy = (table.center && table.center.y) || 0;
    const mid = -gu.dy * cx + gu.dx * cy;          // 台の中心の、風と直角の座標
    const [t0, t1] = GUST.streakThick;
    /*
     * ★**ばらつきは番号から作る（乱数を引かない）。**
     *   毎コマ Math.random を引くと帯が毎コマ作り直され、**風でなく砂嵐に見える**。
     *   sin を並べるだけだと規則的に見えるので、**番号をかき混ぜて** 0〜1 を作る。
     */
    const rnd = (i, k) => {
      let x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const back = [], thick = [], mid2 = [], half = [], alpha = [];
    for (let i = 0; i < n; i++) {
      /*
       * ★**先頭の1本の前縁が、そのまま物理の前線である**（i=0 の帯は back=0）。
       *   ここをずらすと「帯が通り過ぎたのに動かない玉」が出る。
       *   残りの帯はこの後ろへ不規則に並ぶ。
       */
      const bk = i === 0 ? 0 : streakSpan * (i / n + (rnd(i, 1) - 0.5) * 0.7 / n);
      const th = t0 + (t1 - t0) * rnd(i, 2);
      const edge = head - bk;                       // この帯の前縁
      /*
       * ★**その瞬間に台の上にある帯だけを返す。**
       *   本数を増やしても一度に描く数は変わらない。
       */
      if (edge < start || edge - th > start + span) continue;
      back.push(bk);
      thick.push(th);
      // 帯の長さ（風と直角の寸法）。台を貫くものもあれば、途中で切れるものもある
      half.push(halfSpan * (0.45 + 0.75 * rnd(i, 3)));
      mid2.push(mid + (rnd(i, 4) - 0.5) * halfSpan * 1.1);
      /*
       * ★**後ろの帯ほど薄くする。**これが風の消え際になるので、
       *   「何秒で消すか」という別の値を持たない（持つと音の長さと二重になる）。
       *
       * ★**消え際の形は音とそろえる。**音は 0.75秒のうち**後ろ4割**をかけて消してある。
       *   ここも**前の6割は濃さを落とさず、後ろ4割で消す。**
       *   全体をなだらかに薄くすると後半がほとんど見えず、
       *   **「音より早く消えた」ように見える**（実機で利用者の指摘。実測でも
       *   出ているのは 750ms なのに、見えているのは 581ms しかなかった）。
       */
      const u = bk / streakSpan;
      const taper = u <= 0.6 ? 1 : Math.pow(1 - (u - 0.6) / 0.4, 2);
      alpha.push(GUST.streakAlpha * taper * (0.45 + 0.55 * rnd(i, 5)));
    }
    if (!back.length) return null;
    return { dx: gu.dx, dy: gu.dy, px: -gu.dy, py: gu.dx, head, back, thick, mid: mid2, half, alpha };
  }

  /*
   * ───────── ブラックホール（F-05）─────────
   *
   * やることは3つ ── **中心へ引く／事象の地平線へ入った玉を落とす／ターン開始時に位置を1つ決める**
   * （6.6.4節・6.8節）。
   *
   * ★**効く相手が地震・傾きと違う。静止球にも効く**（6.2.3節の例外）。
   *   穴はターンが終われば消えるので、静止球が動き出してもターンは終わる。
   * ★**空中の玉には効かない**（D192）。帰結として**ジャンプショットは穴を跳び越える回避手段**になる。
   * ★**引力は壁を透過するが、落下は遮られる**（6.8.4節）。ドーナツ型の島の向こうにある玉は
   *   引かれて壁へ押し付けられるだけで、消えることはない。
   *   「壁の向こうから玉が消える」ほうが盤面として理解しがたい、という判断である。
   */
  const HOLE = {
    /*
     * 作用半径。**A-01 標準長方形の短辺の 1/3**（6.6.4節・本文で確定＝付録B送りではない）。
     * ★**全16形状で同じ絶対値**を使う。形ごとに最小幅から出すと、
     *   L字や星型の細い腕で極端に小さくなり、ギミックとして働かなくなる。
     */
    radius: BilliardsTable.PLAY_H / 3,
    /** 事象の地平線の半径 mm（付録B送り）。ここへ入った玉は速度によらず落ちる（6.8.5節） */
    horizon: 60,
    /** 中心での引力 mm/s^2（付録B送り）。外縁へ向かって下の形で 0 まで落ちる */
    accel: 20000,
    /*
     * 距離依存の形（付録B送り）。a(d) = accel · (1 - d/R)^falloff
     * ★**外縁でちょうど0になる形でなければならない**（6.6.4節「境界の内外で不連続に切り替わらない」）。
     *   万有引力の 1/d^2 は外縁で0にならないので使えない。
     * ★**この形は「強さ」より効く。**^2 は力のほとんどを中心のすぐ近くに集めてしまうので、
     *   圏の縁を通る玉はほとんど曲がらない（実測：縁寄りを 1.6m/s で通して 3°）。
     *   利用者の指摘「作用エリアに入ったら軌道が曲がってほしい」に効くのはこちらである
     *   （^1 にすると同じ通り道で 47°）。**中心の強さを上げるだけでは縁は変わらない。**
     */
    falloff: 1,
    /** apocalypse は強度だけを引き上げる（6.2.5節）。地震・傾き・突風と同じ倍率 */
    apo: 1.8,
    /** 位置を引く試行回数。足りなければ下の格子探索へ落ちる（6.8.3節の手順2） */
    tries: 800,
    /** 手順2の格子の細かさ */
    grid: [72, 36],
  };

  /**
   * 中心から d mm の地点の引力（mm/s^2）。作用圏の外は 0。
   *
   * ★**物理も画面もこの1つの式から出す。**画面側に別の式を書くと、
   *   強さを直した日に**見えている圏と効いている圏がずれる**（地震のときと同じ話）。
   */
  function holeAccel(field, d) {
    const R = HOLE.radius;
    if (!(d < R)) return 0;
    const k = (field && field.apocalypse) ? HOLE.apo : 1;
    return HOLE.accel * k * Math.pow(1 - d / R, HOLE.falloff);
  }

  /**
   * 静止した玉が動き出さない距離 mm（6.8.2節）。
   *
   * ★**独立した設定値として持たない。**「引力が静止摩擦を上回らない距離」を、
   *   上の引力の式と**エンジンの停止判定**から導く。
   * ★このゲームに静止摩擦係数そのものは無い（5.5.1節は摩擦を滑りと転がりの2つでしか定めていない）。
   *   静止摩擦の役をしているのは**停止判定**である ── 1刻みで足される速さが STOP_V に届かなければ、
   *   その刻みの末尾で0へ戻されるので、玉は何刻み待っても動き出さない。
   *   （台の傾きのときに「静止球は動き出さない」の検査が空振りした、あの仕掛けがここでは土台になる）
   * ★摩擦は無視してよい。摩擦は**さらに減らす向き**にしか働かないので、この距離は安全側に出る。
   */
  function holeKeepAway(field) {
    const E = BilliardsEngine;
    const stopA = E.STOP_V / E.DT;                 // これ以上の加速度でなければ静止球は動き出さない
    const k = (field && field.apocalypse) ? HOLE.apo : 1;
    /*
     * ★**どんなに引力が弱くても、玉の上には開けない。**
     *   導き出される距離は引力を下げるほど短くなり、引力 4000 では 9mm まで縮む。
     *   9mm では**穴が玉に重なる＝ターン開始と同時にその玉が地平線の内側に居る**ことになり、
     *   撞く前に消える。6.8.2節が言う「動き出さない距離」は動き出す側の下限であって、
     *   **落ちない側の下限は別にある。**地平線＋玉半径をそこに置く。
     */
    const floor = HOLE.horizon + BilliardsTable.R;
    const ratio = stopA / (HOLE.accel * k);
    if (!(ratio < 1)) return floor;                // 中心でも静止摩擦に届かない＝どこへ置いても動かない
    return Math.max(floor, HOLE.radius * (1 - Math.pow(ratio, 1 / HOLE.falloff)));
  }

  /** 玉と穴の中心のあいだに壁があるか（6.8.4節）。引力は透過するが**落下だけ**を遮る */
  function holeBlocked(table, x, y, h) {
    const T = BilliardsTable;
    const N = 12;
    for (let i = 1; i < N; i++) {
      const t = i / N;
      if (T.clearance(table, x + (h.x - x) * t, y + (h.y - y) * t) < 0) return true;
    }
    return false;
  }

  /**
   * ブラックホールの位置を1つ決める（6.8.1節・6.8.3節）。**共有シードから引く。**
   *
   * 制約には優先順位があり、満たせなければ**下位から順に緩める。**
   *   1. 玉との距離（緩めない。満たす位置が無ければ手順2で**代替する**）
   *   2. 中心は盤面の内側（緩めない）
   *   3. ポケットを完全に覆わない（緩めない）
   *   4. 固定障害物・バンパーと重ならない（緩める。★第3段階＝いまは台に存在しない）
   *   5. 可変地形と重ならない（緩める）
   *
   * ★**第1順位が絶対なのは、生成した瞬間に玉が動き出す事態を避けるため**である。
   *   静止球にも引力が働くので、玉のすぐ横に穴が開けば撞く前に盤面が勝手に変わる。
   */
  function drawHole(field, rng, table, balls) {
    const T = BilliardsTable;
    const keep = holeKeepAway(field);
    const live = (balls || []).filter(b => b && b.state === 'live');
    const terr = (field && field.game && field.game.terrain) || [];
    const cx = (table.center && table.center.x) || 0;
    const cy = (table.center && table.center.y) || 0;
    // 第2・第3順位。どちらも緩めない
    const hard = (x, y) => {
      if (T.clearance(table, x, y) <= 0) return false;
      for (const p of (table.pockets || [])) {
        /*
         * ★**部分的な重なりは許す**（6.8.3節）。ポケットの口の中心が地平線の外にあれば、
         *   口は見えているし投入も成立する。完全に覆うとポケットが盤面から消えたように見える。
         */
        if (Math.hypot(x - p.x, y - p.y) <= HOLE.horizon) return false;
      }
      return true;
    };
    const farFromBalls = (x, y) => {
      for (const b of live) if (Math.hypot(x - b.x, y - b.y) < keep) return false;
      return true;
    };
    const offTerrain = (x, y) => {
      for (const h of terr) {
        if (Math.hypot(x - h.x, y - h.y) < h.r * T.GOLF_BLOB_MAX + HOLE.horizon) return false;
      }
      return true;
    };
    /*
     * pass 0 … 第5順位まで全部満たす位置を探す
     * pass 1 … 第4・第5順位を緩める（重なりを許す。地形の物性はそのまま働く）
     * ★**引く回数は盤面によらず同じにしてある**（見つかったら抜けるので実際の消費は変わるが、
     *   どの道（本物・AIの読み・リプレイ・観戦）も同じ盤面から同じ順に引くので食い違わない）。
     */
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < HOLE.tries; i++) {
        const x = cx + (rng() * 2 - 1) * table.halfW;
        const y = cy + (rng() * 2 - 1) * table.halfH;
        if (!hard(x, y)) continue;
        if (!farFromBalls(x, y)) continue;
        if (pass === 0 && !offTerrain(x, y)) continue;
        return { x, y, relaxed: pass > 0 };
      }
    }
    /*
     * 手順2（6.8.3節）＝**第1順位を緩めるのではなく、代替する。**
     * 盤面全体を候補として「最も近い玉との距離が最大になる位置」を選ぶ。
     * ★乱数を引かない＝並べる順が決まっているので、どの道でも同じ位置になる。
     * ★ここまで来るのは、玉が多く残り、かつ台が狭い場合に限られる。
     *   それでも引力が静止摩擦を上回る玉が出たら、その玉はターン開始時から動き出す（D352）。
     *   吸われるか圏内で止まるかに落ち着くので、全球停止は成立する。
     */
    const [NX, NY] = HOLE.grid;
    let best = null, bestD = -1;
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const x = cx + ((i + 0.5) / NX * 2 - 1) * table.halfW;
        const y = cy + ((j + 0.5) / NY * 2 - 1) * table.halfH;
        if (!hard(x, y)) continue;
        let d = Infinity;
        for (const b of live) d = Math.min(d, Math.hypot(x - b.x, y - b.y));
        if (d > bestD) { bestD = d; best = { x, y, relaxed: true, fallback: true }; }
      }
    }
    /*
     * ★**「そのターンは発生させない」という扱いは採らない**（6.8.3節）。
     *   格子のどこも盤面の内側でない台は無いので、ここで null が返ることは無いはずだが、
     *   万一そうなったら中心へ寄せて置く。
     */
    if (best) return best;
    const c = T.clampInside ? T.clampInside(table, cx, cy, 0) : { x: cx, y: cy };
    return { x: c.x, y: c.y, relaxed: true, fallback: true };
  }

  /** いま台に開いている穴（画面と検査が見る）。無ければ null */
  function hole(field) { return (field && field.turn && field.turn.hole) || null; }

  /**
   * この玉は穴へ落ちたか（6.8.5節）。engine の落球判定から呼ぶ。
   *
   * ★**速度の大小は問わない。**地平線の外にとどまる限り、どれだけ強く引かれていても落ちない。
   * ★**空中の玉は落ちない**（引力も受けていない）。
   */
  function swallow(field, b, table) {
    const h = hole(field);
    if (!h || !b || b.z > 0.01) return false;
    if (Math.hypot(b.x - h.x, b.y - h.y) >= HOLE.horizon) return false;
    return !holeBlocked(table, b.x, b.y, h);
  }

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

  /*
   * ───────── 番号シャッフル（F-11）─────────
   *
   * やることは1つだけ＝**盤面に残っている的球の番号を入れ替える**（6.6.8節）。
   * ★**位置と速度は1ミリも触らない。**玉そのものが飛ぶわけではないので盤面の配置は保たれ、
   *   「さっきまで3番だった場所に9番がある」という混乱だけが残る。
   *
   * ★**入れ替わるのは番号だけではない。**このアプリでは**色も縞もグループも番号から決めている**
   *   （rules.js の玉を並べる処理）。番号だけを付け替えると、
   *   **見た目は3番のまま9番として数えられる玉**ができる＝画面と判定が食い違う。
   *   入れ替えるのは「番号から決まるものひとそろい」＝その玉の身分まるごとである。
   *   ★**id は入れ替えない。**id は同時衝突の解を決めるための物理側の背番号であって（5.6.5節）、
   *   遊ぶ側に見えている番号ではない。入れ替えると物理の答えが変わる。
   *
   * ★**ターン開始時にしか実行しない**（6.6.8節）。転がっている最中に番号が変われば、
   *   どの玉を落としたのかという判定そのものが不安定になる。
   */
  const SHUFFLE = {
    /**
     * 演出の長さ（秒。付録B送り）。玉は動かないので、これは見せるためだけの値。
     * ★**番号が玉から玉へ飛ぶところを見せる**ので、回るだけだった頃より長く取ってある
     * （利用者指示・第60セッション「派手な演出でシャッフルしていることを目立たせたい」）。
     */
    showSec: 1.6,
    /*
     * ★**引く回数を玉の数で変えない。**盤面に残っている数だけ引くと、
     *   玉が落ちて数が減った局面で**乱数列の進み方が変わり**、
     *   AIの読み・リプレイ・観戦の追いつきと食い違う（突風のばらつきと同じ話）。
     *   ラックは最大15球なので、いつも15個引いて先頭から使う。
     */
    draws: 15,
  };

  /**
   * 番号から決まるものひとそろい。**これを丸ごと入れ替える。**
   * ここへ足し忘れたものがあると、その項目だけ前の玉のまま取り残される。
   */
  const NUM_KEYS = ['num', 'color', 'stripe', 'grp'];

  /** シャッフルの対象になる玉（6.6.8節）。手玉・番号の無い玉・据え付けの物は入らない */
  function shuffleTargets(balls) {
    return (balls || []).filter(b => b && b.kind === 'object' && b.state === 'live'
      && !b.pinned && !b.hazard && b.num > 0);
  }

  /**
   * 番号を入れ替える（6.6.8節）。**範囲は全球**（利用者判断・付録B）。
   *
   * 入れ替えた中身は field.turn.shuffle へ控える（画面の演出と検査が見る）。
   * ★**先に必ず draws 個を引いてから**、対象が足りるかを見る。
   *   「対象が2球未満なら引かずに帰る」と書くと、**残り球数で乱数列の進み方が変わる。**
   * ★hold（最初の1巡が済んでいない）ときも**引いてから帰る。**同じ理由である。
   */
  function drawShuffle(field, rng, balls, hold) {
    const r = [];
    for (let i = 0; i < SHUFFLE.draws; i++) r.push(rng());
    if (hold) return null;
    const list = shuffleTargets(balls);
    if (list.length < 2) return null;
    const idx = list.map((b, i) => i);
    // Fisher–Yates。引いておいた値を先頭から使う（引く回数は上で固定してある）
    for (let i = idx.length - 1, k = 0; i > 0; i--, k++) {
      const j = Math.floor(r[k % r.length] * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    const before = list.map(b => {
      const o = {}; NUM_KEYS.forEach(key => { o[key] = b[key]; }); return o;
    });
    /*
     * ★**番号が「どこから来たか」も控える。**画面は番号が玉から玉へ飛ぶところを見せるので、
     *   行き先（その玉の場所）だけでなく**出どころの玉の場所**が要る。
     * ★**入れ替わる前の身分も控える。**飛んでくる番号が着くまでのあいだ、
     *   その玉は**前の姿のまま**でいなければならない（着く前に新しい番号が出ていると、
     *   飛んでいる番号と盤の番号が二重に見える）。
     */
    const moves = [];
    list.forEach((b, i) => {
      const src = before[idx[i]];      // この玉が受け取る身分
      const from = list[idx[i]];       // その身分がもと居た玉
      moves.push({
        id: b.id, x: b.x, y: b.y,
        srcId: from.id, srcX: from.x, srcY: from.y,
        from: before[i].num, to: src.num,
        was: { num: before[i].num, color: before[i].color, stripe: before[i].stripe },
      });
      NUM_KEYS.forEach(key => { b[key] = src[key]; });
    });
    return { moves, changed: moves.some(m => m.from !== m.to) };
  }

  /** いま見せるべき入れ替え（画面の演出と検査が見る）。無ければ null */
  function shuffle(field) { return (field && field.turn && field.turn.shuffle) || null; }

  /*
   * ───────── テレポートポケット（B-08）─────────
   *
   * 一方のポケットへ入った玉を、対になったもう一方から**盤面へ射出する**（6.6.9節）。
   *
   * ★**ポケットインとみなさない。手玉が入ってもファウルにならない。**
   *   落球の出来事（pocket）を作らなければ、ルール側は何も知らないまま通り過ぎる
   *   ＝rules.js に「テレポなら〜」という分岐を1つも書かずに済む。
   *   ブラックホールが**既にある場外の処理をそのまま通した**のと同じ形である。
   * ★**射出の向きは出口が盤面へ開いている向き。入射の向きは反映しない**（6.6.9節）。
   *   鏡のように返すと、壁の内部へ向かう射出が生まれる。
   * ★**速さはそのまま。**減らせば「一度落ちた」ことになり、増やせば
   *   テレポを狙うだけで球速が稼げてしまう。
   */
  const WARP = {
    /** 出口の玉を置く距離＝ポケットの口の半径 ＋ 玉の半径の何倍か（付録B送り） */
    gap: 1.3,
    /** 出口の向きを探す刻み数。台の形だけから決まるので乱数は引かない */
    dirs: 72,
  };

  /**
   * そのポケットが盤面へ開いている向きと、玉を出す場所（6.6.9節）。
   *
   * ★**台定義データはポケットの向きを持っていない**（位置と口径だけ）。
   *   長方形なら「台の中心のほう」で足りるが、**ドーナツ型は中心が壁の中**にあり、
   *   L字型では角のポケットの中心方向が壁を向く。
   *   そこで**外周からの余裕（clearance）がいちばん大きくなる向き**を探す
   *   ＝どの形でも「盤面が開いているほう」を指す。
   * ★**隣のポケットの口には出さない**（角どうしが近い台では、出た瞬間にそちらへ落ちる）。
   * ★乱数を引かない。台の形だけから決まるので、どの道でも必ず同じ向きになる。
   */
  function pocketMouth(table, p) {
    const T = BilliardsTable, R = T.R;
    const other = (table.pockets || []).filter(q => q !== p && q.id !== p.id);
    let best = null;
    for (let s = 0; s < 5; s++) {
      const L = p.r + R * (WARP.gap + s * 0.8);
      let round = null;
      for (let i = 0; i < WARP.dirs; i++) {
        const th = i / WARP.dirs * Math.PI * 2;
        const dx = Math.cos(th), dy = Math.sin(th);
        const x = p.x + dx * L, y = p.y + dy * L;
        let near = false;
        for (const q of other) if (Math.hypot(x - q.x, y - q.y) < q.r + R * 0.5) { near = true; break; }
        if (near) continue;
        const c = T.clearance(table, x, y);
        if (!round || c > round.c) round = { c, x, y, dx, dy, dist: L };
      }
      if (round && (!best || round.c > best.c)) best = round;
      if (best && best.c >= R * 1.05) break;      // 玉が収まる場所が見つかった
    }
    if (best) return best;
    /*
     * ここへ来るのは、ポケットの周りが**どの向きも壁**という台だけである（いまは無い）。
     * それでも null を返さない ── 返すと**そのポケットだけ静かにふつうの落球に戻り**、
     * 「入ったのに出てこない」という食い違いになる。台の中心へ向けて出す。
     */
    const cx = (table.center && table.center.x) || 0;
    const cy = (table.center && table.center.y) || 0;
    const a = Math.atan2(cy - p.y, cx - p.x);
    const L = p.r + R * WARP.gap;
    return { c: 0, x: p.x + Math.cos(a) * L, y: p.y + Math.sin(a) * L,
      dx: Math.cos(a), dy: Math.sin(a), dist: L, fallback: true };
  }

  /**
   * テレポートポケットの対を1組引く（6.6.9節）。**ターン開始ごとに引き直す。**
   *
   * ★**ルールが意味を与えているポケットは対から外す**（利用者判断・付録B「対の抽選範囲」）。
   *   ゴルフ型の指定ポケットを対に入れると、**そのターンはカップが塞がって沈めようがなくなり**、
   *   打ち切りの倍率と重なって運だけで大叩きになる。
   * ★**引く回数は盤面によらず必ず2つ。**外したあとの個数で引く回数を変えない。
   */
  function drawWarp(field, rng, table, reserved) {
    const u = rng(), v = rng();
    const skip = reserved || [];
    const pool = (table.pockets || []).filter(p => skip.indexOf(p.id) < 0);
    if (pool.length < 2) return null;
    const i = Math.min(pool.length - 1, Math.floor(u * pool.length));
    let j = Math.min(pool.length - 2, Math.floor(v * (pool.length - 1)));
    if (j >= i) j++;
    return { a: pool[i].id, b: pool[j].id };
  }

  /** いま繋がっているポケットの対（画面と検査が見る）。無ければ null */
  function warpPair(field) { return (field && field.turn && field.turn.warp) || null; }

  /** そのポケットの相方。テレポの口でなければ null */
  function warpPartner(field, id) {
    const w = warpPair(field);
    if (!w || id == null) return null;
    if (w.a === id) return w.b;
    if (w.b === id) return w.a;
    return null;
  }

  /**
   * その玉はテレポートポケットを通り抜けたか（6.6.9節）。engine の落球判定から呼ぶ。
   *
   * 通り抜けるなら**出口での位置と速度**を返し、そうでなければ null（＝ふつうに落ちる）。
   * ★engine 側にポケットの対も出口の向きも持たせない。持たせると、
   *   抽選のしかたを変えた日に**片方だけ古くなる**（穴の引力を1か所から出したのと同じ話）。
   */
  function warp(field, b, table, pocket) {
    const to = warpPartner(field, pocket && pocket.id);
    if (to == null || !b) return null;
    const exit = (table.pockets || []).filter(p => p.id === to)[0];
    if (!exit) return null;
    const m = pocketMouth(table, exit);
    const sp = Math.hypot(b.vx, b.vy);      // ★速さはそのまま。向きだけ出口のものへ変える
    return { from: pocket.id, to, x: m.x, y: m.y, vx: m.dx * sp, vy: m.dy * sp, dx: m.dx, dy: m.dy };
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
    // 突風も同じ理由で1つ用意しておく（AIが「風の無い盤面」を読まないように）
    if (field.has('F-06')) field.shot.gust = drawGust(rng);
    const table = ctx && ctx.table;
    if (!table) return;
    field.game.terrain = placeTerrain(field, rng, table);
    field.game.flooded = floodedPockets(field, table);
  }

  /**
   * ターン開始時（そのターンだけのもの＝ブラックホール・テレポの対・番号シャッフル）。
   *
   * ★**同じ番で二度引かない。**手番を始め直す道（デッドロックの否決など）でここが二度呼ばれても、
   *   盤面が変わらないようにしておかないと乱数列が食い違う。鍵（key）は手番の番号。
   * ★**盤面を組み直したときだけは引き直す**（force）。盤が変われば玉の位置が変わるので、
   *   前の盤に合わせて置いた穴は玉の上に乗る＝ターン開始時から玉が吸われ始める。
   */
  function beginTurn(field, rng, ctx) {
    if (!field) return;
    const key = ctx && ctx.key;
    const force = !!(ctx && ctx.force);
    if (!force && key != null && field.turn && field.turn.key === key) return;
    field.turn = { key };
    const table = ctx && ctx.table;
    if (!table) return;
    /*
     * 玉は2つの出どころから来る ── 盤面を組んだ直後は組み上がった玉の配列、
     * 手番送りのときは今の盤面。**どちらも「玉が止まっている時点」である。**
     */
    const balls = (ctx && ctx.balls)
      || (ctx && ctx.game && ctx.game.world && ctx.game.world.balls)
      || [];
    if (field.has('F-05')) field.turn.hole = drawHole(field, rng, table, balls);
    if (field.has('B-08')) field.turn.warp = drawWarp(field, rng, table, ctx && ctx.reserved);
    /*
     * ★**番号シャッフルは最後に置く。**ここだけが玉そのものを書き換えるので、
     *   前の2つ（穴の位置・テレポの対）が「入れ替わる前の番号」を見て決めることは無い。
     * ★入れ替えの回数を数えて控える。画面は**この番号が変わった時だけ**演出を出す
     *   （盤面を組み直す道ではターンの鍵が同じまま二度通るので、鍵では見分けられない）。
     */
    /*
     * ★**全員が1度ずつ撞き終わるまでは入れ替えない**（利用者指示・第60セッション）。
     *
     *   ナインボールやローテーションのブレイクは「いちばん小さい番号へ最初に当てる」決まりなので、
     *   ラックの番号が入れ替わると**1番がラックの中に埋まり、当てようがなくなる。**
     *   ★**「1手目だけ」では足りない。**先攻がブレイクを終えても、後攻がまだ一度も撞いていない。
     *   そこで**撞いた席を数え、全員がそろってから**入れ替え始める。
     *
     * ★**数えるのは「この手番が始まる前まで」**である。いま始まる席を先に数えてしまうと、
     *   最後の1人の**最初の手番で**もう入れ替わってしまう。
     * ★**入れ替えない回でも乱数は引く**（下の drawShuffle は必ず通す）。
     *   引かずに帰ると、そこから先の乱数列の進み方が変わる。
     */
    if (field.has('F-11')) {
      field.seatsSeen = field.seatsSeen || {};
      /*
       * ★**人数が渡らなかったときは「巡り終わった」側に倒す**（[[見張りは忘れたとき軽いほうへ]]）。
       *   倒す向きを逆にすると、渡し忘れた道では**ギミックが黙って何もしなくなる。**
       *   渡し忘れそのものは検査で見張ってある（rules の呼び出し2か所）。
       */
      const seats = (ctx && ctx.seats) || 0;
      const lapDone = !seats || Object.keys(field.seatsSeen).length >= seats;
      if (ctx && ctx.seat != null) field.seatsSeen[ctx.seat] = 1;
      const s = drawShuffle(field, rng, balls, !lapDone);
      if (s) {
        field.shuffleSeq = (field.shuffleSeq || 0) + 1;
        s.seq = field.shuffleSeq;
        field.turn.shuffle = s;
      }
    }
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

  /**
   * 風の向きを1つ引く（6.6.5節）。
   * ★**全方位から連続で引く。**地震と同じ理由で、傾きのように8方位へ丸めない。
   *   丸めるのは「この台は右下へ転がりやすい」と覚えて使う対象だからであって、
   *   **突風は毎ショットの事故で、覚える対象ではない。**
   */
  function drawGust(rng) {
    const dir = rng() * Math.PI * 2;
    /*
     * ★**玉ごとの受け方をここで引いておく。**全球がまったく同じ量動くと、
     *   ラックが隅形を保ったまま丸ごと滑って不自然に見える（利用者指摘）。
     * ★**引く個数は玉の数によらず固定。**盤面に残っている玉の数だけ引くと、
     *   玉が落ちて数が減った局面で**乱数列の進み方が変わり**、
     *   AIの読み・リプレイ・観戦の追いつきと食い違う。
     */
    const vary = [];
    for (let i = 0; i < GUST.varyCount; i++) vary.push(1 + (rng() * 2 - 1) * GUST.spread);
    return { dir, dx: Math.cos(dir), dy: Math.sin(dir), vary };
  }

  /** ショット開始時（そのショットだけのもの＝地震の向き・突風の向きと遅れ） */
  function beginShot(field, rng, ctx) {
    if (!field) return;
    field.shot = {};
    if (field.has('F-01')) field.shot.quake = drawQuake(rng);
    if (field.has('F-06')) field.shot.gust = drawGust(rng);
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
    /*
     * F-05 ブラックホール（6.6.4節）。**盤面に接している玉を、中心へ向かって引く。**
     *
     * ★条件は**静止球を外さない**（6.2.3節の例外。穴はターンが終われば消える）。
     *   ここで速度を見て外すと、「穴の近くにある玉は、触れたら吸われる」という盤面が
     *   「撞いた玉しか吸われない」に変わり、ギミックが別物になる。
     * ★**空中の玉は外す**（D192）。ジャンプショットが回避手段になるのはこの1行の帰結である。
     * ★**加速度である**（突風とは違って dt を掛ける）。一瞬の出来事ではなく、
     *   ターンのあいだ鳴り続けている引力なので、時間ぶんだけ効く。
     * ★静止している玉が動き出すかどうかは、ここでは判定しない。
     *   停止判定（engine の STOP_V）が静止摩擦の役をしていて、
     *   引力が弱ければ足した速度はその刻みの末尾で0へ戻される（holeKeepAway の注記）。
     */
    const hl = hole(field);
    if (hl && b.z <= 0.01) {
      const dx = hl.x - b.x, dy = hl.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const a = holeAccel(field, d);
        if (a > 0) {
          b.vx += dx / d * a * dt;
          b.vy += dy / d * a * dt;
          done = true;
        }
      }
    }
    /*
     * F-06 突風（6.6.5節）。**その1刻みだけ、全球へ同じ向きの速度を足す。**
     *
     * ★**条件を書かない**のがこのギミックの中身である。
     *   b.z を見ない … 空中の玉にも効く（D192。8種のうち突風だけ）
     *   速度を見ない … 静止球も動かす（6.2.3節の例外。一瞬で終わるのでターンは終わる）
     *   地震・傾きから条件をうつしてくると、突風でなくなる。
     *
     * ★**dt を掛けない。**加える速度そのものであって、加速度ではない（D203・「一瞬・一回限り」）。
     * ★**吹くのは「ショットの時計がこの値ちょうど」の1刻みだけ。**
     *   「もう吹いたか」の印を持たせない。印は複製（AIの読み・リプレイ・観戦の追いつき）に
     *   引き継がせる必要が出て、1本でも漏れればその道だけ風が2回吹く。
     *   時計の値で決めておけば、どの道でも同じ1刻みで1回だけ吹く。
     */
    const gu = field.shot.gust;
    if (gu && table) {
      /*
       * ★**風の前線とすれ違った刻み**にだけ速度を足す。
       *   前線の位置と玉の位置を風軸上で比べ、
       *   **1つ前の刻みではまだ向こう側だった**ものを拾う。
       *
       * ★**「もう受けたか」の印を持たないのは前と同じ。**
       *   印を持つと世界の複製へ引き継ぐ必要が出、
       *   盤面を進める5本の道のどれかで漏れればその道だけ風が2回吹く。
       *
       * ★**すれ違いが必ず1回だけになるのは、前線が玉より速いからである**
       *   （GUST.front の注記）。前線が遅いと、風下へ走る玉が逃げ続けて
       *   一度も受けないか、クッションで戻って二度目を受ける。
       *
       * ★条件を書かないのは前と同じである。
       *   b.z を見ない … 空中の玉にも効く（D192。8種のうちここだけ）
       *   速度を見ない … 静止球も動かす（6.2.3節の例外）
       */
      const now = gustFront(field, shotTick, table);
      if (now !== null) {
        const s = gustAxis(gu, b.x, b.y);
        const vs = gustAxis(gu, b.vx, b.vy);          // 玉の、風の向きの速さ
        if (now >= s && now - GUST.front * dt < s - vs * dt) {
          const v = GUST.speed * (field.apocalypse ? GUST.apo : 1) * gustVary(gu, b);
          b.vx += gu.dx * v;
          b.vy += gu.dy * v;
          done = true;
        }
      }
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
    ALL_IDS, DOOR, IDS, PICK_MAX, TERRAIN, TILT, QUAKE, GUST, HOLE, SHUFFLE, WARP,
    CLOTH_SLIDE, CLOTH_ROLL,
    blockOf, available, pickMax, create,
    beginGame, beginTurn, beginShot, apply,
    patches, terrain, terrainAt, floodedPockets, tilt,
    hole, holeAccel, holeKeepAway, holeBlocked, swallow,
    shuffle, shuffleTargets, NUM_KEYS,
    warpPair, warpPartner, warp, pocketMouth,
    quakeLevel, quakeWander, quakeAccel, quakeShift, quakeJitter,
    gustTick, gustAxis, gustStart, gustFront, gustVary, gustStreaks,
  };
})();

if (typeof window !== 'undefined') window.BilliardsField = BilliardsField;
