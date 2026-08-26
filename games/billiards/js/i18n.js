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

      'tbl.pocket': 'ポケットあり', 'tbl.carom': 'キャロム版',
      'shape.A-01': '標準長方形', 'shape.A-02': '正六角形', 'shape.A-04': '楕円',
      'shape.A-06': 'スタジアム型', 'shape.A-07': 'ドーナツ型', 'shape.A-08': 'L字',
      'shape.A-09': '十字', 'shape.A-11': '星型',

      'mode.normal': '通常モード', 'mode.disturb': '妨害モード', 'mode.abnormal': '異常モード',
      'mod.G-13': '連鎖ボーナス', 'mod.G-14': '持ち時間制', 'mod.G-15': 'ミッション制',

      'cue.title': '撞球の癖', 'cue.simple': '簡単', 'cue.real': '本格', 'cue.custom': 'カスタム',
      'cue.note': '5軸とは別の項目です。遊ぶゲームの中身は変わらず、撞き味だけが変わります。',
      'cue.i1': 'ダブルヒット／プッシュショット判定',
      'cue.i2': 'ミスキュー判定',
      'cue.i3': 'スロー効果',
      'cue.i4': 'クッション反射時のスピン',
      'cue.i5': 'スピン転写',
      'cue.i6': '壁ズリ',
      'cue.i7': 'キュー構えの壁干渉判定',

      'opt.title': 'ルールオプション', 'opt.format': '対戦形式',
      'fmt.local': 'ローカル対戦', 'fmt.online': '通信対戦', 'fmt.ai': 'AI対戦',
      'fmt.practice': '練習モード', 'fmt.coop': '協力プレイ',
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
      'res.pts': '点', 'res.again': 'もう一度', 'res.toSetup': '設定へ戻る',
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

      'audio.title': '音を鳴らしますか？', 'audio.desc': 'BGMと効果音を再生します。あとから設定で変えられます。',
      'audio.yes': '再生する', 'audio.no': '鳴らさない',
      'set.title': '設定', 'set.bgm': 'BGM', 'set.sfx': '効果音', 'set.mute': 'ミュート',

      'rules.title': 'ルール確認',
      'ver.stage': '第1段階（標準的なビリヤード）',
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

      'tbl.pocket': 'with pockets', 'tbl.carom': 'carom (no pockets)',
      'shape.A-01': 'Standard rectangle', 'shape.A-02': 'Regular hexagon', 'shape.A-04': 'Ellipse',
      'shape.A-06': 'Stadium', 'shape.A-07': 'Donut', 'shape.A-08': 'L-shape',
      'shape.A-09': 'Cross', 'shape.A-11': 'Star',

      'mode.normal': 'Normal', 'mode.disturb': 'Interference', 'mode.abnormal': 'Anomaly',
      'mod.G-13': 'Combo bonus', 'mod.G-14': 'Shot clock', 'mod.G-15': 'Missions',

      'cue.title': 'Cue behaviour', 'cue.simple': 'Simple', 'cue.real': 'Realistic', 'cue.custom': 'Custom',
      'cue.note': 'Separate from the five axes. It changes how the balls feel, not what you play.',
      'cue.i1': 'Double hit / push shot',
      'cue.i2': 'Miscue',
      'cue.i3': 'Throw',
      'cue.i4': 'Spin off the cushion',
      'cue.i5': 'Spin transfer',
      'cue.i6': 'Rail slide',
      'cue.i7': 'Cue / rail interference',

      'opt.title': 'Rule options', 'opt.format': 'Opponent',
      'fmt.local': 'Local', 'fmt.online': 'Online', 'fmt.ai': 'vs AI',
      'fmt.practice': 'Practice', 'fmt.coop': 'Co-op',
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
      'res.pts': 'pts', 'res.again': 'Play again', 'res.toSetup': 'Back to setup',
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

      'audio.title': 'Play sound?', 'audio.desc': 'Music and effects. You can change this later in settings.',
      'audio.yes': 'Play', 'audio.no': 'Stay silent',
      'set.title': 'Settings', 'set.bgm': 'Music', 'set.sfx': 'Effects', 'set.mute': 'Mute',

      'rules.title': 'Rules',
      'ver.stage': 'Stage 1 (standard billiards)',
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

      'tbl.pocket': '有袋', 'tbl.carom': '开伦（无袋）',
      'shape.A-01': '标准长方形', 'shape.A-02': '正六边形', 'shape.A-04': '椭圆',
      'shape.A-06': '体育场型', 'shape.A-07': '甜甜圈型', 'shape.A-08': 'L 形',
      'shape.A-09': '十字形', 'shape.A-11': '星形',

      'mode.normal': '普通模式', 'mode.disturb': '干扰模式', 'mode.abnormal': '异常模式',
      'mod.G-13': '连击奖励', 'mod.G-14': '计时制', 'mod.G-15': '任务制',

      'cue.title': '击球手感', 'cue.simple': '简单', 'cue.real': '正统', 'cue.custom': '自定义',
      'cue.note': '与五轴无关的独立项目。只改变手感，不改变对局内容。',
      'cue.i1': '二次击球／推杆判定',
      'cue.i2': '滑杆判定',
      'cue.i3': '抛射（throw）',
      'cue.i4': '库边反弹时的旋转',
      'cue.i5': '旋转传递',
      'cue.i6': '贴库滑行',
      'cue.i7': '球杆与库边干涉判定',

      'opt.title': '规则选项', 'opt.format': '对战方式',
      'fmt.local': '本地对战', 'fmt.online': '联网对战', 'fmt.ai': '人机对战',
      'fmt.practice': '练习模式', 'fmt.coop': '合作模式',
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
      'res.pts': '分', 'res.again': '再来一局', 'res.toSetup': '返回设置',
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

      'audio.title': '要播放声音吗？', 'audio.desc': '播放背景音乐与音效，之后可在设置中更改。',
      'audio.yes': '播放', 'audio.no': '静音',
      'set.title': '设置', 'set.bgm': '音乐', 'set.sfx': '音效', 'set.mute': '静音',

      'rules.title': '规则',
      'ver.stage': '第 1 阶段（标准台球）',
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
