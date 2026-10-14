// ルールブックの「遊び方」（利用者 Q10=B）。初めての人向けの流れに、いまのルールの値で変わる所を書き分ける。
// 規則文は転載せず MOMO の言葉で書く。日本式と中国式で別の文（中国式は四川・香港・国標の部品をルールの値で組み合わせる）。
// 値の細かい一覧は「いまのルール」のタブに任せ、ここでは「その値だと何が起きるか」を書く。

import { HK_POINTS } from '../engine/hongkong';
import type { Rules } from '../engine/rules';
import type { BaseLang } from '../i18n/strings';

type L3 = Record<BaseLang, string>;
const L = (ja: string, en: string, zh: string): L3 => ({ ja, en, zh });

export interface HowtoSection {
  title: L3;
  lines: L3[];
}

type JpV = Extract<Rules, { family: 'jp' }>['values'];
type CnV = Extract<Rules, { family: 'cn' }>['values'];

/** 条件が成り立つ文だけを残す */
const pick = (...xs: (L3 | false | null | undefined)[]): L3[] => xs.filter((x): x is L3 => !!x);

export function howtoOf(rules: Rules): HowtoSection[] {
  return rules.family === 'jp' ? jpHowto(rules.values) : cnHowto(rules.values);
}

function jpHowto(v: JpV): HowtoSection[] {
  const start = v.start === '30' ? '30000' : '25000';
  const shibari2 = v.shibari === '2';
  const shibari5 = v.shibari === '5h2';
  return [
    {
      title: L('対局の流れ', 'How a game runs', '对局流程'),
      lines: pick(
        L(
          `4人で、136枚の牌を使います${v.aka === 'on' ? '（5萬・5筒・5索のうち各1枚が赤い牌＝赤ドラ）' : ''}。持ち点は1人${start}点から始めます。`,
          `Four players use 136 tiles${v.aka === 'on' ? ' (one each of the 5 of characters, dots and bamboo is red = red dora)' : ''}. Everyone starts with ${start} points.`,
          `四人使用136张牌${v.aka === 'on' ? '（五万、五筒、五索各有一张红牌＝赤宝牌）' : ''}。每人起始点数为${start}点。`,
        ),
        v.length === 'east'
          ? L('東場の4局で終わる「東風戦」です。親は局ごとに右へ回ります。', 'This is an East-only game of four hands. The dealer seat moves to the right each hand.', '东风战，打东场4局结束。庄家每局向右轮换。')
          : L('東場4局・南場4局の8局で終わる「半荘戦」です。親は局ごとに右へ回ります。', 'This is a half game: four East hands and four South hands. The dealer seat moves to the right each hand.', '半庄战，东场4局、南场4局共8局。庄家每局向右轮换。'),
        v.renchan === 'tenpai'
          ? L('親がアガるか、流局で親がテンパイしていれば、同じ親でもう一度（連荘）。', 'If the dealer wins, or is ready (tenpai) at an exhaustive draw, the dealer repeats.', '庄家和牌，或流局时庄家听牌，则连庄。')
          : L('親がアガったときだけ、同じ親でもう一度（連荘）。流局では親が流れます。', 'The dealer repeats only after winning. After an exhaustive draw the dealer seat moves on.', '只有庄家和牌才连庄。流局时庄家轮换。'),
        v.west === 'on' &&
          v.kaeshi === '30' &&
          L(
            `最後の局が終わっても誰も30000点に届いていなければ、西場へ続きます（${v.westEnd === 'sudden' ? '届いた人が出た時点で終わり' : '西4局まで打つ'}）。`,
            `If nobody has reached 30000 points after the last hand, play continues into the West round (${v.westEnd === 'sudden' ? 'ending as soon as someone reaches it' : 'playing all four West hands'}).`,
            `最后一局结束时若无人达到30000点，则进入西场（${v.westEnd === 'sudden' ? '有人达到即结束' : '打满西4局'}）。`,
          ),
        v.tobi === 'on' &&
          L(
            `誰かの持ち点が${v.zero === 'cont' ? '0点未満' : '0点以下'}になったら、その時点で対局は終わり（飛び）。`,
            `The game ends as soon as someone's points go ${v.zero === 'cont' ? 'below zero' : 'to zero or below'} (bust).`,
            `有人点数${v.zero === 'cont' ? '低于0点' : '为0点或以下'}时，对局立即结束（被飞）。`,
          ),
      ),
    },
    {
      title: L('1局の流れ', 'How a hand runs', '一局的流程'),
      lines: pick(
        L('配られる牌は13枚（親は14枚）。親から順に、山から1枚引いて1枚捨てます。', 'Each player is dealt 13 tiles (the dealer 14). Starting with the dealer, players draw one tile and discard one in turn.', '每人配13张（庄家14张）。从庄家开始，依次摸一张、打一张。'),
        L('山の最後の14枚（王牌）は引きません。そこまで引ききって誰もアガらなければ流局です。', 'The last 14 tiles (the dead wall) are not drawn. If the live wall runs out with no winner, the hand is drawn.', '牌山最后14张（王牌）不摸。摸完而无人和牌即为流局。'),
        L(
          `王牌の表示牌の次の牌がドラで、アガったときに1枚1翻になります${[v.ura === 'on' && '裏ドラ（リーチでアガったとき）', v.kandora === 'on' && 'カンドラ', v.aka === 'on' && '赤ドラ'].filter(Boolean).length ? `。ほかに${[v.ura === 'on' && '裏ドラ（リーチでアガったとき）', v.kandora === 'on' && 'カンドラ', v.aka === 'on' && '赤ドラ'].filter(Boolean).join('・')}もあります` : ''}。`,
          `The tile after the indicator in the dead wall is dora: each one adds 1 han when you win${[v.ura === 'on' && 'ura dora (when winning with riichi)', v.kandora === 'on' && 'kan dora', v.aka === 'on' && 'red dora'].filter(Boolean).length ? `. There are also ${[v.ura === 'on' && 'ura dora (when winning with riichi)', v.kandora === 'on' && 'kan dora', v.aka === 'on' && 'red dora'].filter(Boolean).join(', ')}` : ''}.`,
          `王牌宝牌指示牌的下一张为宝牌，和牌时每张计1番${[v.ura === 'on' && '里宝牌（立直和牌时）', v.kandora === 'on' && '杠宝牌', v.aka === 'on' && '赤宝牌'].filter(Boolean).length ? `。另有${[v.ura === 'on' && '里宝牌（立直和牌时）', v.kandora === 'on' && '杠宝牌', v.aka === 'on' && '赤宝牌'].filter(Boolean).join('、')}` : ''}。`,
        ),
      ),
    },
    {
      title: L('アガリ', 'Winning', '和牌'),
      lines: pick(
        L('14枚で「面子4つと雀頭1つ」を作るとアガリです（七対子・国士無双は特別な形）。面子は同じ牌3枚（刻子）か、同じ色で続く3枚（順子）。', 'You win with 14 tiles forming four sets and a pair (Seven Pairs and Thirteen Orphans are special shapes). A set is three of a kind or a run of three in one suit.', '用14张组成“四组面子加一对雀头”即可和牌（七对子、国士无双为特殊牌型）。面子是三张相同的牌（刻子）或同花色连续三张（顺子）。'),
        L(
          `アガるには役が${shibari2 ? '2翻以上' : '1つ以上'}要ります（ドラは役に数えません）${shibari5 ? '。5本場からは2翻以上が要ります' : ''}。役は「役の一覧」のタブにあります。`,
          `You need ${shibari2 ? 'at least 2 han of yaku' : 'at least one yaku'} to win (dora do not count)${shibari5 ? '. From the fifth bonus counter on, 2 han are needed' : ''}. See the Yaku tab.`,
          `和牌需要${shibari2 ? '2番以上的役' : '至少一个役'}（宝牌不算役）${shibari5 ? '。五本场起需要2番以上' : ''}。役见“役种一览”页。`,
        ),
        L('自分で引いた牌でアガるのがツモ、ほかの人が捨てた牌でアガるのがロンです。', 'Winning on your own draw is tsumo; winning on another player’s discard is ron.', '自己摸到和牌叫自摸，用他家打出的牌和牌叫荣和。'),
        v.furiten === 'on' &&
          L('自分の捨て牌に待ちの牌があるとロンできません（フリテン）。見逃したあとも、その巡（リーチ中はその局）はロンできません。ツモならアガれます。', 'You cannot ron if one of your winning tiles is in your own discards (furiten). After passing a winning tile you also cannot ron for that turn (for the rest of the hand while in riichi). Tsumo is still allowed.', '自己的舍牌中有所听的牌时不能荣和（振听）。放过和牌后，该巡（立直中则整局）也不能荣和。自摸仍可和牌。'),
        v.atozuke === 'off' && L('鳴くときは、その時点で役が決まっていなければなりません（後付けなし）。', 'When you call, your yaku must already be settled (no late yaku).', '鸣牌时必须已经确定有役（不可后付）。'),
      ),
    },
    {
      title: L('リーチ', 'Riichi', '立直'),
      lines: pick(
        L('鳴かずにテンパイしたら、1000点を出してリーチを宣言できます。宣言のあとは引いた牌をそのまま切り、アガれば1翻の役になります。', 'With a closed ready hand you may declare riichi by putting up 1000 points. Afterwards you discard every tile you draw; if you win, riichi is a 1-han yaku.', '门清听牌时，支付1000点即可宣告立直。之后摸到的牌直接打出，和牌时立直计1番。'),
        v.ippatsu === 'on' && L('リーチから1巡のうちにアガると「一発」が付きます。', 'Winning within one go-around after riichi adds Ippatsu.', '立直后一巡内和牌另计“一发”。'),
        v.riichiUnder === 'ng' && L('持ち点が1000点に満たないときはリーチできません。', 'You cannot declare riichi with fewer than 1000 points.', '点数不足1000点时不能立直。'),
      ),
    },
    {
      title: L('鳴き', 'Calls', '鸣牌'),
      lines: pick(
        L('ほかの人の捨て牌をもらって面子にできます。チー（左の人の牌で順子）・ポン（誰の牌でも刻子）・カン（同じ牌4枚）。鳴くと、その面子は手の右にさらします。', 'You can take another player’s discard to complete a set: chi (a run, from the player on your left), pon (three of a kind, from anyone) or kan (four of a kind). Called sets are laid open to the right of your hand.', '可以拿他家的舍牌组成面子：吃（上家的牌组成顺子）、碰（任何人的牌组成刻子）、杠（四张相同）。鸣牌的面子亮在手牌右侧。'),
        L('同じ牌を何人かが欲しいときは、ロン、ポン・カン、チーの順に優先されます。', 'When several players want the same discard, ron beats pon/kan, which beat chi.', '多人要同一张牌时，优先顺序为荣和、碰和杠、吃。'),
        v.kuitan === 'off' && L('鳴いたら断么九（タンヤオ）は付きません（喰いタンなし）。', 'Tanyao does not count once you call (no open tanyao).', '鸣牌后不计断幺九（无食断）。'),
        v.kuikae === 'ng' && L('鳴いた直後に、鳴いた牌と同じ牌（チーなら筋の牌も）は切れません（喰い替え禁止）。', 'Right after a call you may not discard the same tile you called (or, after chi, the tile at the other end of the run).', '鸣牌后不能立即打出与鸣入的牌相同的牌（吃牌时同筋的牌也不行）。'),
      ),
    },
    {
      title: L('流局', 'Draws', '流局'),
      lines: pick(
        L('山を引ききって流局したら、テンパイしている人がしていない人から合わせて3000点を受け取ります。', 'At an exhaustive draw, players who are ready receive a total of 3000 points from those who are not.', '摸完流局时，听牌者从未听牌者处共收3000点。'),
        v.keishiki === 'off' && L('役が無いテンパイは、テンパイとして数えません。', 'A ready hand with no possible yaku does not count as tenpai.', '没有役的听牌不算听牌。'),
        v.nagashi === 'on' && L('捨て牌が全部1・9の数牌と字牌で、1枚も鳴かれていなければ、流し満貫として満貫の点をもらえます。', 'If all your discards are terminals and honors and none were called, you score a mangan (nagashi mangan).', '舍牌全是一九牌和字牌且未被鸣走，可得满贯点数（流局满贯）。'),
        [v.kyushu, v.sufon, v.sukan, v.suricchi].some((x) => x === 'on') &&
          L(
            `途中で流れる局があります：${[v.kyushu === 'on' && '最初の手番で1・9・字牌が9種類以上（九種九牌）', v.sufon === 'on' && '最初の巡で4人が同じ風牌を切る（四風連打）', v.sukan === 'on' && '2人以上で4回カン（四開槓）', v.suricchi === 'on' && '4人ともリーチ（四家立直）'].filter(Boolean).join('・')}。`,
            `Some hands can end early: ${[v.kyushu === 'on' && 'nine or more different terminals/honors in your first turn (nine terminals)', v.sufon === 'on' && 'all four discard the same wind on the first go-around', v.sukan === 'on' && 'four kans by two or more players', v.suricchi === 'on' && 'all four players in riichi'].filter(Boolean).join('; ')}.`,
            `有中途流局：${[v.kyushu === 'on' && '第一巡手中有九种以上幺九牌（九种九牌）', v.sufon === 'on' && '第一巡四人打出同一张风牌（四风连打）', v.sukan === 'on' && '两人以上共开杠四次（四杠散了）', v.suricchi === 'on' && '四人都立直（四家立直）'].filter(Boolean).join('、')}。`,
          ),
      ),
    },
    {
      title: L('点数の払い方', 'Paying points', '点数的支付'),
      lines: pick(
        L('点数は役の翻とドラ、手の形の符で決まります。5翻で満貫（子8000点・親12000点）、6〜7翻で跳満、8〜10翻で倍満、11〜12翻で三倍満、役満は子32000点・親48000点です。', 'Points come from han (yaku and dora) and fu (hand shape). 5 han is mangan (8000, dealer 12000); 6–7 haneman, 8–10 baiman, 11–12 sanbaiman; yakuman is 32000 (dealer 48000).', '点数由役和宝牌的番数及牌型的符决定。5番为满贯（闲家8000点、庄家12000点），6～7番跳满，8～10番倍满，11～12番三倍满，役满闲家32000点、庄家48000点。'),
        v.kazoe === 'on' && L('役満でなくても13翻以上あれば役満として数えます（数え役満）。', '13 han or more counts as yakuman (counted yakuman).', '13番以上计为役满（累计役满）。'),
        v.kiriage === 'on' && L('30符4翻・60符3翻は満貫に切り上げます。', '30 fu 4 han and 60 fu 3 han are rounded up to mangan.', '30符4番、60符3番进位为满贯。'),
        L('ロンは捨てた人が全額を払います。ツモは3人で分けて払い、親のアガリなら3人が同じ額、子のアガリなら親が子の倍を払います。', 'For ron, the discarder pays everything. For tsumo, the other three share the payment: equally if the dealer won, with the dealer paying double if a non-dealer won.', '荣和由放铳者全额支付。自摸由其他三家分摊：庄家和牌三家平分，闲家和牌则庄家付闲家的两倍。'),
        v.honba === 'on' && L('連荘や流局のたびに積み棒が1本増え、アガった人に1本300点が上乗せされます。', 'Each repeat or draw adds a bonus counter worth 300 points to the next win.', '每次连庄或流局增加一根本场棒，和牌者每根多得300点。'),
        v.double === 'atama'
          ? L('同じ捨て牌で2人がロンしたら、捨てた人から見て順番の近い1人だけがアガります（頭ハネ）。', 'If two players ron the same discard, only the one closest in turn order after the discarder wins (head bump).', '两人荣和同一张牌时，只有按顺序离放铳者最近的一人和牌（截和）。')
          : L('同じ捨て牌で2人がロンしたら、2人ともアガります（ダブロン）。', 'If two players ron the same discard, both win (double ron).', '两人荣和同一张牌时，两人都和牌（双响）。'),
      ),
    },
    {
      title: L('終局と順位', 'End of the game', '终局与名次'),
      lines: pick(
        L('最後の持ち点で順位を決めます。', 'Final points decide the ranking.', '按最终点数排名次。'),
        v.kaeshi === '30' &&
          L(
            `持ち点から30000点を引き、1000点を1として最終得点にします${v.oka === 'on' ? '。トップには賞（オカ）が付きます' : ''}。`,
            `Subtract 30000 from final points and count 1000 points as 1${v.oka === 'on' ? '; the top player also takes the bonus (oka)' : ''}.`,
            `最终点数减去30000点，每1000点计1分${v.oka === 'on' ? '；第一名另得奖励（oka）' : ''}。`,
          ),
        v.uma !== 'none' && L(`順位に応じて点を足し引きします（ウマ：${v.uma === 'float' ? '浮きウマ' : v.uma}）。`, `Placement bonuses are added (uma: ${v.uma}).`, `按名次加减顺位点（马：${v.uma}）。`),
      ),
    },
  ];
}

