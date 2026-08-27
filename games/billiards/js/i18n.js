/**
 * MOMO Billiards — 多言語（ja / en / zh / cat）
 * MOMO Works 共通仕様 i18n-spec-v1.0.md ／ 共通ライブラリ lib/momo-lang/
 *
 * ・言語の判定・モード管理・アプリ間の引き継ぎは共通ライブラリ MomoLang が受け持つ。
 *   ここは辞書と適用（applyLang）だけを持つ。
 * ・CAT（猫語）は辞書を持たず、直前の言語（catBase）に合わせて鳴き声を組み立てる
 *   ＝MOMO 共通の動的鳴き声方式。
 */
const BilliardsI18N = (() => {
  'use strict';

  const DICT = {
    ja: {
      'sub': 'Any Shape, Any Rule, One Cue',
      'title.play': 'はじめる',
      'title.lead': '台の形もルールも変えられるビリヤード。',

      'nav.setup': 'ゲームを選ぶ',
      'nav.back': '戻る',
      'nav.close': '閉じる',

      'sw.standard': '標準', 'sw.special': '特殊',
      'sw.desc.standard': '標準：現実のビリヤードの範囲で遊びます',
      'sw.desc.special': '特殊：変わった台形状・特別ルール・妨害要素が選べるようになります',

      'axis.rule': 'ルール', 'axis.table': '台形状', 'axis.mode': 'モード',
      'axis.mod': '修飾子', 'axis.diff': '難易度',

      'rule.G-01': 'ナインボール', 'rule.G-02': 'エイトボール',
      'rule.G-03': 'ポケット・ローテーション', 'rule.G-04': 'キャロム（四球）',
      'rule.G-06': '陣取り', 'rule.G-08': 'サバイバル', 'rule.G-09': 'カーリング型',
      'rule.G-10': 'ゴルフ型', 'rule.G-11': 'ボウリング型',
      'rule.how.G-01': '1〜9番を使います。いつでも「いちばん小さい番号の玉」に最初に当てるのが決まり。当てたあとはどの玉が落ちてもかまいません。9番を落とした人の勝ちです。',
      'rule.how.G-02': '1〜7番（ソリッド）と9〜15番（ストライプ）に分かれます。最初に落とした玉で担当が決まり、自分の担当を全部落としてから8番を落とせば勝ち。先に8番を落とすと負けです。',
      'rule.how.G-03': '1〜15番を使い、いちばん小さい番号に最初に当てます。落とした玉の番号がそのまま得点。全部落ちた時点で得点の多い人の勝ちです。',
      'rule.how.G-04': 'ポケットのない台で、自分の手玉を他の2つの玉に続けて当てると1点。当たったら続けて撞けます。先に目標点に届いた人の勝ちです。',
      'rule.how.G-06': '落とした玉で盤面の陣地を取り合います。',
      'rule.how.G-08': '脱落せずに最後まで残ることを目指します。',
      'rule.how.G-09': '狙った位置へ玉を寄せて止める精度を競います。',
      'rule.how.G-10': '決められた順に玉を落とし、少ない打数を競います。',
      'rule.how.G-11': '決められた回数の中で落とした数を競います。',

      'tbl.pocket': 'ポケットあり', 'tbl.carom': 'キャロム版',
      'shape.A-01': '標準長方形', 'shape.A-02': '正六角形', 'shape.A-04': '楕円',
      'shape.A-06': 'スタジアム型', 'shape.A-07': 'ドーナツ型', 'shape.A-08': 'L字',
      'shape.A-09': '十字', 'shape.A-11': '星型',

      'mode.normal': '通常モード', 'mode.disturb': '妨害モード', 'mode.abnormal': '異常モード',
      'mod.G-13': '連鎖ボーナス', 'mod.G-14': '持ち時間制', 'mod.G-15': 'ミッション制',

      'cue.title': '撞球の癖', 'cue.simple': '簡単', 'cue.real': '本格', 'cue.custom': 'カスタム',
      'cue.note': '遊ぶゲームの中身は変わりません。変わるのは撞き味だけです。',
      'cue.i1': 'ダブルヒット／プッシュショット判定',
      'cue.i2': 'ミスキュー判定',
      'cue.i3': 'スロー効果',
      'cue.i4': 'クッション反射時のスピン',
      'cue.i5': 'スピン転写',
      'cue.i6': '壁ズリ',
      'cue.i7': 'キュー構えの壁干渉判定',

      'opt.title': 'ルールオプション', 'opt.format': '遊び方を選ぶ',
      'fmt.local': 'ローカル対戦', 'fmt.online': '通信対戦', 'fmt.ai': 'AI対戦',
      'fmt.practice': '練習モード', 'fmt.coop': '協力プレイ',
      'fmt.desc.local': '1台の端末で交代に撞く',
      'fmt.desc.ai': 'コンピュータと対戦する',
      'fmt.desc.practice': '勝敗なし・自由に撞く',
      'fmt.desc.online': '別の端末の人と対戦・観戦',
      'fmt.desc.coop': 'チームで共通の目標を目指す',
      'setup.title': '設定', 'setup.forFormat': '{f} の設定',
      'room.youDecide': '設定はあなた（ホスト）が決めます。全員が準備完了を押すと始まります',
      'room.hostDecides': '設定はホストが決めます。ここでは内容を見るだけです',
      'room.ready': '準備完了', 'room.notReady': '準備中', 'room.cancelReady': '準備を取り消す',
      'seat.you': 'あなた',
      'coop.title': '協力プレイ（チーム戦）',
      'coop.off': '勝ち負けは1人ずつで決まります。入れると、同じ組の人がひとまとまりになります',
      'coop.on': '同じ組の人は勝ち負けも得点もひとまとまりになります。組は自由に入れ替えられます',
      'coop.solo': '全員が同じ組＝競う相手がいません。決められた打数以内に達成できれば勝ちです',
      'coop.team': '{t}組',
      'coop.limit': '規定打数', 'coop.shots': '打',
      'lose.shotLimit': '規定打数を使い切りました（未達成）',
      'opt.players': '参加人数', 'opt.target': '目標点数', 'opt.handicap': 'ハンディキャップ',
      'opt.time.base': '基本制限時間', 'opt.time.bank': '持ち時間',
      'opt.sec': '秒', 'opt.min': '分',
      'opt.aiCount': 'AIの人数',
      'btn.start': 'ゲーム開始',

      'why.caromOnly': 'このルールはキャロム版の台でのみ成立します',
      'why.pocketOnly': 'このルールはポケットのある台でのみ成立します',
      'why.twoOnly': 'このルールは2人でのみ遊べます',
      'why.noGimmick': 'このモードにはギミックがありません',
      'why.needGimmick': 'この難易度はギミックのあるモードでのみ選べます',
      'why.noScore': 'このルールでは得点で勝敗が決まりません',
      'why.stage2': '第2段階で実装',
      'why.stage3': '第3段階で実装',

      'hud.turn': '手番', 'hud.score': '得点', 'hud.next': '次に当てる玉',
      'hud.foul': 'ファウル', 'hud.none': 'なし', 'hud.time': '持ち時間',
      'hud.base': '基本', 'hud.group': '担当', 'hud.open': '未定',
      'drop.title': '落ちた玉', 'drop.already': 'これまでに落ちた玉',
      'group.solid': 'ソリッド（1〜7）', 'group.stripe': 'ストライプ（9〜15）',

      'btn.aim': '構える', 'btn.back2d': '2Dへ戻る', 'btn.shoot': '撞く',
      'btn.deadlock': 'デッドロック申告', 'btn.rules': 'ルール確認',
      'btn.replay': 'リプレイ', 'btn.settings': '設定', 'btn.quit': '対局をやめる',
      'btn.yes': 'はい', 'btn.no': 'いいえ',

      'ph.place': '手玉を置く位置をドラッグで決めてください',
      'ph.aim': '盤面をなぞって方向を決め、「構える」で3D視点へ',
      'ph.cue': 'キューを引いて離すと撞きます。手玉をなぞると撞点、右のつまみで仰角',
      'ph.wait': '相手の手番です',
      'ph.rolling': '玉が止まるのを待っています',
      'ph.thinking': 'AIが考えています',

      'foul.V-01': '空振り', 'foul.V-02': '対象違い', 'foul.V-03': '無クッション',
      'foul.V-04': 'スクラッチ', 'foul.V-05': '場外', 'foul.V-06': 'ダブルヒット／プッシュショット',
      'foul.V-07': '手玉以外を撞いた', 'foul.V-08': '静止前の再ショット', 'foul.V-09': '手玉配置の違反',
      'ev.miscue': 'ミスキュー（ターン終了・罰則なし）',
      'ev.timeout': '時間切れ（ターン終了・罰則なし）',
      'ev.breakFail': 'ブレイク不成立',
      'ev.overpower': '強すぎます',

      'msg.nineRespot': 'ファウルを伴う9番投入のため、9番をスポットへ戻します',
      'msg.eightRespot': 'ブレイクで8番が落ちたため、スポットへ戻して続行します',
      'msg.groupSet': '担当グループが決まりました',
      'msg.rackCleared': '的球がすべて落ちました',
      'win.nine': '9番を落として勝利',
      'win.eight': '8番を落として勝利',
      'win.carom': '目標点数に到達',
      'lose.eightOff': '8番が場外へ出たため反則負け',
      'lose.eightEarly': '自グループを残して8番を落としたため反則負け',

      'res.title': '結果', 'res.win': '勝ち', 'res.lose': '負け', 'res.rank': '順位',
      'res.pts': '点', 'res.again': 'もう一度', 'res.toSetup': '設定へ戻る', 'res.toMenu': 'メニューに戻る',
      'res.draw': '同点',

      'dl.title': 'デッドロック', 'dl.ask': '対局が進まなくなっています。最初からやり直しますか？',
      'dl.wait': '相手の返事を待っています',
      'dl.refused': 'やり直しに同意しなかった参加者がいます',

      'lobby.title': '通信対戦', 'lobby.name': 'あなたの名前', 'lobby.room': '部屋の名前',
      'lobby.pw': 'あいことば（任意）', 'lobby.private': '一覧に出さない',
      'lobby.create': '部屋を作る', 'lobby.join': '参加', 'lobby.spectate': '観戦',
      'lobby.rooms': '部屋の一覧', 'lobby.empty': 'いま部屋はありません',
      'lobby.connecting': 'サーバーに接続中…', 'lobby.connected': 'サーバーに接続しました',
      'lobby.waiting': '参加者を待っています', 'lobby.refresh': '一覧を更新',
      'lobby.host': 'ホスト', 'lobby.players': '対局者', 'lobby.spectators': '観戦者',
      'lobby.verMismatch': 'バージョンが違うため接続できません（相手 {a} ／ あなた {b}）',
      'lobby.left': '相手が退出しました', 'lobby.disconnected': '接続が切れました',
      'lobby.startGame': '対局を開始', 'lobby.needPw': 'あいことばが必要です',
      'lobby.watching': '観戦中', 'lobby.syncing': '進行に追いついています…',
      'lobby.noSeat': 'この対局でのあなたの席が分かりません。いったん部屋を出て、入り直してください',

      'audio.title': '音を鳴らしますか？', 'audio.desc': 'BGMと効果音を再生します。あとから設定で変えられます。',
      'audio.yes': '再生する', 'audio.no': '鳴らさない',
      'set.title': '設定', 'set.bgm': 'BGM', 'set.sfx': '効果音', 'set.mute': 'ミュート',
      'set.speed': '玉の転がる速さ',
      'set.speedNote': '玉が転がる見た目の速さだけが変わります。キューの動きや画面の切り替わり、勝ち負けは変わりません。',

      'rules.title': 'ルール確認',
      'ver.stage': '第1段階（標準的なビリヤード）',

      'time.title': '持ち時間設定', 'time.enable': '持ち時間を使う',
      'time.off': '時間制限なしで遊びます',
      'time.other': 'そのほかの追加ルール',
      'btn.place': 'ここに置く',
      'ph.placeArea': 'ブレイクはこの範囲（ヘッドストリングより手前）に置きます',
      'ph.freeArea': '台のどこにでも置けます',
      'hint.dir': '◀ ここを左右にドラッグして向きを合わせる ▶',
      'hint.power': '強さ：引いて離す',
      'hint.tip': '撞点：なぞって決める',
      'hint.elev': 'キューの角度',
      'srv.connecting': 'サーバー接続中…', 'srv.online': 'サーバー接続済み', 'srv.offline': 'サーバー未接続',
      'lobby.pw2': 'パスワード',
      'lobby.mode': 'モード',
      'foot.about': 'MOMO Billiards について',
      'foot.desc': 'MOMO Billiards は、ナインボール・エイトボール・ポケットローテーション・キャロムを本格的な物理演算で遊べるブラウザゲームです。同じ端末での対戦、AI対戦、ひとりでの練習に加えて、オンライン対戦と観戦にも対応しています。4言語対応・PCとスマホの縦画面に対応。アカウント登録もインストールも不要です。',
      'foot.top': 'MOMO Works トップ', 'foot.games': 'ゲーム一覧', 'foot.tools': 'ツール一覧',
      'set.open': '設定',
    },

    en: {
      'sub': 'Any Shape, Any Rule, One Cue',
      'title.play': 'Start',
      'title.lead': 'Billiards where both the table and the rules can change.',

      'nav.setup': 'Choose a game', 'nav.back': 'Back', 'nav.close': 'Close',

      'sw.standard': 'Standard', 'sw.special': 'Special',
      'sw.desc.standard': 'Standard: play within real-world billiards.',
      'sw.desc.special': 'Special: unusual table shapes, special rules and interference become selectable.',

      'axis.rule': 'Rule', 'axis.table': 'Table', 'axis.mode': 'Mode',
      'axis.mod': 'Modifier', 'axis.diff': 'Difficulty',

      'rule.G-01': 'Nine-ball', 'rule.G-02': 'Eight-ball',
      'rule.G-03': 'Pocket Rotation', 'rule.G-04': 'Carom (four-ball)',
      'rule.G-06': 'Territory', 'rule.G-08': 'Survival', 'rule.G-09': 'Curling',
      'rule.G-10': 'Golf', 'rule.G-11': 'Bowling',
      'rule.how.G-01': 'Balls 1-9. You must always hit the lowest-numbered ball first; after that any ball may drop. Pocket the 9 and you win.',
      'rule.how.G-02': 'Balls split into solids (1-7) and stripes (9-15). The first ball you pocket sets your group; clear your group, then pocket the 8 to win. Pocket the 8 early and you lose.',
      'rule.how.G-03': 'Balls 1-15, always hitting the lowest number first. Each ball is worth its own number in points. When the rack is cleared, the highest score wins.',
      'rule.how.G-04': 'On a table with no pockets, score a point by making your cue ball touch two other balls in one shot. Score and you keep shooting. First to the target score wins.',
      'rule.how.G-06': 'Claim territory on the table with the balls you pocket.',
      'rule.how.G-08': 'Stay in the game while the others are knocked out.',
      'rule.how.G-09': 'Compete on how close you can stop a ball to the target spot.',
      'rule.how.G-10': 'Pocket the balls in a set order using as few shots as possible.',
      'rule.how.G-11': 'Pocket as many balls as you can within a fixed number of turns.',

      'tbl.pocket': 'with pockets', 'tbl.carom': 'carom (no pockets)',
      'shape.A-01': 'Standard rectangle', 'shape.A-02': 'Regular hexagon', 'shape.A-04': 'Ellipse',
      'shape.A-06': 'Stadium', 'shape.A-07': 'Donut', 'shape.A-08': 'L-shape',
      'shape.A-09': 'Cross', 'shape.A-11': 'Star',

      'mode.normal': 'Normal', 'mode.disturb': 'Interference', 'mode.abnormal': 'Anomaly',
      'mod.G-13': 'Combo bonus', 'mod.G-14': 'Shot clock', 'mod.G-15': 'Missions',

      'cue.title': 'Cue behaviour', 'cue.simple': 'Simple', 'cue.real': 'Realistic', 'cue.custom': 'Custom',
      'cue.note': 'This changes how the balls feel, not what you play.',
      'cue.i1': 'Double hit / push shot',
      'cue.i2': 'Miscue',
      'cue.i3': 'Throw',
      'cue.i4': 'Spin off the cushion',
      'cue.i5': 'Spin transfer',
      'cue.i6': 'Rail slide',
      'cue.i7': 'Cue / rail interference',

      'opt.title': 'Rule options', 'opt.format': 'Choose how to play',
      'fmt.local': 'Local', 'fmt.online': 'Online', 'fmt.ai': 'vs AI',
      'fmt.practice': 'Practice', 'fmt.coop': 'Co-op',
      'fmt.desc.local': 'Take turns on one device',
      'fmt.desc.ai': 'Play against the computer',
      'fmt.desc.practice': 'No win or loss, just shoot',
      'fmt.desc.online': 'Play or watch across devices',
      'fmt.desc.coop': 'Share one goal as a team',
      'setup.title': 'Setup', 'setup.forFormat': 'Settings for {f}',
      'room.youDecide': 'You (the host) set the rules. The game starts once everyone is ready',
      'room.hostDecides': 'The host sets the rules. This screen is read-only',
      'room.ready': 'Ready', 'room.notReady': 'Not ready', 'room.cancelReady': 'Cancel ready',
      'seat.you': 'You',
      'coop.title': 'Co-op (team play)',
      'coop.off': 'Each player wins or loses alone. Turn this on to group players into teams',
      'coop.on': 'Teammates share the win and the score. You can reshuffle the teams freely',
      'coop.solo': 'Everyone is on one team, so there is no opponent. Win by reaching the goal within the shot limit',
      'coop.team': 'Team {t}',
      'coop.limit': 'Shot limit', 'coop.shots': 'shots',
      'lose.shotLimit': 'Shot limit reached (goal not met)',
      'opt.players': 'Players', 'opt.target': 'Target score', 'opt.handicap': 'Handicap',
      'opt.time.base': 'Base time', 'opt.time.bank': 'Time bank',
      'opt.sec': 's', 'opt.min': 'min', 'opt.aiCount': 'AI opponents',
      'btn.start': 'Start game',

      'why.caromOnly': 'This rule needs a carom table (no pockets).',
      'why.pocketOnly': 'This rule needs a table with pockets.',
      'why.twoOnly': 'This rule is for two players only.',
      'why.noGimmick': 'This mode has no gimmicks.',
      'why.needGimmick': 'This difficulty is only available in modes with gimmicks.',
      'why.noScore': 'This rule is not decided on points.',
      'why.stage2': 'Coming in stage 2',
      'why.stage3': 'Coming in stage 3',

      'hud.turn': 'Turn', 'hud.score': 'Score', 'hud.next': 'Hit first',
      'hud.foul': 'Foul', 'hud.none': 'none', 'hud.time': 'Time bank',
      'hud.base': 'Base', 'hud.group': 'Group', 'hud.open': 'open',
      'drop.title': 'Pocketed', 'drop.already': 'Already pocketed',
      'group.solid': 'Solids (1-7)', 'group.stripe': 'Stripes (9-15)',

      'btn.aim': 'Take stance', 'btn.back2d': 'Back to 2D', 'btn.shoot': 'Shoot',
      'btn.deadlock': 'Declare deadlock', 'btn.rules': 'Rules',
      'btn.replay': 'Replay', 'btn.settings': 'Settings', 'btn.quit': 'Leave game',
      'btn.yes': 'Yes', 'btn.no': 'No',

      'ph.place': 'Drag to place the cue ball.',
      'ph.aim': 'Drag on the table to aim, then take your stance.',
      'ph.cue': 'Pull the cue back and release to shoot. Drag the cue ball for english, the slider for elevation.',
      'ph.wait': "Opponent's turn",
      'ph.rolling': 'Waiting for the balls to stop',
      'ph.thinking': 'The AI is thinking',

      'foul.V-01': 'No contact', 'foul.V-02': 'Wrong ball first', 'foul.V-03': 'No rail after contact',
      'foul.V-04': 'Scratch', 'foul.V-05': 'Ball off table', 'foul.V-06': 'Double hit / push shot',
      'foul.V-07': 'Struck a ball other than the cue ball', 'foul.V-08': 'Shot before all balls stopped',
      'foul.V-09': 'Illegal cue ball placement',
      'ev.miscue': 'Miscue (turn ends, no penalty)',
      'ev.timeout': 'Time out (turn ends, no penalty)',
      'ev.breakFail': 'Illegal break',
      'ev.overpower': 'Too hard',

      'msg.nineRespot': 'The 9 was pocketed on a foul, so it returns to the spot.',
      'msg.eightRespot': 'The 8 fell on the break, so it returns to the spot.',
      'msg.groupSet': 'Groups have been decided.',
      'msg.rackCleared': 'All object balls are down.',
      'win.nine': 'Won by pocketing the 9',
      'win.eight': 'Won by pocketing the 8',
      'win.carom': 'Reached the target score',
      'lose.eightOff': 'Loss: the 8 left the table',
      'lose.eightEarly': 'Loss: the 8 was pocketed too early',

      'res.title': 'Result', 'res.win': 'Win', 'res.lose': 'Lose', 'res.rank': 'Place',
      'res.pts': 'pts', 'res.again': 'Play again', 'res.toSetup': 'Back to setup', 'res.toMenu': 'Back to menu',
      'res.draw': 'Draw',

      'dl.title': 'Deadlock', 'dl.ask': 'The game is not progressing. Restart from the break?',
      'dl.wait': 'Waiting for the others to answer',
      'dl.refused': 'Someone did not agree to restart.',

      'lobby.title': 'Online', 'lobby.name': 'Your name', 'lobby.room': 'Room name',
      'lobby.pw': 'Password (optional)', 'lobby.private': 'Hide from the list',
      'lobby.create': 'Create room', 'lobby.join': 'Join', 'lobby.spectate': 'Watch',
      'lobby.rooms': 'Rooms', 'lobby.empty': 'No rooms right now',
      'lobby.connecting': 'Connecting…', 'lobby.connected': 'Connected',
      'lobby.waiting': 'Waiting for players', 'lobby.refresh': 'Refresh',
      'lobby.host': 'Host', 'lobby.players': 'Players', 'lobby.spectators': 'Spectators',
      'lobby.verMismatch': 'Version mismatch, cannot connect (them {a} / you {b}).',
      'lobby.left': 'The other player left.', 'lobby.disconnected': 'Disconnected.',
      'lobby.startGame': 'Start the game', 'lobby.needPw': 'A password is required.',
      'lobby.watching': 'Watching', 'lobby.syncing': 'Catching up…',
      'lobby.noSeat': 'Your seat in this game could not be identified. Please leave the room and join again',

      'audio.title': 'Play sound?', 'audio.desc': 'Music and effects. You can change this later in settings.',
      'audio.yes': 'Play', 'audio.no': 'Stay silent',
      'set.title': 'Settings', 'set.bgm': 'Music', 'set.sfx': 'Effects', 'set.mute': 'Mute',
      'set.speed': 'Ball rolling speed',
      'set.speedNote': 'Changes only how fast the balls appear to roll. Cue movement, screen changes and the outcome stay the same.',

      'rules.title': 'Rules',
      'ver.stage': 'Stage 1 (standard billiards)',

      'time.title': 'Shot clock', 'time.enable': 'Use a shot clock',
      'time.off': 'No time limit.',
      'time.other': 'Other extras',
      'btn.place': 'Place it here',
      'ph.placeArea': 'Break from behind the head string (shaded area).',
      'ph.freeArea': 'You may place it anywhere on the table.',
      'hint.dir': '◀ drag here to fine-tune your aim ▶',
      'hint.power': 'Power: pull back & release',
      'hint.tip': 'Tip spot: drag to set',
      'hint.elev': 'Cue elevation',
      'srv.connecting': 'Connecting to the server…', 'srv.online': 'Server connected', 'srv.offline': 'Server offline',
      'lobby.pw2': 'Password',
      'lobby.mode': 'Mode',
      'foot.about': 'About MOMO Billiards',
      'foot.desc': 'MOMO Billiards is a browser billiards game with a full physics engine, offering nine-ball, eight-ball, pocket rotation and carom. Play on one device, against the AI, alone in practice, or online — and watch other people play. 4-language UI, works on PC and mobile portrait. No account, no install.',
      'foot.top': 'MOMO Works', 'foot.games': 'Games', 'foot.tools': 'Tools',
      'set.open': 'Settings',
    },

    zh: {
      'sub': '百变球台，一杆入魂',
      'title.play': '开始',
      'title.lead': '球台与规则都能改变的台球。',

      'nav.setup': '选择对局', 'nav.back': '返回', 'nav.close': '关闭',

      'sw.standard': '标准', 'sw.special': '特殊',
      'sw.desc.standard': '标准：在现实台球的范围内游玩。',
      'sw.desc.special': '特殊：可选择异形球台、特别规则与干扰要素。',

      'axis.rule': '规则', 'axis.table': '球台', 'axis.mode': '模式',
      'axis.mod': '修饰', 'axis.diff': '难度',

      'rule.G-01': '九球', 'rule.G-02': '八球',
      'rule.G-03': '落袋轮转', 'rule.G-04': '开伦（四球）',
      'rule.G-06': '占地', 'rule.G-08': '生存', 'rule.G-09': '冰壶型',
      'rule.G-10': '高尔夫型', 'rule.G-11': '保龄型',
      'rule.how.G-01': '使用1〜9号球。每次都必须先击中号码最小的球，之后落哪颗球都可以。打进9号球者获胜。',
      'rule.how.G-02': '分为全色球（1〜7）与花色球（9〜15）。首次进球决定你的组别，清完本组后再打进8号球即获胜；提前打进8号球则判负。',
      'rule.how.G-03': '使用1〜15号球，每次先击中号码最小的球。进球的号码即为得分，全部清台后得分高者获胜。',
      'rule.how.G-04': '在没有球袋的球台上，让自己的主球连续碰到另外两颗球即得1分。得分可继续击球，先达到目标分者获胜。',
      'rule.how.G-06': '用打进的球争夺台面上的地盘。',
      'rule.how.G-08': '目标是坚持到最后不被淘汰。',
      'rule.how.G-09': '比拼把球停在目标位置的精准度。',
      'rule.how.G-10': '按指定顺序进球，比拼杆数少。',
      'rule.how.G-11': '在规定的轮数内比拼进球数。',

      'tbl.pocket': '有袋', 'tbl.carom': '开伦（无袋）',
      'shape.A-01': '标准长方形', 'shape.A-02': '正六边形', 'shape.A-04': '椭圆',
      'shape.A-06': '体育场型', 'shape.A-07': '甜甜圈型', 'shape.A-08': 'L 形',
      'shape.A-09': '十字形', 'shape.A-11': '星形',

      'mode.normal': '普通模式', 'mode.disturb': '干扰模式', 'mode.abnormal': '异常模式',
      'mod.G-13': '连击奖励', 'mod.G-14': '计时制', 'mod.G-15': '任务制',

      'cue.title': '击球手感', 'cue.simple': '简单', 'cue.real': '正统', 'cue.custom': '自定义',
      'cue.note': '只改变手感，不改变对局内容。',
      'cue.i1': '二次击球／推杆判定',
      'cue.i2': '滑杆判定',
      'cue.i3': '抛射（throw）',
      'cue.i4': '库边反弹时的旋转',
      'cue.i5': '旋转传递',
      'cue.i6': '贴库滑行',
      'cue.i7': '球杆与库边干涉判定',

      'opt.title': '规则选项', 'opt.format': '选择玩法',
      'fmt.local': '本地对战', 'fmt.online': '联网对战', 'fmt.ai': '人机对战',
      'fmt.practice': '练习模式', 'fmt.coop': '合作模式',
      'fmt.desc.local': '同一台设备轮流击球',
      'fmt.desc.ai': '与电脑对战',
      'fmt.desc.practice': '不分胜负，自由击球',
      'fmt.desc.online': '与其他设备对战或观战',
      'fmt.desc.coop': '组队达成共同目标',
      'setup.title': '设置', 'setup.forFormat': '{f} 的设置',
      'room.youDecide': '由你（房主）设定规则。所有人准备完毕即开始',
      'room.hostDecides': '规则由房主设定。此处仅供查看',
      'room.ready': '准备完毕', 'room.notReady': '准备中', 'room.cancelReady': '取消准备',
      'seat.you': '你',
      'coop.title': '合作模式（组队）',
      'coop.off': '各自分胜负。开启后，同组的人算作一体',
      'coop.on': '同组的人共享胜负与得分。分组可以自由调整',
      'coop.solo': '全员同组＝没有对手。在规定杆数内达成即获胜',
      'coop.team': '{t}组',
      'coop.limit': '规定杆数', 'coop.shots': '杆',
      'lose.shotLimit': '已用完规定杆数（未达成）',
      'opt.players': '人数', 'opt.target': '目标分', 'opt.handicap': '让分',
      'opt.time.base': '基本时限', 'opt.time.bank': '保留时间',
      'opt.sec': '秒', 'opt.min': '分', 'opt.aiCount': '电脑人数',
      'btn.start': '开始对局',

      'why.caromOnly': '该规则只能在无袋的开伦球台上进行。',
      'why.pocketOnly': '该规则需要有袋的球台。',
      'why.twoOnly': '该规则仅限两人。',
      'why.noGimmick': '该模式没有机关。',
      'why.needGimmick': '该难度仅在有机关的模式中可选。',
      'why.noScore': '该规则不以得分决定胜负。',
      'why.stage2': '第 2 阶段实装',
      'why.stage3': '第 3 阶段实装',

      'hud.turn': '轮到', 'hud.score': '得分', 'hud.next': '先击打',
      'hud.foul': '犯规', 'hud.none': '无', 'hud.time': '保留时间',
      'hud.base': '基本', 'hud.group': '组别', 'hud.open': '未定',
      'drop.title': '已进袋', 'drop.already': '此前进袋的球',
      'group.solid': '全色（1〜7）', 'group.stripe': '花色（9〜15）',

      'btn.aim': '架杆', 'btn.back2d': '回到俯视', 'btn.shoot': '击球',
      'btn.deadlock': '申报僵局', 'btn.rules': '规则',
      'btn.replay': '回放', 'btn.settings': '设置', 'btn.quit': '退出对局',
      'btn.yes': '是', 'btn.no': '否',

      'ph.place': '拖动决定主球的摆放位置。',
      'ph.aim': '在台面上拖动瞄准，然后架杆。',
      'ph.cue': '拉杆后松手即击球。拖动主球调整击点，右侧滑块调整仰角。',
      'ph.wait': '对手的回合',
      'ph.rolling': '等待球停下',
      'ph.thinking': '电脑思考中',

      'foul.V-01': '空杆', 'foul.V-02': '首球错误', 'foul.V-03': '击球后无库',
      'foul.V-04': '主球落袋', 'foul.V-05': '球离台', 'foul.V-06': '二次击球／推杆',
      'foul.V-07': '击打了主球以外的球', 'foul.V-08': '球未停稳即击球',
      'foul.V-09': '主球摆放违规',
      'ev.miscue': '滑杆（回合结束，无处罚）',
      'ev.timeout': '超时（回合结束，无处罚）',
      'ev.breakFail': '开球不成立',
      'ev.overpower': '力量过大',

      'msg.nineRespot': '伴随犯规打进 9 号球，9 号球回到置球点。',
      'msg.eightRespot': '开球时 8 号球落袋，放回置球点继续。',
      'msg.groupSet': '组别已确定。',
      'msg.rackCleared': '目标球已全部落袋。',
      'win.nine': '打进 9 号球获胜',
      'win.eight': '打进 8 号球获胜',
      'win.carom': '达到目标分',
      'lose.eightOff': '8 号球离台，犯规判负',
      'lose.eightEarly': '本组未清即打进 8 号球，犯规判负',

      'res.title': '结果', 'res.win': '胜', 'res.lose': '负', 'res.rank': '名次',
      'res.pts': '分', 'res.again': '再来一局', 'res.toSetup': '返回设置', 'res.toMenu': '返回菜单',
      'res.draw': '平局',

      'dl.title': '僵局', 'dl.ask': '对局无法推进。要从开球重来吗？',
      'dl.wait': '等待其他人的回答',
      'dl.refused': '有参加者不同意重来。',

      'lobby.title': '联网对战', 'lobby.name': '你的名字', 'lobby.room': '房间名',
      'lobby.pw': '口令（可选）', 'lobby.private': '不显示在列表',
      'lobby.create': '创建房间', 'lobby.join': '加入', 'lobby.spectate': '观战',
      'lobby.rooms': '房间列表', 'lobby.empty': '目前没有房间',
      'lobby.connecting': '正在连接…', 'lobby.connected': '已连接',
      'lobby.waiting': '等待参加者', 'lobby.refresh': '刷新',
      'lobby.host': '房主', 'lobby.players': '对局者', 'lobby.spectators': '观战者',
      'lobby.verMismatch': '版本不一致，无法连接（对方 {a} ／ 你 {b}）。',
      'lobby.left': '对手已离开。', 'lobby.disconnected': '连接已断开。',
      'lobby.startGame': '开始对局', 'lobby.needPw': '需要口令。',
      'lobby.watching': '观战中', 'lobby.syncing': '正在追上进度…',
      'lobby.noSeat': '无法确认你在本局中的座位。请退出房间后重新加入',

      'audio.title': '要播放声音吗？', 'audio.desc': '播放背景音乐与音效，之后可在设置中更改。',
      'audio.yes': '播放', 'audio.no': '静音',
      'set.title': '设置', 'set.bgm': '音乐', 'set.sfx': '音效', 'set.mute': '静音',
      'set.speed': '球滚动的速度',
      'set.speedNote': '只改变球滚动的视觉速度。球杆动作、画面切换与胜负都不受影响。',

      'rules.title': '规则',
      'ver.stage': '第 1 阶段（标准台球）',

      'time.title': '计时设置', 'time.enable': '使用计时',
      'time.off': '不设时间限制。',
      'time.other': '其他附加规则',
      'btn.place': '放在这里',
      'ph.placeArea': '开球需放在开球线之后（阴影范围内）。',
      'ph.freeArea': '可以放在台面的任意位置。',
      'hint.dir': '◀ 在此左右拖动微调方向 ▶',
      'hint.power': '力度：拉杆后松手',
      'hint.tip': '击点：拖动调整',
      'hint.elev': '球杆仰角',
      'srv.connecting': '正在连接服务器…', 'srv.online': '已连接服务器', 'srv.offline': '未连接服务器',
      'lobby.pw2': '密码',
      'lobby.mode': '模式',
      'foot.about': '关于 MOMO Billiards',
      'foot.desc': 'MOMO Billiards 是一款配备完整物理演算的浏览器台球游戏，可游玩九球、八球、落袋轮转与开伦。支持同一设备对战、人机对战、单人练习，以及在线对战与观战。支持 4 语言、可在 PC 与手机竖屏使用。无需注册、无需安装。',
      'foot.top': 'MOMO Works 首页', 'foot.games': '游戏列表', 'foot.tools': '工具列表',
      'set.open': '设置',
    },
  };

  // 難易度の呼び名は MOMO Works 共通（訳さない）
  const DIFF_LABEL = { easy: 'Easy', hard: 'Hard', apocalypse: 'Apocalypse' };

  const LANG_APP_ID = 'billiards';
  const SUPPORTED = ['ja', 'en', 'zh', 'cat'];

  function detectFallback() {
    try {
      const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
      for (let i = 0; i < list.length; i++) {
        const l = (list[i] || '').toLowerCase();
        if (l.indexOf('ja') === 0) return 'ja';
        if (l.indexOf('zh') === 0) return 'zh';
        if (l.indexOf('en') === 0) return 'en';
      }
      return 'en';
    } catch (e) { return 'ja'; }
  }

  let langMode = 'auto';
  let currentLang = 'ja';

  function init() {
    if (window.MomoLang) MomoLang.bind(LANG_APP_ID, { supportedLangs: SUPPORTED });
    langMode = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
    currentLang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID)
      : (langMode === 'auto' ? detectFallback() : (SUPPORTED.indexOf(langMode) >= 0 ? langMode : detectFallback()));
  }

  function catBase() {
    const b = window.MomoLang ? MomoLang.getCatBase(LANG_APP_ID) : 'ja';
    return (b === 'en' || b === 'zh') ? b : 'ja';
  }

  // CAT（猫語）。キーの性格ごとに語彙を変える動的鳴き声方式。
  function catSpeak(key) {
    const base = catBase();
    const angry = key.indexOf('foul.') === 0 || key.indexOf('lose.') === 0 || key.indexOf('why.') === 0;
    const calm = key.indexOf('ph.') === 0 || key.indexOf('cue.note') === 0;
    let vocab;
    if (base === 'en') {
      vocab = angry ? ['HISS!', 'SPIT!', 'FSSST!']
        : calm ? ['purrrr...', 'mrrr...', 'prrr...']
          : ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'];
    } else if (base === 'zh') {
      vocab = angry ? ['嘶！', '呸！', '嘶嘶！']
        : calm ? ['呼噜…', '咕噜…', '喵呼…']
          : ['喵', '喵喵', '喵！', '喵喵喵'];
    } else {
      vocab = angry ? ['シャー！', 'フーッ！', 'シャシャシャ！']
        : calm ? ['ごろごろ…', 'にゃ…', 'むーにゃ…']
          : ['にゃ', 'にゃー', 'にゃ！', 'みゃ', 'にゃにゃ！'];
    }
    return vocab[Math.floor(Math.random() * vocab.length)];
  }

  function t(key, params) {
    let s;
    if (currentLang === 'cat') s = catSpeak(key);
    else {
      const d = DICT[currentLang] || DICT.ja;
      s = (d[key] != null) ? d[key] : (DICT.ja[key] != null ? DICT.ja[key] : key);
    }
    if (params) s = String(s).replace(/\{(\w+)\}/g, (m, k) => params[k] !== undefined ? params[k] : m);
    return s;
  }

  /** 字幕・ブランド表記は CAT でも本来のテキストを出す（他アプリと同じ扱い） */
  function brandLang() { return currentLang === 'cat' ? catBase() : currentLang; }

  function setMode(mode) {
    langMode = mode;
    currentLang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
      : (mode === 'auto' ? detectFallback() : (SUPPORTED.indexOf(mode) >= 0 ? mode : detectFallback()));
    return currentLang;
  }

  return {
    init, t, setMode, DIFF_LABEL, SUPPORTED, LANG_APP_ID,
    get lang() { return currentLang; },
    get mode() { return langMode; },
    brandLang, catBase,
  };
})();

if (typeof window !== 'undefined') window.BilliardsI18N = BilliardsI18N;
