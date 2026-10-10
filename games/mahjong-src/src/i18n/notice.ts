// 「ご利用にあたって」（同意画面＝2-A）と、そのリンク先「対局の公平性とルールの再現について」（2-B）の文面。
// 正本は L:\momo\games\mahjong\docs\MOMO_Mahjong_免責と利用上の注意_案_v0.06.md（§2・§7）。文面を直すときは文書と一緒に直す。
// 意味が伝わらないと困る文なので猫語にしない（猫語のときは猫語を選ぶ直前の言語で出す）。

import type { BaseLang } from './strings';

/** 見出しつきの段落。items は箇条書き、text は地の文 */
export interface NoticeSection {
  heading: string;
  /** 赤い字で強める見出し（賭けに使わないで＝利用者指示 10-09） */
  warn?: boolean;
  text?: string;
  items?: string[];
}

export interface NoticePage {
  title: string;
  lead?: string;
  sections: NoticeSection[];
  /** 末尾の注記（訳は参考である旨など） */
  foot?: string;
}

export interface NoticeTexts {
  /** 2-A 同意画面 */
  about: NoticePage;
  /** 2-B リンクの先 */
  fairness: NoticePage;
  /** トップ画面の下から 2-A を開く文字（免責 v0.03 §3「ご利用にあたって」） */
  aboutLink: string;
  /** 2-A からリンク先を開く文字 */
  fairnessLink: string;
  /** 同意のボタン */
  agree: string;
  /** 同意画面を最後まで送っていないときの一言 */
  scrollToAgree: string;
  /** 読み返すときの閉じるボタン */
  close: string;
  /** リンク先から同意画面へ戻るボタン */
  back: string;
  /** 利用規約へのリンクの文字 */
  terms: string;
  /** トップ画面の下の1行 */
  titleNote: string;
}

const ja: NoticeTexts = {
  about: {
    title: 'ご利用の前に',
    sections: [
      {
        heading: '1. 賭けに使わないでください',
        warn: true,
        items: [
          '娯楽のための麻雀ゲームです。点数や順位に、お金の価値はありません。',
          'お金や換金できる物を賭けること、その誘い・仲介・精算に使うことは禁止です。このアプリに、賭け金をやり取りする機能はありません。',
        ],
      },
      {
        heading: '2. 保証はありません',
        items: ['ルールの正確さ・動作・通信は保証しません。このアプリの利用で生じた損害（対戦相手の言動を含む）について、運営者は責任を負いません。'],
      },
      {
        heading: '3. お住まいの国・地域の法令を守ってください。',
      },
    ],
    foot: '詳しくは「対局の公平性とルールの再現について」と利用規約をご覧ください。',
  },
  fairness: {
    title: '対局の公平性とルールの再現について',
    lead: 'このアプリで遊ぶ対局が、どこまで公平で、どこまで本物の規則どおりかを説明します。',
    sections: [
      {
        heading: '1. 公平性について（本アプリの仕組み）',
        items: [
          '山：オンライン対戦の山は、参加者全員の鍵で封をしてから混ぜます。山のデータはホストの端末にありますが、全員の鍵が掛かっているので、ホストにも中身は見えず、並び順を選ぶこともできません。',
          '手牌：各プレイヤーの手牌を開けられるのは、そのプレイヤーの端末だけです。ホストにも、他のプレイヤーにも見えません。',
          'CPU：CPU の手牌と考えは、ホストの端末の中で動いています。ホストが端末のデータを解析すれば、CPU の手牌を見ることができます（ひとりで遊ぶときは、あなたがホストです）。',
          '参加者全員が示し合わせた場合など、この仕組みでは防げないこともあります。',
        ],
      },
      {
        heading: '2. ルールセットは公認を受けたものではありません',
        text: '本アプリで選べるルールセット（Mリーグ、日本プロ麻雀連盟、最高位戦、日本プロ麻雀協会、RMU、麻将連合、日本健康麻将協会、天鳳、WRC、EMA、国標麻将、四川麻将、香港麻雀など）は、各団体・運営者が公開している規則をもとに、本アプリが独自に解釈して再現したものです。',
        items: [
          '各団体・運営者による承認・公認・監修・提携を受けたものではありません。',
          'ルールセットの名前は、どの規則をもとにしたかを示すためだけに使っています。各名称は、それぞれの権利者の商標または登録商標である場合があります。',
          '規則の文章を転載したものではありません。説明文は本アプリが独自に書いたものです。',
        ],
      },
      {
        heading: '3. ルールの再現は完全ではありません',
        items: [
          '公開された規則に書かれていない事柄は、本アプリが補って決めています（ルールブックに「本アプリが補った値」として示します）。',
          '規則の解釈の違い、規則の改定、本アプリの不具合などにより、実際の規則と異なる動きをすることがあります。',
          'その結果、アガリの判定、役や点数の計算、順位、勝敗が、実際の規則で打った場合と異なることがあります。',
          '本アプリの判定を、公式の大会・競技・検定などの判断の根拠として使わないでください。',
        ],
      },
    ],
  },
  aboutLink: 'ご利用にあたって',
  fairnessLink: '対局の公平性とルールの再現について',
  agree: '同意して始める',
  scrollToAgree: '最後まで読むと、同意のボタンを押せます。',
  close: '閉じる',
  back: '戻る',
  terms: '利用規約',
  titleNote: '娯楽目的のゲームです。賭けには使えません。',
};