function cnHowto(v: CnV): HowtoSection[] {
  const tiles = 108 + (v.honors === 'on' ? 28 : 0) + (v.flower === 'on' ? 8 : 0);
  const kinds = [L('萬子・筒子・索子', 'characters, dots and bamboo', '万、筒、条'), v.honors === 'on' && L('字牌', 'honors', '字牌'), v.flower === 'on' && L('花牌', 'flowers', '花牌')].filter((x): x is L3 => !!x);
  const join = (lang: BaseLang) => kinds.map((k) => k[lang]).join(lang === 'en' ? ', ' : '・');
  const rounds = v.length === '1' ? 1 : 4;
  const hkTable = Object.entries(HK_POINTS).map(([f, p]) => `${f}→${p}`).join(' ');
  return [
    {
      title: L('対局の流れ', 'How a game runs', '对局流程'),
      lines: pick(
        L(`4人で、${join('ja')}の${tiles}枚を使います。持ち点は${v.start === '500' ? '500点' : '0点'}から始めます。`, `Four players use ${tiles} tiles: ${join('en')}. Everyone starts with ${v.start === '500' ? '500' : '0'} points.`, `四人使用${join('zh')}共${tiles}张牌。起始点数为${v.start === '500' ? '500' : '0'}点。`),
        L(`${rounds}圏（${rounds * 4}局）で終わります${v.handCap === '24' ? '（ただし24局まで）' : ''}。`, `The game lasts ${rounds} round${rounds > 1 ? 's' : ''} (${rounds * 4} hands)${v.handCap === '24' ? ', up to 24 hands' : ''}.`, `共${rounds}圈（${rounds * 4}局）${v.handCap === '24' ? '，最多24局' : ''}。`),
        v.dealer === 'firstWin'
          ? L('その局で最初にアガった人が次の親です（誰もアガらなければ親のまま）。', 'The first player to win a hand becomes the next dealer (if nobody wins, the dealer stays).', '本局最先和牌者为下一局庄家（无人和牌则庄家不变）。')
          : v.dealer === 'rotate'
            ? L('親は局ごとに右へ回ります（連荘はありません）。', 'The dealer seat moves to the right every hand (no repeats).', '庄家每局向右轮换（不连庄）。')
            : L('親がアガれば親のまま。それ以外は親が右へ回ります。', 'If the dealer wins, the dealer stays; otherwise the seat moves to the right.', '庄家和牌则连庄，否则向右轮换。'),
        v.tobi === 'on' && L('誰かの持ち点が0点未満になったら、その時点で対局は終わります。', 'The game ends as soon as someone goes below zero.', '有人点数低于0时对局立即结束。'),
      ),
    },
    {
      title: L('1局の流れ', 'How a hand runs', '一局的流程'),
      lines: pick(
        L('配られる牌は13枚（親は14枚）。親から順に、山から1枚引いて1枚捨てます。王牌は無く、山の最後の1枚まで引きます。', 'Each player is dealt 13 tiles (the dealer 14). Players draw one and discard one in turn. There is no dead wall: the wall is drawn to the last tile.', '每人配13张（庄家14张），依次摸一张、打一张。没有王牌，摸到牌山最后一张。'),
        v.flower === 'on' && L(`花牌を引いたら表にして脇に置き、${v.flowerRefill === 'back' ? '山の最後' : '山の前'}から1枚補います（補花）。`, `When you draw a flower, set it aside face up and draw a replacement from the ${v.flowerRefill === 'back' ? 'end' : 'front'} of the wall.`, `摸到花牌时亮出放在一旁，从牌山${v.flowerRefill === 'back' ? '末尾' : '前端'}补一张（补花）。`),
        v.huan3 === 'on' && L('配り終えたら、同じ色の3枚を選んでほかの人と交換します（換三張）。渡す相手はサイコロで決まります。', 'After the deal, each player passes three tiles of one suit to another player (the dice decide who).', '配牌后，每人选同一花色的三张与他人交换（换三张），交换对象由骰子决定。'),
        v.queyimen === 'on' && L('最初に、捨てる色を1つ決めて1枚伏せます（缺一門）。その色が手に残っているうちはアガれず、その色から切らなければなりません。', 'At the start, choose one suit to discard and lay one tile of it face down. While that suit remains in your hand you cannot win and must discard it first.', '开局先定一门要舍弃的花色，并扣下一张（定缺）。手中还有该花色时不能和牌，且必须先打该花色。'),
      ),
    },
    {
      title: L('アガリ', 'Winning', '和牌'),
      lines: pick(
        L(`14枚で「面子4つと雀頭1つ」を作るとアガリです${[v.qidui === 'on' && '七対子', v.honors === 'on' && v.scoring !== 'sichuan' && '十三么'].filter(Boolean).length ? `（${[v.qidui === 'on' && '七対子', v.honors === 'on' && v.scoring !== 'sichuan' && '十三么'].filter(Boolean).join('・')}は特別な形）` : ''}。`, `You win with 14 tiles forming four sets and a pair${v.qidui === 'on' ? ' (Seven Pairs is also allowed)' : ''}.`, `用14张组成“四组面子加一对将”即可和牌${v.qidui === 'on' ? '（七对也可）' : ''}。`),
        v.minFan !== '0' && L(`アガるには${v.minFan}番以上が要ります${v.scoring === 'mcr' ? '（花牌は数えない）' : ''}。番は「番の一覧」のタブにあります。`, `You need at least ${v.minFan} fan to win${v.scoring === 'mcr' ? ' (flowers do not count)' : ''}. See the Fan tab.`, `和牌需要至少${v.minFan}番${v.scoring === 'mcr' ? '（花牌不计）' : ''}。番种见“番种一览”页。`),
        v.ron === 'tsumo'
          ? L('アガれるのは自分で引いた牌だけです（ロンはありません）。', 'You can only win on your own draw (no ron).', '只能自摸和牌（不能荣和）。')
          : L('自分で引いた牌でアガるのがツモ、ほかの人が捨てた牌でアガるのがロンです。', 'Winning on your own draw is self-draw; winning on a discard is ron.', '自摸或荣和他家打出的牌均可和牌。'),
        v.afterWin === 'leave' && L('アガった人は抜け、残りの人で局を続けます。3人がアガるか山が尽きると局が終わります（血戦到底）。', 'A player who wins drops out and the others keep playing; the hand ends when three have won or the wall runs out (Bloody Battle).', '和牌者退出，其余人继续，直到三人和牌或牌摸完（血战到底）。'),
        v.afterWin === 'again' && L('アガったあとも局は続き、同じ人が何度でもアガれます。アガったあとは引いた牌をそのまま切ります（血流成河）。', 'After winning, the hand continues and you may win again and again; you discard every tile you draw (Bloody River).', '和牌后牌局继续，同一人可以多次和牌，之后摸到的牌直接打出（血流成河）。'),
        v.multiWin === 'atama' && L('同じ捨て牌で何人もアガれるときは、捨てた人から順番の近い1人だけがアガります。', 'If several players can ron the same discard, only the nearest in turn order wins.', '多人可荣和同一张牌时，只有顺序最近的一人和牌。'),
        v.miss !== 'none' && L(v.miss === 'nextDraw' ? 'アガれる牌を見逃したら、次に自分が引くまでロンできません。' : 'アガれる牌を見逃したら、同じ巡目は同じ牌でロンできません。', v.miss === 'nextDraw' ? 'If you pass a winning tile, you cannot ron until your next draw.' : 'If you pass a winning tile, you cannot ron the same tile in that go-around.', v.miss === 'nextDraw' ? '放过和牌后，在自己下次摸牌前不能荣和。' : '放过和牌后，同一巡内不能荣和同一张牌。'),
      ),
    },
    {
      title: L('鳴き', 'Calls', '鸣牌'),
      lines: pick(
        v.chi === 'on'
          ? L('ほかの人の捨て牌で、チー（左の人の牌で順子）・ポン・カンができます。優先はロン、ポン・カン、チーの順。', 'You may chi (a run, from the player on your left), pung or kong another player’s discard. Priority: ron, then pung/kong, then chi.', '可以吃（上家的牌组成顺子）、碰、杠他家的舍牌。优先顺序为和、碰杠、吃。')
          : L('ほかの人の捨て牌で、ポンとカンができます（チーはありません）。ロンが優先です。', 'You may pung or kong another player’s discard (no chi). Ron takes priority.', '可以碰、杠他家的舍牌（不能吃）。和牌优先。'),
        v.lastTile === 'ng' && L('最後の捨て牌は鳴けません。', 'The last discard cannot be called.', '最后一张舍牌不能鸣。'),
        v.kuikae === 'ng' && L('鳴いた直後に、鳴いた牌と同じ牌は切れません。', 'Right after a call you may not discard the same tile you called.', '鸣牌后不能立即打出与鸣入相同的牌。'),
        v.kanPay === 'on' && L('カンするとその場で点を受け取ります（刮風下雨）：ほかの人の捨て牌でのカンは捨てた人から2点、暗槓は3人から2点ずつ、ポンに足すカンは3人から1点ずつ。', 'A kong pays at once (wind and rain): a kong on a discard collects 2 from the discarder, a concealed kong 2 from each player, an added kong 1 from each player.', '开杠当场收分（刮风下雨）：明杠由放杠者付2分，暗杠三家各付2分，补杠三家各付1分。'),
      ),
    },
    {
      title: L('点数の払い方', 'Paying points', '点数的支付'),
      lines: pick(
        v.scoring === 'sichuan' && L(`番の合計で点が決まり、1番ごとに倍になります（0番＝1点、1番＝2点…）${v.cap !== 'none' ? `。上限は${v.cap}番` : ''}。`, `Points double with each fan (0 fan = 1, 1 fan = 2, …)${v.cap !== 'none' ? `, up to ${v.cap} fan` : ''}.`, `按番数计分，每番翻倍（0番1分、1番2分……）${v.cap !== 'none' ? `，上限${v.cap}番` : ''}。`),
        v.scoring === 'hk' && L(`番の合計を表で点に直します（${hkTable}）${v.cap !== 'none' ? `。上限は${v.cap}番` : ''}。`, `Fan are converted to points by a table (${hkTable})${v.cap !== 'none' ? `, up to ${v.cap} fan` : ''}.`, `番数按表换算为分数（${hkTable}）${v.cap !== 'none' ? `，上限${v.cap}番` : ''}。`),
        v.scoring === 'mcr' && L(`番の点を全部足します（上限なし）${v.flower === 'on' ? '。花牌は1枚1点で足します' : ''}。`, `All fan points are added together (no limit)${v.flower === 'on' ? '; each flower adds 1 point' : ''}.`, `所有番种分数相加（无上限）${v.flower === 'on' ? '，花牌每张加1分' : ''}。`),
        v.pay === 'sichuan' && L('ロンは捨てた人が点を払います。ツモはまだ抜けていない人がそれぞれ点＋1を払います。', 'For ron, the discarder pays the points. For self-draw, each player still in the hand pays the points plus 1.', '荣和由放铳者付分。自摸时尚未退出的每家各付分数加1。'),
        v.pay === 'hk' && L('ロンは捨てた人が全額を払います。ツモは3人がその半分ずつ払います。', 'For ron, the discarder pays in full. For self-draw, each of the other three pays half.', '荣和由放铳者全额支付。自摸由其他三家各付一半。'),
        v.pay === 'mcr' && L('ロンは捨てた人が「点＋8」、ほかの2人が8ずつ払います。ツモは3人がそれぞれ「点＋8」を払います。', 'For ron, the discarder pays the points plus 8 and the other two pay 8 each. For self-draw, each of the three pays the points plus 8.', '荣和时放铳者付“分数加8”，另两家各付8分。自摸时三家各付“分数加8”。'),
        v.baopai === 'on' && L('ほかの人に大きな手を完成させる鳴きをさせた人は、責任を負って払います（十二章包・大三元包）。', 'A player who feeds the call that completes certain big hands pays for it (responsibility payment).', '让他人鸣牌完成特定大牌的人需承担支付（包牌）。'),
      ),
    },
    {
      title: L('流局', 'Draws', '流局'),
      lines: pick(
        L('山を引ききって誰もアガらなければ流局です。', 'If the wall runs out with no winner, the hand is drawn.', '牌摸完无人和牌即为流局。'),
        v.chajiao === 'on' && L('流局のとき、テンパイしていない人はテンパイしている人に「その人の待ちで一番高い点」を払います（查叫）。', 'At a draw, players who are not ready pay ready players the highest value of their waits.', '流局时未听牌者向听牌者支付其听牌中最高的分数（查叫）。'),
        v.huazhu === 'on' && L('流局のとき、捨てる色を手に残している人は罰を払います（花豬）。', 'At a draw, a player still holding the suit they chose to discard pays a penalty.', '流局时手中仍有定缺花色者需支付罚分（查花猪）。'),
        v.tochu === 'on' && L('九種九牌・四風連打・四開槓のときは途中で流れます。', 'A hand can also end early with nine terminals, four same winds, or four kongs.', '九种九牌、四风连打、四杠时中途流局。'),
      ),
    },
    {
      title: L('終局と順位', 'End of the game', '终局与名次'),
      lines: pick(
        v.rank === 'mcr'
          ? L('順位に応じて標準分（4・2・1・0）を受け取ります。', 'Placements receive table points of 4, 2, 1 and 0.', '按名次获得标准分（4、2、1、0）。')
          : L('最後の持ち点の多い順に順位を決めます。', 'The ranking follows final points.', '按最终点数多少排名次。'),
        v.tieCn === 'same' ? L('同じ点の人は同じ順位です。', 'Players with equal points share the place.', '同分者名次相同。') : L('同じ点なら、起家に近い人が上です。', 'Ties go to the player nearest the first dealer.', '同分时离起家近者排名在前。'),
      ),
    },
  ];
}
