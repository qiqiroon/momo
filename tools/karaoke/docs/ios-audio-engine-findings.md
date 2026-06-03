# iOS 音声エンジン 実機検証結果 (根拠ドキュメント)

> このファイルは MOMO Karaoke の iOS 音声エンジンを HTMLAudio から Web Audio
> (AudioBufferSource) へ変換する設計判断の **一次根拠** です。
> コード中の「なぜ iOS が Web Audio なのか / なぜ HTMLAudio を消したのか」 という
> breadcrumb コメントはこのファイルを指しています。
> 再現用の実験コードは同フォルダの `probe3.html` / `probe4.html`。

検証日: **2026-06-03**
検証端末: **iPhone / iOS 18.7 Safari** (`Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 ...)`)
sampleRate: 48000

---

## 背景 — なぜ検証したか

iOS Safari のカラオケで「モニター（BGM＋自分の声）」 と「生成した MIX (録音物)」 の
タイミングがずれる問題があり、機種別 mixOffset (この実機で −70ms) で誤魔化していた。

原因モデルの訂正（重要）:

- **誤**: 「iOS take=HTMLAudio・iOS BGM=Web Audio」
- **正**: iOS は **BGM も Take も両方 HTMLAudioElement** (`iosAudioEl` / `iosTakeAudioEl`)。
  PC は両方 AudioBufferSource (Web Audio)。 MIX は両機種とも OfflineAudioContext。

→ iOS のモニターだけ「緩く同期した 2 つの HTMLAudio」 (`play()` 開始ジッタ ＋
`syncTakeToBgm` の 200ms ポーリング nudge ＋ HTMLAudio 出力レイテンシ) で、
サンプル正確な OfflineAudioContext の MIX とずれる。 PC はモニターも MIX も Web Audio
なので mixOffset=0。

根本修正の仮説: **iOS の BGM＋Take を Web Audio (AudioBufferSource) に変換すれば
PC と同じく mixOffset=0 になる**。 ただし過去、 iOS では「getUserMedia / 録音後に
AudioContext 再生が無音化する」「AudioWorklet が不安定」 という理由で HTMLAudio を
採用していた。 その前提が今も成り立つかを実機で検証したのが本ドキュメント。

---

## 検証 1 (probe3.html) — getUserMedia 後の Web Audio 再生

手順: `getUserMedia` でマイク取得 → 解放 → **同一 AudioContext** で
AudioBufferSource の BGM＋Take を鳴らし、 クリック 15 発の間隔ずれを測定。

結果:
- `ctx.state = running`、 trial1/trial2 とも **検出 15/15・最大ずれ 4ms** = 完全ロック。

結論: **getUserMedia 後でも、 同一 context なら Web Audio は鳴る・ずれない。**
(context を作り直す Phase C は、 iOS が 2 個目の AudioContext を user gesture 無しでは
resume しない仕様のためハングした。 = 「録音のたびに context を作り直さない」 設計にすれば回避可。)

---

## 検証 2 (probe4.html Test1) — 実 MediaRecorder 録音後の Web Audio 再生 ★決定的

手順: 単一 AudioContext (gesture 生成) で、
Phase1 baseline → **Phase2 実 MediaRecorder で 1.5 秒録音 (start→1.5s→stop、
38365 bytes のデータ取得を確認)** → Phase3 同一 context で BGM＋Take を鳴らす。

結果:
- Phase3: `ctx.state = running`、 **検出 15/15・最大ずれ 4ms** = 完全ロック。

結論: **実際の録音サイクル後でも、 同一 context の Web Audio は鳴る・ずれない。**
→ コード中の「録音後は AudioContext 再生が無音化する」 という前提コメントは
**iOS 18.7 では obsolete (もう当てはまらない)**。 これが Web Audio 化の GO サイン。

---

## 検証 3 (probe4.html Test2) — 画面ロック中の Web Audio 挙動

手順: 1 秒周期のクリックを AudioBufferSource でループ、 `performance.now()` (wall) と
`ctx.currentTime` (ctx) を 250ms 毎にサンプル。 途中で電源ボタンを押して画面ロック→解除。