const en: NoticeTexts = {
  about: {
    title: 'Before You Play',
    sections: [
      {
        heading: '1. Do not use this app for gambling',
        warn: true,
        items: [
          'This is a mahjong game for entertainment. Points and rankings have no monetary value.',
          'Betting money or anything exchangeable for money, or using this app to solicit, broker or settle such bets, is prohibited. This app has no function for exchanging stakes.',
        ],
      },
      {
        heading: '2. No warranty',
        items: ['We do not guarantee the accuracy of the rules, operation or connection. The operator accepts no liability for any damage arising from the use of this app (including the conduct of other players).'],
      },
      {
        heading: '3. Follow the laws of your country or region.',
      },
    ],
    foot: 'For details, see "Fairness of Play and Reproduction of the Rules" and the Terms of Use.',
  },
  fairness: {
    title: 'Fairness of Play and Reproduction of the Rules',
    lead: 'This page explains how fair the games in this app are, and how closely they follow the actual rules.',
    sections: [
      {
        heading: '1. Fairness (how this app works)',
        items: [
          "Wall: In online play, the wall is sealed with every participant's key before it is shuffled. The wall data is kept on the host's device, but because it is locked with everyone's keys, even the host cannot see its contents or choose the order of the tiles.",
          "Hands: Each player's hand can be opened only on that player's own device. Neither the host nor the other players can see it.",
          "CPU: The CPU players' hands and decisions run on the host's device. If the host analyzes the data on the device, the host can see the CPU players' hands (when you play alone, you are the host).",
          'Some cases, such as all participants colluding, cannot be prevented by this mechanism.',
        ],
      },
      {
        heading: '2. Rule sets are not endorsed by any organization.',
        text: "The rule sets in this app (M.League, Japan Professional Mahjong League, Saikouisen, Nippon Pro Mahjong Kyokai, RMU, Mahjong Rengo, Japan Health Mahjong Association, Tenhou, WRC, EMA, MCR, Sichuan Mahjong, Hong Kong Mahjong, etc.) are this app's own interpretation and reproduction of rules published by each organization or operator.",
        items: [
          'They are not approved, endorsed, supervised by, or affiliated with any of these organizations or operators.',
          'Rule set names are used only to indicate which published rules they are based on. Each name may be a trademark or registered trademark of its respective owner.',
          'No rule text has been copied. All explanations are written by this app.',
        ],
      },
      {
        heading: '3. The reproduction of the rules is not complete.',
        items: [
          'Matters not covered by the published rules are decided by this app (shown in the rulebook as "values supplied by this app").',
          'Due to differences in interpretation, revisions of the rules, bugs in this app or other reasons, the app may behave differently from the actual rules.',
          'As a result, winning-hand judgments, yaku and score calculations, rankings and outcomes may differ from those under the actual rules.',
          "Do not use this app's judgments as the basis for decisions in official tournaments, competitions or examinations.",
        ],
      },
    ],
    foot: 'This is a translation for reference. If there is any discrepancy, the Japanese version shall prevail.',
  },
  aboutLink: 'Before You Play',
  fairnessLink: 'Fairness of Play and Reproduction of the Rules',
  agree: 'Agree and start',
  scrollToAgree: 'Scroll to the end to enable the consent button.',
  close: 'Close',
  back: 'Back',
  terms: 'Terms of Use',
  titleNote: 'This game is for entertainment only and may not be used for gambling.',
};

