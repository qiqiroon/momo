// MOMO Life — 説明の文（セッション10）。タイトルの「ライフゲームとは」と、観察の画面の「説明」で開く
// 仕組み（GPU・乱数など）の話はせず、ライフゲームとして何が起きているかだけを書く
export const HELP = {
  ja: {
    life: { title: 'ライフゲームとは', html: `
<p>ライフゲームは、1970 年に数学者ジョン・コンウェイが考えた、マス目の上の「生き物」の遊びです。プレイヤーは最初に生き物を置くだけで、あとは決まりに従って世代が進むのを眺めます。</p>
<h3>もとの決まり</h3>
<ul>
<li>どのマスも「生きている」か「空」のどちらかです。</li>
<li>次の世代は、周りの 8 マスにいる生き物の数だけで決まります。</li>
<li><b>誕生</b>：空のマスは、周りにちょうど 3 つ生き物がいると、生き物が生まれます。</li>
<li><b>生存</b>：生き物は、周りに 2 つか 3 ついれば生き残ります。</li>
<li><b>死</b>：それより少なければ過疎で、多ければ過密で消えます。</li>
</ul>
<p>この決まりは「B3/S23」と書きます（B＝生まれる数、S＝生き残る数）。単純な決まりなのに、止まる形（ブロック）、点滅する形（ブリンカー）、斜めに歩いていく形（グライダー）など、思いがけない動きが次々に現れます。</p>
<h3>MOMO Life はそれを広げたもの</h3>
<ul>
<li><b>種族がいくつもいる</b>：色の違う種族が同じ盤に住み、種族ごとに生まれる数・生き残る数が違います。</li>
<li><b>食べ合う</b>：決まった相手の生き物を囲むと、その相手を食べて自分の種族に変えます。</li>
<li><b>マザー</b>：盤を旅しながら、自分の種族の生き物をまいていく存在です。どんな形でまくと仲間が増えるかを学びます。</li>
<li><b>種族が生まれ、入れ替わる</b>：新しい種族が次々に生まれ、弱い種族はルールを変えられます。</li>
</ul>
<p>「自由編集モード」を開くと、最初はもとのライフゲーム（B3/S23）の 1 種族だけの盤になっています。そこから種族を足したり、決まりを書きかえたりして遊べます。</p>` },
    chain: { title: '連鎖して増える', html: `
<h3>何が起きているか</h3>
<ul>
<li><b>はじまり</b>：空の盤に、もとのライフゲーム（B3/S23）の種族 G1 と、そのマザーが 1 つだけいます。</li>
<li><b>マザー</b>：盤の上を長い距離旅しながら、ときどき自分の種族の「置き形」（16×16 マスの形）を足もとに置いていきます。</li>
<li><b>種族が増える</b>：2,000 世代ごとに、新しい種族とそのマザーが 1 つずつ生まれ、32 種まで増えます。盤が狭いときは、全マザーの支配領域を合わせた広さが盤の 1/3 以下になるように種族の上限を減らします（4 以上なら 4 の倍数。たとえば 640×360 の盤は 4 種、1280×720 の盤は 28 種）。新しい種族のルールはくじで決まります（生まれる数 1 つ、生き残る数 2 つ、食べる数 1 つ）。</li>
</ul>
<h3>ルールの読み方（例 B3S23E2）</h3>
<p>周りの 8 マスに仲間が 3 つで生まれ（B3）、2 つか 3 つで生き残り（S23）、獲物のマスの周りに自分がちょうど 2 ついれば食べます（E2）。</p>
<h3>食べ合い</h3>
<p>種族は色で 4 つの組に分かれます：緑 G・青 B・赤紫 M・黄 Y。緑は青を、青は赤紫を、赤紫は黄を、黄は緑を食べます。獲物のマスの周りに食べる側がちょうど E の数だけいると、そのマスは食べた種族に変わります。名前の数字は、同じ色の組の中で生まれた順番です（G1、G2 …）。</p>
<h3>支配領域</h3>
<p>マザーの周りの円の中では、そのマザーの種族しか生きられません。ほかの種族はその中に入ると消えます。</p>
<h3>学習（置き形の組み換え）</h3>
<p>マザーは置き形を試しては、置いたあとに周りに自分の種族がどれだけ残り、増えたかで点を付けます。いちばん良い形の 1〜3 マスを入れ替えた形や、まったく新しい形を試し、何度か続けて良ければ入れ替えます。長く負け続けると、その形で固定します。</p>
<h3>ルールの引き直し</h3>
<p>32 種そろったあと、2,000 世代ごとに弱い種族のルールを引き直します。いなくなった種族と、支配領域を自分の種族で埋められない種族が先です。どちらもいなければ、いちばん数の多い色の組を食べる組の弱い 4 種と、全体で少ない 4 種を引き直します（ルールを持ってから 10,000 世代たった種族だけ。種族の上限を減らした盤では、この 4 も同じ割合で減らし、少なくとも 1 は残します）。ただし、盤にいる数が多いほうの半分の種族（4 種なら 1 位と 2 位）は、この 2 つの決まりでは選びません。G1 のルールは変わりません。</p>
<h3>状態の表</h3>
<p>横が色の組、縦が番号です。種族ごとに、ルール・盤にいる数・学習の回数（回）・良い形に入れ替えた数（勝）・固定したか、を出します。「強い順」を入れると、色の組の中を数の多い順に並べます。</p>
<h3>マザーの働き</h3>
<ul>
<li><b>マザーを出す</b>：外すとマザーが消え、置き形も支配領域もなくなります。入れ直すと、いたところから再び動きます。</li>
<li><b>学習（組み換え）</b>：外すと、いまのいちばん良い形のまま置き続けます。</li>
<li><b>支配領域</b>：外すと、マザーの周りでもほかの種族が生きられます。</li>
<li><b>ルールの引き直し</b>：外すと、弱い種族のルールを変えません。</li>
<li><b>マザーの値を保存・読み出し</b>：種族ごとのルールと、マザーの位置・覚えた形をファイルにします。読み出すと、いまの世界の同じ名前の種族に入れます（まだ生まれていない種族は、生まれたときに入ります）。</li>
</ul>` },
    four: { title: '4種族', html: `
<h3>4 つの種族</h3>
<ul>
<li><b>緑</b>：B3/S23（もとのライフゲーム）</li>
<li><b>水色</b>：B36/S23（6 でも生まれる。自分の写しを作る形がある）</li>
<li><b>桃</b>：B368/S245（3・6・8 で生まれ、2・4・5 で生き残る）</li>
<li><b>黄</b>：B36/S125（2×2 の小さな塊で増えやすい）</li>
</ul>
<h3>食べ合い（じゃんけん）</h3>
<p>緑は桃を、桃は水色を、水色は緑を食べます。生き物の周りに天敵が 2 つ以上いると食べられて消え、そのマスでは食べた種族が先に生まれる番を持ちます。黄は誰も食べず、誰にも食べられません。</p>
<h3>マザー</h3>
<p>最初は各種族に 3 つずつ、合わせて 12 のマザーが盤を旅し、自分の種族の置き形を置きながら、仲間が増える形を学びます。この世界には支配領域はありません。マザーの数と置き方（空のマスだけに置くか、上書きするか）は下の欄で変えられます。</p>
<h3>状態の表</h3>
<p>種族ごとに、盤にいる数・学習の回数（回）・良い形に入れ替えた数（勝）を出します。「強い順」を入れると数の多い順に並べます。</p>` },
    free: { title: '自由編集モード', html: `
<p>空の盤に、自分で生き物を置き、種族ごとの決まりを書いて動かす世界です。最初はもとのライフゲーム（B3/S23）の 1 種族です。</p>
<h3>盤の操作</h3>
<ul>
<li><b>動かす・置く・消す</b>：マウスの働きを選びます。「置く」は表で選んだ種族を置きます。ホイールで拡大・縮小、「動かす」でドラッグすると盤を動かせます。</li>
<li><b>ランダムに配置</b>：使う種族で盤をでたらめに埋めます。<b>全部消す</b>：盤を空にします。</li>
<li><b>1世代</b>：止めて 1 世代だけ進めます（キーボードの「.」でも）。<b>一時停止・再開</b>はスペースキーでも。</li>
<li><b>保存・読み出し</b>：盤の様子と種族の表（決まり・色・発生で覚えた形）をファイルにします。読み出すと、その盤の大きさで作り直して続きから始めます。</li>
</ul>
<h3>種族の表（左から）</h3>
<ul>
<li><b>色と文字</b>：押すと、その種族を置けるようにします。文字（A・B …）は式の中でその種族を指す名前です。</li>
<li><b>使う</b>：外すと、その種族は生まれも生き残りもしなくなります（盤にいるものは次の世代で消えます）。</li>
<li><b>生まれる</b>：空のマスにこの種族が生まれる条件。例「3」＝周りに自分の種族がちょうど 3 つ。「36」＝3 つか 6 つ。</li>
<li><b>生き残る</b>：この種族の生き物が次の世代も残る条件。例「23」＝2 つか 3 つ。</li>
<li><b>食べる</b>：相手を食べる条件。相手のマスの周りで数えます。例「A&gt;=2」＝相手の周りに A が 2 つ以上。空なら食べません。</li>
<li><b>食べる相手</b>：食べてよい種族の文字。例「B」「BC」「B-D」（B から D）「?」（だれでも）。</li>
<li><b>発生</b>：入れると、空いた場所に形を 1 つ置き、数が落ち着いたら次を置き続けます。長く続いた形を 4 つ覚えて、覚えた形 4 つ → でたらめな形 4 つの順に置きます。「最長」は覚えた形が落ち着くまでの世代です。</li>
</ul>
<h3>式の書き方</h3>
<ul>
<li>数字だけ（例「23」）なら、周りにいる自分の種族の数。</li>
<li>A・B …＝その種族の数、A+B＝合計、?＝すべての種族の数。</li>
<li>比べ方は = != &lt; &lt;= &gt; &gt;=、つなぎは AND・OR・かっこ。例「A=3 AND B&lt;2」。</li>
<li>書き間違えると欄が赤くなり、直るまでは前の正しい決まりで動き続けます。</li>
</ul>` },
  },
  en: {
    life: { title: 'What is the Game of Life?', html: `
<p>The Game of Life is a grid of “creatures” devised by the mathematician John Conway in 1970. You only place the first creatures; after that you watch the generations unfold by fixed rules.</p>
<h3>The original rules</h3>
<ul>
<li>Every cell is either alive or empty.</li>
<li>The next generation depends only on how many live creatures are among the 8 neighbouring cells.</li>
<li><b>Birth</b>: an empty cell with exactly 3 live neighbours gets a new creature.</li>
<li><b>Survival</b>: a creature with 2 or 3 live neighbours survives.</li>
<li><b>Death</b>: with fewer it dies of loneliness, with more of overcrowding.</li>
</ul>
<p>These rules are written “B3/S23” (B = birth counts, S = survival counts). Such simple rules produce surprising things: still shapes (block), blinking shapes (blinker), and shapes that walk diagonally across the board (glider).</p>
<h3>MOMO Life extends it</h3>
<ul>
<li><b>Many species</b>: species of different colours share the board, each with its own birth and survival counts.</li>
<li><b>Eating</b>: surround a creature of a certain species and you eat it, turning it into your own species.</li>
<li><b>Mothers</b>: travellers that sow creatures of their species across the board and learn which patterns make their species grow.</li>
<li><b>Species appear and change</b>: new species keep appearing, and weak species get new rules.</li>
</ul>
<p>Free edit mode starts with a single species following the original Game of Life (B3/S23). From there you can add species and rewrite the rules.</p>` },
    chain: { title: 'Chain of species', html: `
<h3>What happens</h3>
<ul>
<li><b>Start</b>: an empty board with species G1, which follows the original Game of Life (B3/S23), and its single mother.</li>
<li><b>Mothers</b>: each mother travels long distances across the board and now and then drops its species’ pattern (a 16×16 shape).</li>
<li><b>More species</b>: every 2,000 generations a new species and its mother appear, up to 32. On a small board the limit is lowered so that all the mothers’ domains together cover at most 1/3 of the board (a multiple of 4 when it is 4 or more; e.g. 4 species on 640×360, 28 on 1280×720). A new species gets random rules (one birth count, two survival counts, one eating count).</li>
</ul>
<h3>Reading a rule (e.g. B3S23E2)</h3>
<p>Born with 3 of its own among the 8 neighbours (B3), survives with 2 or 3 (S23), and eats when exactly 2 of its own surround a prey cell (E2).</p>
<h3>Eating</h3>
<p>Species fall into 4 colour groups: green G, blue B, magenta M and yellow Y. Green eats blue, blue eats magenta, magenta eats yellow, and yellow eats green. When exactly E of the eaters surround a prey cell, that cell becomes the eater’s species. The number in a name is the order of birth within its colour group (G1, G2 …).</p>
<h3>Domain</h3>
<p>Inside the circle around a mother, only that mother’s species can live. Other species vanish when they enter it.</p>
<h3>Learning (recombining patterns)</h3>
<p>A mother tries patterns and scores each one by how many of its species remain and grow around it afterwards. It tries the best pattern with 1–3 cells flipped, or a brand-new pattern, and adopts it if it wins several times in a row. After losing for a long time, it settles on its pattern.</p>
<h3>Redrawing rules</h3>
<p>Once all 32 species exist, every 2,000 generations weak species get new rules. Species that died out and species that cannot fill their domain go first. If there are none, the 4 weakest of the group that eats the most numerous colour group and the 4 rarest species overall are redrawn (only those that have kept their rules for 10,000 generations; on a board with a lowered species limit, these 4 shrink in proportion, but at least 1 remains). Species in the more numerous half of the board (1st and 2nd of 4) are never chosen by these two rules. G1 never changes.</p>
<h3>Status table</h3>
<p>Columns are colour groups, rows are numbers. For each species you see its rule, its count on the board, learning tries, wins (times a better pattern was adopted) and whether it is fixed. “Strongest first” sorts each colour group by count.</p>
<h3>Mother controls</h3>
<ul>
<li><b>Show mothers</b>: off removes the mothers, their patterns and their domains. Turn it back on and they continue from where they were.</li>
<li><b>Learning</b>: off keeps planting the current best pattern.</li>
<li><b>Domain</b>: off lets other species live around mothers.</li>
<li><b>Redraw rules</b>: off keeps every species’ rules.</li>
<li><b>Save / load mothers</b>: writes each species’ rule and its mother’s position and learned pattern to a file. Loading applies them to the species with the same name in the current world (species not yet born receive them when they appear).</li>
</ul>` },
    four: { title: 'Four species', html: `
<h3>The four species</h3>
<ul>
<li><b>Green</b>: B3/S23 (the original Game of Life)</li>
<li><b>Cyan</b>: B36/S23 (also born with 6; has a self-copying pattern)</li>
<li><b>Pink</b>: B368/S245 (born with 3, 6 or 8; survives with 2, 4 or 5)</li>
<li><b>Yellow</b>: B36/S125 (spreads easily in small 2×2 clumps)</li>
</ul>
<h3>Eating (rock-paper-scissors)</h3>
<p>Green eats pink, pink eats cyan, and cyan eats green. A creature with 2 or more predators around it is eaten and vanishes, and the predator gets the first chance to be born in that cell. Yellow eats nobody and is eaten by nobody.</p>
<h3>Mothers</h3>
<p>At first 12 mothers, 3 per species, travel the board, planting their species’ pattern and learning which patterns make it grow. This world has no domains. You can change the number of mothers and how they sow (empty cells only, or overwrite) below.</p>
<h3>Status table</h3>
<p>For each species you see its count, learning tries and wins. “Strongest first” sorts by count.</p>` },
    free: { title: 'Free edit', html: `
<p>A world where you place creatures on an empty board and write each species’ rules yourself. You start with one species following the original Game of Life (B3/S23).</p>
<h3>Board controls</h3>
<ul>
<li><b>Move / Draw / Erase</b>: choose what the mouse does. Draw places the species selected in the table. Zoom with the wheel; drag in Move to pan.</li>
<li><b>Random fill</b>: fills the board randomly with the species in use. <b>Clear</b>: empties the board.</li>
<li><b>1 gen</b>: pauses and advances one generation (also the “.” key). Space pauses and resumes.</li>
<li><b>Save / Load</b>: writes the board and the species table (rules, colours, spawn patterns) to a file. Loading rebuilds the board at that size and continues from there.</li>
</ul>
<h3>Species table (left to right)</h3>
<ul>
<li><b>Colour and letter</b>: click to draw with that species. The letter (A, B …) names the species in expressions.</li>
<li><b>On</b>: off means the species is neither born nor survives (those on the board vanish next generation).</li>
<li><b>Born</b>: condition for this species to be born in an empty cell. “3” = exactly 3 of its own around; “36” = 3 or 6.</li>
<li><b>Survives</b>: condition for a creature of this species to stay. “23” = 2 or 3.</li>
<li><b>Eats</b>: condition for eating, counted around the prey cell. “A&gt;=2” = 2 or more A around the prey. Empty means it never eats.</li>
<li><b>Prey</b>: letters of the species it may eat: “B”, “BC”, “B-D” (B to D), “?” (anyone).</li>
<li><b>Spawn</b>: when on, places one pattern in an empty spot and the next once the count settles. It remembers the 4 longest-lived patterns and plants 4 remembered then 4 random ones. “Best” shows how many generations the remembered patterns took to settle.</li>
</ul>
<h3>Writing expressions</h3>
<ul>
<li>Digits alone (e.g. “23”) count your own species around.</li>
<li>A, B … = that species, A+B = sum, ? = all species.</li>
<li>Compare with = != &lt; &lt;= &gt; &gt;=, combine with AND, OR and brackets, e.g. “A=3 AND B&lt;2”.</li>
<li>A mistake turns the field red; until it is fixed, the last correct rules keep running.</li>
</ul>` },
  },
  zh: {
    life: { title: '什么是生命游戏', html: `
<p>生命游戏是数学家约翰·康威在 1970 年设计的、在格子上的“生物”游戏。玩家只需放下最初的生物，之后按照固定的规则观看一代代的变化。</p>
<h3>原本的规则</h3>
<ul>
<li>每个格子不是“活着”就是“空的”。</li>
<li>下一代只由周围 8 格中活着的生物数量决定。</li>
<li><b>诞生</b>：空格周围正好有 3 个生物时，诞生一个生物。</li>
<li><b>存活</b>：生物周围有 2 个或 3 个时存活。</li>
<li><b>死亡</b>：少于这个数会因孤单而消失，多于这个数会因拥挤而消失。</li>
</ul>
<p>这条规则写作“B3/S23”（B＝诞生的数量，S＝存活的数量）。规则虽然简单，却会不断出现意想不到的图案：静止的方块、闪烁的信号灯、斜着走动的滑翔机等。</p>
<h3>MOMO Life 扩展了它</h3>
<ul>
<li><b>多个物种</b>：不同颜色的物种住在同一个棋盘上，每个物种诞生和存活的数量都不同。</li>
<li><b>互相捕食</b>：包围特定物种的生物，就能吃掉它，把它变成自己的物种。</li>
<li><b>母体</b>：在棋盘上旅行、播撒自己物种生物的存在。会学习用什么图案播撒能让同伴增多。</li>
<li><b>物种诞生与更替</b>：新物种不断诞生，弱小物种的规则会被改变。</li>
</ul>
<p>打开“自由编辑”，最初是只有原本生命游戏（B3/S23）一个物种的棋盘。可以从这里增加物种、改写规则来玩。</p>` },
    chain: { title: '连锁增长', html: `
<h3>发生了什么</h3>
<ul>
<li><b>开始</b>：空棋盘上只有遵循原本生命游戏（B3/S23）的物种 G1 和它的一个母体。</li>
<li><b>母体</b>：在棋盘上长距离旅行，不时在脚下放下自己物种的“放置图案”（16×16 格的形状）。</li>
<li><b>物种增加</b>：每 2,000 代诞生一个新物种和它的母体，最多 32 种。棋盘较小时，会减少物种上限，使所有母体的领域合计不超过棋盘面积的 1/3（4 以上时取 4 的倍数。例如 640×360 的棋盘为 4 种，1280×720 为 28 种）。新物种的规则靠抽签决定（诞生数 1 个、存活数 2 个、捕食数 1 个）。</li>
</ul>
<h3>规则的读法（例 B3S23E2）</h3>
<p>周围 8 格有 3 个同伴时诞生（B3），有 2 个或 3 个时存活（S23），猎物格周围正好有 2 个自己时吃掉它（E2）。</p>
<h3>互相捕食</h3>
<p>物种按颜色分成 4 组：绿 G、蓝 B、紫红 M、黄 Y。绿吃蓝，蓝吃紫红，紫红吃黄，黄吃绿。猎物格周围捕食方正好有 E 个时，该格变成捕食方的物种。名字里的数字是在同一颜色组中诞生的顺序（G1、G2 …）。</p>
<h3>领域</h3>
<p>在母体周围的圆内，只有该母体的物种能生存。其他物种进入就会消失。</p>
<h3>学习（图案重组）</h3>
<p>母体会试放图案，按照放置后周围剩下、增加了多少自己的物种来打分。它会试验把最佳图案翻转 1〜3 格的图案或全新的图案，连续几次更好就替换。长时间一直输，就固定那个图案。</p>
<h3>规则重抽</h3>
<p>32 种到齐后，每 2,000 代重新抽取弱小物种的规则。已经消失的物种和无法用自己填满领域的物种优先。都没有的话，重抽吃掉数量最多颜色组的那组中最弱的 4 种，以及整体最少的 4 种（只限拥有规则已满 10,000 代的物种。在减少了物种上限的棋盘上，这个 4 也按同样比例减少，但至少保留 1 个）。不过，棋盘上数量较多的那一半物种（4 种时为第 1、2 名）不会因这两条规则被选中。G1 的规则不变。</p>
<h3>状态表</h3>
<p>横向是颜色组，纵向是编号。显示每个物种的规则、棋盘上的数量、学习次数（试）、换成更好图案的次数（胜）以及是否固定。勾选“强者优先”后，各颜色组内按数量从多到少排列。</p>
<h3>母体的作用</h3>
<ul>
<li><b>显示母体</b>：取消后母体消失，放置图案和领域也没有了。重新勾选后从原来的位置继续活动。</li>
<li><b>学习（重组）</b>：取消后一直放置当前最佳的图案。</li>
<li><b>领域</b>：取消后其他物种也能在母体周围生存。</li>
<li><b>规则重抽</b>：取消后不改变弱小物种的规则。</li>
<li><b>保存・读取母体</b>：把每个物种的规则、母体的位置和学到的图案存成文件。读取后放进当前世界里同名的物种（尚未诞生的物种在诞生时放入）。</li>
</ul>` },
    four: { title: '四个物种', html: `
<h3>四个物种</h3>
<ul>
<li><b>绿</b>：B3/S23（原本的生命游戏）</li>
<li><b>青</b>：B36/S23（6 个也会诞生，有复制自己的图案）</li>
<li><b>粉</b>：B368/S245（3・6・8 诞生，2・4・5 存活）</li>
<li><b>黄</b>：B36/S125（容易以 2×2 的小块增加）</li>
</ul>
<h3>互相捕食（石头剪刀布）</h3>
<p>绿吃粉，粉吃青，青吃绿。生物周围有 2 个以上天敌时会被吃掉而消失，该格由捕食方优先诞生。黄不吃任何物种，也不被任何物种吃。</p>
<h3>母体</h3>
<p>最初每个物种 3 个、共 12 个母体在棋盘上旅行，放置自己物种的图案，并学习让同伴增多的图案。这个世界没有领域。母体的数量和放置方式（只放空格或覆盖）可以在下方更改。</p>
<h3>状态表</h3>
<p>显示每个物种的数量、学习次数（试）和胜数。勾选“强者优先”后按数量排列。</p>` },
    free: { title: '自由编辑', html: `
<p>在空棋盘上自己放置生物、为每个物种编写规则来运行的世界。最初是遵循原本生命游戏（B3/S23）的一个物种。</p>
<h3>棋盘操作</h3>
<ul>
<li><b>移动・放置・擦除</b>：选择鼠标的作用。“放置”会放下表中选中的物种。滚轮缩放，“移动”时拖动可以移动棋盘。</li>
<li><b>随机放置</b>：用使用中的物种随机填满棋盘。<b>全部清除</b>：清空棋盘。</li>
<li><b>1 代</b>：暂停并只前进 1 代（也可按“.”键）。空格键暂停和继续。</li>
<li><b>保存・读取</b>：把棋盘和物种表（规则、颜色、生成记住的图案）存成文件。读取后按那个棋盘大小重建，从存档处继续。</li>
</ul>
<h3>物种表（从左到右）</h3>
<ul>
<li><b>颜色和字母</b>：点击后可以放置该物种。字母（A、B …）是在式子中指代该物种的名字。</li>
<li><b>使用</b>：取消后该物种既不诞生也不存活（棋盘上的会在下一代消失）。</li>
<li><b>诞生</b>：该物种在空格诞生的条件。例“3”＝周围正好有 3 个自己的物种，“36”＝3 个或 6 个。</li>
<li><b>存活</b>：该物种的生物留到下一代的条件。例“23”＝2 个或 3 个。</li>
<li><b>吃</b>：吃掉对方的条件，在猎物格周围计数。例“A&gt;=2”＝猎物周围有 2 个以上 A。空着就不吃。</li>
<li><b>猎物</b>：可以吃的物种的字母。例“B”“BC”“B-D”（B 到 D）“?”（任何）。</li>
<li><b>生成</b>：开启后在空位放一个图案，数量稳定后接着放下一个。记住 4 个最长寿的图案，按“记住的 4 个 → 随机的 4 个”的顺序放置。“最长”是记住的图案到稳定所用的代数。</li>
</ul>
<h3>式子的写法</h3>
<ul>
<li>只写数字（如“23”）表示周围自己物种的数量。</li>
<li>A、B …＝该物种的数量，A+B＝合计，?＝所有物种的数量。</li>
<li>比较用 = != &lt; &lt;= &gt; &gt;=，连接用 AND、OR 和括号。例“A=3 AND B&lt;2”。</li>
<li>写错时栏会变红，改好之前按上一次正确的规则继续运行。</li>
</ul>` },
  },
};