結果:
- wall 経過 15.0s に対し ctx 経過 10.0s (= ロック中 ctx クロックが約 5 秒止まった)。
- `ctx.state` が最終的に **`interrupted`** に。 `visibilitychange` で hidden=true。
- 解除後も **自動復帰しなかった** (interrupted のまま)。

結論: **Web Audio (AudioContext) は画面ロックで停止/suspend する。**
HTMLAudio はロック中も生存する。 → これが Web Audio 化の唯一の退行リスク。

※ロック検知 verdict が「検知できない」 と出たのは probe4 の検出ロジックのバグ
(単一の 3 秒超ギャップを期待したが iOS はタイマーを約 1 秒チャンクで間引くため)。
データ自体 (wall 15s vs ctx 10s ＋ state=interrupted) は正しく取れており、 結論は確定。

---

## 退行リスクの扱い (ユーザー判断 2026-06-03)

画面ロックで Web Audio が止まる退行は **許容**。 理由:
元の問題は「スクリーンセーバー自動オフで録音が止まる」 こと。 正しい対策は
**`navigator.wakeLock` で画面オフ自体を防ぐ** こと。 過去にあった「オフでも鳴らし
続ける」 対応は claude とユーザーの行き違いによる誤った方針だった。 本番は MIX 中に
既に wakeLock 使用。 着信からの復帰は nice-to-have、 **通話を邪魔しないことが重要**。

---

## speed / pitch の扱い (ユーザー判断 2026-06-03)

- **重要なのは PITCH 変更。** speed と pitch のどちらか一方しか残せないなら **pitch を残す**。
  ピッチ変更の副作用でスピードが変わるのは許容。
- AudioBufferSource は worklet 無しでは pitch/speed を分離できない
  (`playbackRate` も `detune` も両方を同時に動かす)。 分離には pitch-shift worklet
  (`bgmShifter` / `takeShifter`) が必要。
- v2.62 fix2 で iOS の PITCH は「AudioWorklet pitch param 不安定」 として無効化済
  (iOS SPEED は有効だった)。 → Web Audio 化に際し worklet を iOS で使えるか要実機確認。
- **方針**: まず worklet 維持 (PC と同じ式) で iOS の pitch 安定性を実機検証。
  不安定なら **PITCH を `playbackRate` にマップ** (ピッチ優先・スピード連動を許容) に
  フォールバック。 SPEED 単独機能は捨ててもよい。

worklet の pitch 式 (invariant、 PC 実績):
- take: `takeShifter.pitch = 2^((curSt − takeSt)/12) / (curSp/takeSp)`
- BGM:  `bgmShifter.pitch  = 2^(st/12) / sp`
- MIX 内: `2^(−takeSt/12) * takeSp`、 `bufOffset = (−outStart)/takeSp`、
  `playbackRate = 1/takeSp`

---

## 設計への結論

1. iOS の BGM＋Take を AudioBufferSource (Web Audio) に変換する。
   Web Audio グラフは iOS でも既に存在する (`ensureAudioGraph` が iOS ガード無しで
   フルグラフ構築、 `master.connect(destination)` あり)。 `installIOSTransport()` が
   bgmTransport を HTMLAudio で上書きし、 `startTakePlaybackIOS()` が take を bypass
   しているだけ。 → **変換 = 既存グラフの bypass をやめる**。
2. `navigator.wakeLock` で録音/モニター中の画面オフを防ぐ (ロック退行の相殺)。
3. iOS の mixOffset default を 0 にできる見込み (monitor==MIX で要確認)。
4. ボーナス: iOS の volume スライダ無効バグ (HTMLMediaElement.volume を iOS が無視する仕様)
   も、 Web Audio の `bgmGain` / `voxGain` 経由になることで自然解消する見込み。

実装は v2.65 (Web Audio 化) → v2.66 (wakeLock＋interruption) → v2.67 (mixOffset=0)
→ v2.68 (死んだ HTMLAudio コード削除) の 0.01 刻みで、 各段で iOS 実機 web 確認。

復元ポイント: `v2.64e-stable` git tag ＋ `tools/karaoke/v2.64e/` フォルダ。