const zh: NoticeTexts = {
  about: {
    title: '使用之前',
    sections: [
      {
        heading: '1. 请勿用于赌博',
        warn: true,
        items: [
          '这是一款以娱乐为目的的麻将游戏。分数和名次没有任何金钱价值。',
          '禁止以金钱或可兑换成金钱的物品下注，也禁止将本应用用于赌博的劝诱、中介或结算。本应用没有任何收付赌注的功能。',
        ],
      },
      {
        heading: '2. 不提供保证',
        items: ['不保证规则的准确性、运行和通信。因使用本应用而产生的任何损害（包括对局对手的言行），运营者概不负责。'],
      },
      {
        heading: '3. 请遵守您所在国家或地区的法律。',
      },
    ],
    foot: '详情请参阅《对局的公平性与规则的再现》和使用条款。',
  },
  fairness: {
    title: '对局的公平性与规则的再现',
    lead: '本页说明在本应用中进行的对局有多公平，以及在多大程度上符合实际规则。',
    sections: [
      {
        heading: '1. 关于公平性（本应用的机制）',
        items: [
          '牌山：在线对局的牌山在洗牌前，会用全体参与者的密钥加封。牌山数据保存在房主的设备上，但由于加上了所有人的密钥，房主也无法看到其内容，也无法选择牌的顺序。',
          '手牌：每位玩家的手牌只能在该玩家自己的设备上打开。房主和其他玩家都无法看到。',
          '电脑玩家：电脑玩家的手牌和思考在房主的设备上运行。如果房主解析设备中的数据，就能看到电脑玩家的手牌（单人游玩时，您就是房主）。',
          '在全体参与者串通等情况下，本机制无法防止。',
        ],
      },
      {
        heading: '2. 规则组未获得任何团体的认可',
        text: '本应用中可选择的规则组（M联赛、日本职业麻将联盟、最高位战、日本职业麻将协会、RMU、麻将联合、日本健康麻将协会、天凤、WRC、EMA、国标麻将、四川麻将、香港麻雀等），均为本应用根据各团体或运营者公开的规则，自行解释并再现的内容。',
        items: [
          '未获得各团体或运营者的批准、认可、监修，也与其无任何合作关系。',
          '规则组的名称仅用于表示依据了哪一套规则。各名称可能是其权利人的商标或注册商标。',
          '本应用未转载任何规则原文，所有说明文字均由本应用自行撰写。',
        ],
      },
      {
        heading: '3. 规则的再现并不完整',
        items: [
          '公开规则中未规定的事项，由本应用补充决定（在规则书中标示为“本应用补充的值”）。',
          '由于解释的差异、规则的修订或本应用的缺陷等原因，本应用的运行可能与实际规则不同。',
          '因此，和牌判定、番种及分数计算、名次和胜负，可能与按实际规则进行时不同。',
          '请勿将本应用的判定作为正式比赛、竞技或考核等的判断依据。',
        ],
      },
    ],
    foot: '本译文仅供参考。如有差异，以日语版本为准。',
  },
  aboutLink: '使用须知',
  fairnessLink: '对局的公平性与规则的再现',
  agree: '同意并开始',
  scrollToAgree: '阅读到最后后，即可按下同意按钮。',
  close: '关闭',
  back: '返回',
  terms: '使用条款',
  titleNote: '本游戏仅供娱乐，不得用于赌博。',
};

export const NOTICE: Record<BaseLang, NoticeTexts> = { ja, en, zh };
