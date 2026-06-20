# momo-lang — MOMO Works 共通 言語ルーチン（案件⑦）

全アプリ共通の「言語の自動判定・モード管理・保存ルール」を1か所に集約した共有ライブラリ。
**言語切り替えの動きを直すときは、このフォルダの `momo-lang.js` 1ファイルだけ**直せば、利用する全アプリに反映される（各アプリにロジックを複製しない）。

- 本体: `momo-lang.js`
- 公開URL: `https://qiqiroon.github.io/momo/lib/momo-lang/momo-lang.js`

---

## 設計ルール

- **言語モード** = `auto` / `ja` / `en` / `zh` / `cat`。
- **モードはアプリごとにローカル保存**（キー `momolang_mode_<appId>`、未設定の既定 = `auto`）。
- **auto** のときだけ、ブラウザ/OS言語から `ja` / `zh` / `en` を判定（それ以外は `en`。CATは自動選択しない）。
- **明示言語（auto以外）を選んだ時だけ**、全MOMO共有キー `momoLang` に書く＝**他アプリも追従**。
  - ★autoは共有に書かない（autoを共有に書くと、未対応の旧アプリが `ja` にリセットして共有値を壊すため）。
- 起動の読み元は「アプリごとのローカルモード」。共有 `momoLang` は **“書くだけ・起動の読み元にしない”**。
- 将来、全アプリ展開後（P3）は auto を既定化してモード選択を畳む想定 → その時もこのファイルだけ直す。

---

## API（`window.MomoLang`）

| 関数 | 返り値 | 説明 |
|---|---|---|
| `detect()` | `'ja'\|'en'\|'zh'` | ブラウザ/OS言語から判定（他は `en`） |
| `getMode(appId)` | モード文字列 | そのアプリのローカルモード（未設定=`auto`） |
| `resolve(appId)` | 表示言語(`ja/en/zh/cat`) | モードから実際の表示言語を解決（auto→detect） |
| `setMode(appId, mode)` | 表示言語 | モードを保存（明示のみ共有 `momoLang` へ）。実際の表示言語を返す |

`MomoLang.LANGS = ['ja','en','zh','cat']` / `MomoLang.MODES = ['auto','ja','en','zh','cat']`。

各アプリの **翻訳辞書・applyLang・言語ドロップダウン・catBase** はアプリ側のまま。本ルーチンは「判定/モード/保存ルール」だけを担当する。

---

## 各アプリへの組み込み方（P2）

1. `<head>` 内、**アプリ本体スクリプトより前に**1行（`defer` 不可）：
   ```html
   <script src="/momo/lib/momo-lang/momo-lang.js"></script>
   ```
2. 起動時の言語決定（`appId` は自アプリ名、例 `'links'`）：
   ```js
   const LANG_APP_ID = 'links';
   let langMode    = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
   let currentLang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID) : detectFallback();
   ```
3. 言語切り替えハンドラ：
   ```js
   function onLangChange(mode){
     if(mode==='cat' && currentLang!=='cat') catBase = currentLang;  // catBaseはアプリ固有
     langMode = mode;
     currentLang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
                 : (mode==='auto' ? detectFallback() : mode);
     document.querySelectorAll('.lang-select').forEach(s => s.value = mode);
     applyLang();
   }
   ```
4. 言語ドロップダウンに `<option value="auto">Auto</option>` を追加。
5. ドロップダウンの選択表示は `currentLang` ではなく **`langMode`**（autoのとき「Auto」を表示するため）。
6. **fallback**：`MomoLang` 未ロード時（`file://` やネット不通）に備え、最小の言語判定（`detectFallback()`）を各アプリに持たせる（言語が壊れないため）。

参考実装: `tools/links/index.html`（最初の採用アプリ）。

---

## 採用状況

- **Links**: 採用済み（v4.35〜）。
- 他アプリ: 未（P2で順次）。

## バージョン対応

- v1.0（2026-06-19）: 初版。Links が最初の採用アプリ（プログラム Links v4.35〜）。
