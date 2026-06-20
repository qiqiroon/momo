# momo-lang — MOMO Works 共通 言語ルーチン（案件⑦）

> **この文書は開発者向け（主に作者と Claude）です。アプリの利用者は読みません。**
> MOMO の各アプリに「言語の自動判定・切り替え」を組み込むための手順書を兼ねています。
> 別のセッション（別アプリの開発）でも、**この readme を読めばそのまま実装できる**ことを目標にしています。

全アプリ共通の「言語の自動判定・モード管理・保存ルール」を1か所に集約した共有ライブラリ。
**言語切り替えの動きを直すときは、この `momo-lang.js` 1ファイルだけ**直せば、利用する全アプリに反映される（各アプリにロジックを複製しない）。

- 本体: `momo-lang.js`
- 公開URL: `https://qiqiroon.github.io/momo/lib/momo-lang/momo-lang.js`
- 最初の採用アプリ（参考実装）: `tools/links/index.html`

---

## 0. 前提（採用するアプリの条件）

- **対応言語は 4 言語（ja / en / zh / cat）で実装すること。** 本ルーチンは「auto のときブラウザ言語から ja / zh / en を選ぶ（cat は自動選択しない）」前提。
- もしそのアプリが 4 言語そろっていなければ、**先に不足言語の翻訳辞書を足して 4 言語化**してから本ルーチンを採用する（「対応外の言語に解決して画面が崩れる」のを避けるため）。
- 各アプリの **翻訳辞書・`applyLang`・言語ドロップダウン・`catBase`（CATの基準言語）はアプリ側のまま**。本ルーチンは「判定 / モード / 保存ルール」だけを担当する。

---

## 1. 設計ルール

- **言語モード** = `auto` / `ja` / `en` / `zh` / `cat`。
- **モードはアプリごとにローカル保存**（キー `momolang_mode_<appId>`、未設定の既定 = `auto`）。
- **auto** のときだけ、ブラウザ/OS言語から `ja` / `zh` / `en` を判定（それ以外は `en`。CATは自動選択しない）。
- **明示言語（auto以外）を選んだ時だけ**、全MOMO共有キー `momoLang` に書く＝**他アプリも追従**。
  - ★autoは共有に書かない（autoを共有に書くと、未対応の旧アプリが `ja` にリセットして共有値を壊すため）。
- 起動の読み元は「アプリごとのローカルモード」。共有 `momoLang` は **“書くだけ・起動の読み元にしない”**。
- **選択肢（auto/ja/en/zh/cat）は廃止しない。常に選べるままにする。**
- 将来（全アプリが auto 対応になった後）は、**選択（auto を含む）を全アプリで引き継げる**ようにする想定：
  - 今は auto を共有キー `momoLang` に書かない（未対応の旧アプリが壊れるため）＝**auto はアプリ間で引き継がれない**。明示言語（ja/en/zh/cat）だけが共有され他アプリに伝わる。
  - 全アプリが auto 対応になれば、**モード自体（auto を含む）を共有して**、アプリ間で選択がそのまま伝わるようにする（その変更も基本はこのファイル＋各アプリのモード保存先の切替で済む）。
  - ＝「モード選択を畳む／auto を既定にして固定する」のではなく、「**auto も含めて選択をアプリ間で共有できるようにする**」のが最終目標。

---

## 2. API（`window.MomoLang`）

| 関数 | 返り値 | 説明 |
|---|---|---|
| `detect()` | `'ja'\|'en'\|'zh'` | ブラウザ/OS言語から判定（他は `en`） |
| `getMode(appId)` | モード文字列 | そのアプリのローカルモード（未設定=`auto`） |
| `resolve(appId)` | 表示言語(`ja/en/zh/cat`) | モードから実際の表示言語を解決（auto→detect） |
| `setMode(appId, mode)` | 表示言語 | モードを保存（明示のみ共有 `momoLang` へ）。実際の表示言語を返す |

`MomoLang.LANGS = ['ja','en','zh','cat']` / `MomoLang.MODES = ['auto','ja','en','zh','cat']`。

---

## 3. 組み込み手順（どのアプリでも共通）

