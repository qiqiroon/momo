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
- 全アプリ展開後（P3）は auto を既定化してモード選択を畳む想定 → その時もこのファイルだけ直す。

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
  try{ const l=(navigator.language||'en').toLowerCase();
    if(l.indexOf('ja')===0)return'ja'; if(l.indexOf('zh')===0)return'zh'; if(l.indexOf('en')===0)return'en'; return'en';
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