// 光の点滅の注意（セッション10・Q101）。子ども向け（kid。大きな字・ふりがな）と大人向け（adult）
//   ふりがなは「漢字{よみ}」で書き、ruby() で <ruby> にする
export const WARN = {
  ja: {
    label: '光の点滅（光過敏性発作）の注意',
    titlePC: { kid: '速{はや}くすると ちかちか します。はなれて 見{み}てね。',
      adult: '速さを上げると細かい点が激しく明滅します。光の点滅で体調を崩すことがあります。画面から離れ、明るい部屋でご覧ください。' },
    titleMobile: { kid: 'ちかちか するので、スマホでは 速{はや}く できません。',
      adult: 'この画面は細かい点が明滅します。スマホは目に近く、明滅が視野に大きく入るため、速さを 1秒に5世代までにしています。' },
    dlgPC: { title: 'ちかちか に 気{き}をつけて', kid: '速{はや}くすると、画面{がめん}が はげしく ちかちか します。<br>はなれて 見{み}てね。気分{きぶん}が 悪{わる}く なったら やめてね。',
      adult: '速さを上げると、細かい点が1秒に3回を超えて明滅します。光の点滅で、気分が悪くなったり発作が起きたりする人がいます。画面から離れ、明るい部屋で、長時間続けて見ないでください。体調が悪くなったら、すぐに見るのをやめてください。',
      ok: 'わかった。速{はや}くする', cancel: 'やめる' },
    dlgMobile: { title: 'スマホでは 速{はや}く できません', kid: '目{め}に 近{ちか}いので、ちかちかが 強{つよ}く 見{み}えます。',
      adult: 'スマホは目に近い位置で見るため、明滅が視野に大きく入ります。光の点滅で、気分が悪くなったり発作が起きたりする人がいるため、スマホでは速さを 1秒に5世代までにしています。',
      ok: 'わかった' },
    consent: { title: 'はじめる まえに', kid: 'この ゲームは、画面{がめん}が ちかちか する ことが あります。<br>はなれて、明{あか}るい 部屋{へや}で 見{み}てね。気分{きぶん}が 悪{わる}く なったら、すぐ やめてね。',
      adult: 'この作品は、細かい点が明滅する画面を表示します（速さを上げると、1秒に3回を超えて明滅します）。光の点滅で、気分が悪くなったり発作が起きたりする人がいます。光過敏の経験がある方は、遊ぶ前に医師に相談してください。画面から離れ、明るい部屋で、長時間続けて見ないでください。体調が悪くなったら、すぐに見るのをやめてください。',
      mobile: 'スマホでは、速さを 1秒に5世代までにしています。',
      ok: '同意{どうい}して はじめる', cancel: '同意{どうい}しない',
      denied: '同意{どうい}しないと、はじめられません。', again: '注意{ちゅうい}を もう一度{いちど} 読{よ}む' },
  },
  en: {
    label: 'Photosensitivity warning (flashing light)',
    titlePC: { kid: 'Going fast makes the screen flicker. Sit back from the screen.',
      adult: 'At higher speeds, small dots flash rapidly. Flashing light can make some people unwell. Keep your distance from the screen and watch in a well-lit room.' },
    titleMobile: { kid: 'It flickers, so phones can’t go fast.',
      adult: 'Small dots on this screen flash. A phone is held close to the eyes, so the flashing fills more of your view. On phones the speed is limited to 5 generations per second.' },
    dlgPC: { title: 'Watch out for flicker', kid: 'Going fast makes the screen flicker hard.<br>Sit back. Stop if you feel unwell.',
      adult: 'At higher speeds, small dots flash more than 3 times per second. Flashing light can make some people feel unwell or trigger seizures. Keep your distance, watch in a well-lit room, and don’t watch for long periods. Stop watching immediately if you feel unwell.',
      ok: 'OK, go faster', cancel: 'Cancel' },
    dlgMobile: { title: 'Phones can’t go faster', kid: 'A phone is close to your eyes, so the flicker looks stronger.',
      adult: 'Phones are viewed close to the eyes, so the flashing fills more of your view. Because flashing light can make some people feel unwell or trigger seizures, the speed on phones is limited to 5 generations per second.',
      ok: 'OK' },
    consent: { title: 'Before you start', kid: 'This game can make the screen flicker.<br>Sit back and play in a bright room. Stop right away if you feel unwell.',
      adult: 'This work shows small dots that flash (at higher speeds, more than 3 times per second). Flashing light can make some people feel unwell or trigger seizures. If you have ever been sensitive to light, talk to a doctor before playing. Keep your distance from the screen, watch in a well-lit room, and don’t watch for long periods. Stop watching immediately if you feel unwell.',
      mobile: 'On phones, the speed is limited to 5 generations per second.',
      ok: 'I agree, start', cancel: 'I don’t agree',
      denied: 'You can’t start without agreeing.', again: 'Read the warning again' },
  },
  zh: {
    label: '光敏性癫痫（闪光）注意事项',
    titlePC: { kid: '速度快时画面会闪烁。请离远一点看。',
      adult: '提高速度后，细小的点会剧烈闪烁。闪烁的光可能使人身体不适。请远离屏幕，在明亮的房间中观看。' },
    titleMobile: { kid: '会闪烁，所以手机上不能加快。',
      adult: '此画面中的细小点会闪烁。手机离眼睛近，闪烁在视野中所占范围大，因此在手机上速度限制为每秒 5 代以内。' },
    dlgPC: { title: '注意闪烁', kid: '加快后画面会剧烈闪烁。<br>请离远一点看，觉得不舒服就停下来。',
      adult: '提高速度后，细小的点每秒闪烁超过 3 次。闪烁的光可能使人身体不适或引发癫痫发作。请远离屏幕，在明亮的房间中观看，不要长时间连续观看。如感到不适，请立即停止观看。',
      ok: '知道了，加快', cancel: '取消' },
    dlgMobile: { title: '手机上不能加快', kid: '手机离眼睛近，闪烁看起来更强。',
      adult: '手机在离眼睛很近的位置观看，闪烁在视野中所占范围大。闪烁的光可能使人身体不适或引发癫痫发作，因此在手机上速度限制为每秒 5 代以内。',
      ok: '知道了' },
    consent: { title: '开始之前', kid: '这个游戏的画面可能会闪烁。<br>请离远一点，在明亮的房间里看。觉得不舒服就马上停下来。',
      adult: '本作品会显示细小的点闪烁的画面（提高速度后，每秒闪烁超过 3 次）。闪烁的光可能使人身体不适或引发癫痫发作。曾对光敏感的人，请在游玩前咨询医生。请远离屏幕，在明亮的房间中观看，不要长时间连续观看。如感到不适，请立即停止观看。',
      mobile: '在手机上，速度限制为每秒 5 代以内。',
      ok: '同意并开始', cancel: '不同意',
      denied: '不同意就无法开始。', again: '再读一遍注意事项' },
  },
};
export const ruby = s => s.replace(/([一-龥々]+)\{([^}]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>');
// 警告の印（黄色い三角に「！」。安全表示の「一般的な注意」の形）
export const WARN_ICON = '<svg class="warn-ico" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 1.5 L23 20.5 H1 Z" fill="#facc15" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/><rect x="10.8" y="7.5" width="2.4" height="7.5" rx="1" fill="#111"/><circle cx="12" cy="17.4" r="1.4" fill="#111"/></svg>';