`<appId>` はそのアプリの短い識別名（例: `links` / `karaoke` / `reversi`）。**他アプリと重複しない名前**にする。

### 手順1. 共通ルーチンを読み込む（`<head>` 内・本体スクリプトより前・`defer` 不可）
```html
<script src="/momo/lib/momo-lang/momo-lang.js"></script>
```
※ `defer` を付けない。起動時の初期言語決定に同期的に使うため、本体スクリプトより先に実行させる。

### 手順2. 起動時の言語決定（アプリ本体スクリプト内、I18N定義の近く）
```js
const SUPPORTED_LANGS = ['ja','en','zh','cat'];
const LANG_APP_ID = '<appId>';
// MomoLang 未ロード時(file:// やネット不通)に備える最小fallback
function _langDetectFallback(){
  try{ const list=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||'en'];
    for(let i=0;i<list.length;i++){ const l=(list[i]||'').toLowerCase();
      if(l.indexOf('ja')===0)return'ja'; if(l.indexOf('zh')===0)return'zh'; if(l.indexOf('en')===0)return'en'; }
    return'en';
  }catch(e){return'ja';}
}
let catBase = 'ja';   // CATの基準言語（cat選択直前の言語を覚える。アプリ固有）
let langMode    = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
let currentLang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID)
                : (langMode==='auto' ? _langDetectFallback()
                   : (SUPPORTED_LANGS.includes(langMode) ? langMode : _langDetectFallback()));
```

### 手順3. 言語切り替えハンドラ
```js
function onLangChange(mode){
  // mode = auto/ja/en/zh/cat。保存ルール(ローカルモード+明示のみ共有)は共通ルーチンに委譲。
  if(mode==='cat' && currentLang!=='cat') catBase = currentLang;   // catBaseはアプリ固有
  langMode = mode;
  currentLang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
              : (mode==='auto' ? _langDetectFallback()
                 : (SUPPORTED_LANGS.includes(mode) ? mode : _langDetectFallback()));
  document.querySelectorAll('.lang-select').forEach(s => s.value = mode);  // ★langMode を表示
  applyLang();   // ← アプリ既存の再描画関数
}
```

### 手順4. 言語ドロップダウンに「Auto」を追加（全ての言語selectに）
```html
<select class="lang-select" onchange="onLangChange(this.value)">
  <option value="auto">Auto</option>
  <option value="ja">日本語</option>
  <option value="en">EN</option>
  <option value="zh">中文</option>
  <option value="cat">CAT</option>
</select>
```

### 手順5. ドロップダウンの選択表示は `langMode`（`currentLang` ではない）
`applyLang()` 内などでセレクトの値を同期している箇所を、`currentLang` → **`langMode`** に変える（autoのとき「Auto」を表示するため）。
```js
document.querySelectorAll('.lang-select').forEach(s => s.value = langMode);
```

### 手順6. 旧コードの除去
- これまで起動時に `momoLang` を直接読んで `currentLang` を決めていた処理は、手順2に置き換える（共有 `momoLang` は起動の読み元にしない）。
- アプリ内に言語自動判定のコードがあれば本ルーチンに一本化（重複定義を残さない）。

---

## 4. 検証チェックリスト（プレビューで確認）

> ★ローカルプレビューで**実物のライブラリ**を読ませるには、配信ルートを**リポジトリ直下（`github/momo`）**にして `/momo/...` の絶対パスが解決する状態にする（`/` を `/momo/tools/<app>/` にリダイレクトすると楽）。アプリのフォルダだけを配信すると `/momo/lib/...` が 404 になり `MomoLang` が読めず fallback 動作になる（fallbackも壊れはしないが、実物の検証にならない）。デプロイ済みURLで確認してもよい。

1. `window.MomoLang` が読み込まれている（公開URLが 200）。
2. **新規/未設定ユーザー** → 起動が `auto`、表示はブラウザ言語、ドロップダウン「Auto」。
3. **明示で EN 等を選択** → 表示が切替、`localStorage.momoLang` に書かれる（他アプリ追従）、`momolang_mode_<appId>` に保存、**再読込で保持**。
4. **auto を選択** → 共有 `momoLang` は**書き換わらない**（前の値のまま）。
5. **CAT** → 表示が猫語、`catBase` が直前言語を記憶。
6. **MomoLang を無効化しても**（fallback）言語切替が動き、JSエラーが出ない。

---

## 5. 採用状況

| アプリ | 状態 |
|---|---|
| Links (`tools/links/`) | 採用済み（プログラム v4.35〜） |
| その他 | 未（各アプリのセッションで順次。karaoke / control は先に4言語化が必要） |

---

## 6. バージョン

- v1.0（2026-06-19）: 初版。Links が最初の採用アプリ。
- v1.1（2026-06-19）: `detect()` を `navigator.languages`（希望言語の並び）対応に。第1希望が未対応でも次の希望を拾い、多言語設定の取りこぼしを防ぐ。zh-CN/zh-TW/zh-HK 等はすべて zh。

---

## 付録. 各アプリへ出すプロンプト例

> **使い方**: 対象アプリの**そのアプリ専用のセッション**で下記を貼る（共通ライブラリの管理元＝Links のセッションでは他アプリを編集しない＝同時編集の事故防止）。`◯◯` はアプリ名に置き換え。進行中のアプリ（例: karaoke）は当面避ける。

### A. 既存アプリを共通ライブラリ使用へ書き換える

```
lib/momo-lang/readme.md（言語ルーチンの共通ライブラリと組み込み手順書）を読んで、
その手順どおりに、このアプリ（◯◯）の言語選択を共通ライブラリ momo-lang を使う形に書き換えてください。

進める前に：
- リポジトリを最新にして（pull）、lib/momo-lang/ がある状態にしてください。
- このアプリが ja/en/zh/cat の4言語をそろえているか確認してください。足りなければ、書き換える前に教えてください（4言語化が前提）。
- 共通ライブラリ（lib/momo-lang）は変更せず、呼ぶだけにしてください。直したい点があっても、まず私に相談してください。

実装後：
- 参考実装は Links（tools/links/index.html）。
- プレビューで動作確認（autoで端末言語になる／明示選択が保存され再表示で保持／CAT／JSエラー無し）してから反映してください。
- このアプリのバージョンを上げ、変更を push、開発日誌も書いてください。
```

### B. 新規アプリを最初から4言語対応で作る

```
新しいMOMOアプリを作ります。言語まわりは最初から、共通ライブラリ momo-lang を使って
4言語（ja/en/zh/cat）対応で組んでください。

前提：
- lib/momo-lang/readme.md（言語ルーチンの共通ライブラリと組み込み手順書）を読み、その手順に従ってください。
- 参考実装は Links（tools/links/index.html）。言語まわり（翻訳辞書・applyLang・CAT＝猫語・言語ドロップダウン・catBase）の作りはこれに合わせてください。

言語まわりの実装：
1. <head> に <script src="/momo/lib/momo-lang/momo-lang.js"></script> を1行（本体スクリプトより前・defer不可）。
2. 翻訳辞書を ja/en/zh の3言語ぶん用意（このアプリの全UI文言。未確定の訳は仮でよいので後で直せる形に）。
3. CAT（猫語）を Links と同じ方式で実装（文言の種類＝エラー系/処理系/通常 でランダムな鳴き声、catBase＝CAT選択直前の言語を記憶）。
4. 言語ドロップダウンに Auto/日本語/EN/中文/CAT（Autoを既定）。
5. 起動時の言語決定と onLangChange は readme の手順どおり MomoLang を呼ぶ形に（MomoLang未ロード時の最小fallbackも入れる）。appId は他アプリと重複しない名前にする。
6. 共通ライブラリ（lib/momo-lang）は変更しない（呼ぶだけ。直したい点は先に私に相談）。

確認・反映：
- プレビューで動作確認（Autoで端末言語になる／明示選択が保存され再表示で保持／CAT／JSエラー無し）してから反映してください。
- バージョンを付け、push、開発日誌も書いてください。

※ アクセス解析・見た目（app-card-design）・ファビコン等のMOMO共通の作りは、言語とは別の手順で別途お願いします。
```
