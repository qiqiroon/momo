# momo-lang — MOMO Works 共通 言語ルーチン（案件⑦）

> **この文書は開発者向け（主に作者と Claude）です。アプリの利用者は読みません。**
> MOMO の各アプリに「言語の自動判定・切り替え・アプリ間引き継ぎ」を組み込むための手順書を兼ねています。
> 別のセッション（別アプリの開発）でも、**この readme を読めばそのまま実装できる**ことを目標にしています。

全アプリ共通の「言語の自動判定・モード管理・保存ルール・アプリ間引き継ぎ」を1か所に集約した共有ライブラリ。
**動きを直すときは、この `momo-lang.js` 1ファイルだけ**直せば、利用する全アプリに反映される（各アプリにロジックを複製しない）。

- 本体: `momo-lang.js`
- 公開URL: `https://qiqiroon.github.io/momo/lib/momo-lang/momo-lang.js`
- 最初の採用アプリ（参考実装）: `tools/links/index.html`

---

## 0. 大事な前提

- **MOMO 標準は 4 言語（ja / en / zh / cat）**。自動判定は ja/zh/en を `navigator.languages` から拾い、CAT は自動選択しない。
- 既存アプリ（4 言語対応のもの）は **未宣言のままで OK**。MOMO 標準扱いで動く。
- 新規アプリや「標準と違うセット」を持つアプリ（追加言語・縮小・CAT 非対応など）は、**`MomoLang.bind` で自分のセットを宣言する**こと。
- 共通ライブラリは「判定 / モード / 保存ルール / 引き継ぎ」だけを担当する。**翻訳辞書・`applyLang`・言語ドロップダウン HTML はアプリ側のまま**。

---

## 1. 設計ルール（v1.11 以降）

- **言語モード** = `auto` / `ja` / `en` / `zh` / `cat` /（アプリが宣言した追加言語）。
- **モードは全アプリ共通の共有キー `momoLang_mode` で管理**（auto を含む）。どのアプリで切り替えても他アプリが追従する。
- **CAT の系統（にゃあ/meow/喵）も共有キー `momoCatBase` で引き継ぐ**。
  - CAT を選んだ瞬間のモードが具体言語なら `momoCatBase` に書く（他アプリも同じ系統に揃う）。
  - auto 由来や未設定なら `momoCatBase` をクリア（他アプリでは各端末の auto-猫語になる）。
- **アプリは任意で自分のセットを宣言できる**（`MomoLang.bind`）。未宣言なら MOMO 標準 4 言語扱い。
- 共有モードがアプリのセットに無ければ `auto` に倒す（未対応値の安全弁）。
- **旧共有キー `momoLang` は karaoke 互換のため「明示言語のみ」書き続ける**。karaoke は無改造で動く。
- **旧 per-app キー（`momolang_mode_<appId>`）は引っ越し参照用としてのみ読む**（共有モードが空の時の代替）。書き込みは続行（後方互換用）。

---

## 2. API（`window.MomoLang`）

| 関数 / プロパティ | 返り値 | 説明 |
|---|---|---|
| `VERSION` | `'1.11'` | このライブラリのバージョン |
| `LANGS` | `['ja','en','zh','cat']` | MOMO 標準言語（互換目的で公開） |
| `MODES` | `['auto','ja','en','zh','cat']` | MOMO 標準モード（互換目的で公開） |
| `bind(appId, opts)` | なし | アプリのセットを宣言（任意）。`opts = {supportedLangs, detectMap, fallback}` |
| `detect(appId?)` | 表示言語 | 自動判定。`appId` 省略時は MOMO 標準。 |
| `getMode(appId)` | モード文字列 | そのアプリで適用されるモード（共有キーをアプリのセットで検証） |
| `getCatBase(appId)` | 言語コード | CAT 表示時の系統言語（共有 catBase をアプリのセットで検証） |
| `resolve(appId)` | 表示言語(`ja/en/zh/cat/…`) | モードから実際の表示言語を解決（CAT 非対応アプリで cat が来たら catBase に倒す） |
| `setMode(appId, mode)` | 表示言語 | モードを保存（共有・per-app・karaoke 互換キーを一気に書き分け、CAT 切替時は catBase も処理）。表示言語を返す |

### `bind(appId, opts)` の中身

- `supportedLangs`（配列、例 `['ja','en','zh','cat','ko']` や `['ja','en']`）— 省略時は MOMO 標準 4 言語。
- `detectMap`（配列、例 `[['ko','ko'],['ja','ja'],['en','en']]`）— ブラウザ言語の prefix → 採用する言語コード。省略時は既定（ja/zh/en）から `supportedLangs` に含まれるものだけを採用。
- `fallback`（言語コード、既定 `'en'`）— 何も当たらなかったときの言語。`supportedLangs` に含まれない値を渡したら、自動で最初の非 CAT 言語に倒す。

---

## 3. 新規アプリの組み込み手順（最初から `bind` を使う）

`<appId>` はそのアプリの短い識別名（例: `links` / `karaoke` / `reversi`）。**他アプリと重複しない名前**にする。

### 手順1. 共通ルーチンを読み込む（`<head>` 内・本体スクリプトより前・`defer` 不可）

```html
<script src="/momo/lib/momo-lang/momo-lang.js"></script>
```

### 手順2. アプリ起動の早い段階で `bind` を呼び、自分のセットを宣言

```js
const LANG_APP_ID = '<appId>';
// MOMO 標準 4 言語のアプリならこれだけ：
if (window.MomoLang) MomoLang.bind(LANG_APP_ID, { supportedLangs: ['ja','en','zh','cat'] });
// 追加言語が欲しい場合の例：
//   MomoLang.bind('myapp', {
//     supportedLangs: ['ja','en','zh','cat','ko'],
//     detectMap: [['ko','ko'], ['ja','ja'], ['zh','zh'], ['en','en']],
//     fallback: 'en'
//   });
// 中国語を扱わないアプリ：
//   MomoLang.bind('myapp', { supportedLangs: ['ja','en','cat'], fallback: 'en' });
// CAT 非対応にしたいアプリ：
//   MomoLang.bind('myapp', { supportedLangs: ['ja','en','zh'], fallback: 'en' });
```

### 手順3. 起動時の言語決定（I18N 定義の近く）

```js
const SUPPORTED_LANGS = ['ja','en','zh','cat'];   // アプリ自身の辞書セットと一致させる
function _langDetectFallback(){
  try{ const list=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||'en'];
    for(let i=0;i<list.length;i++){ const l=(list[i]||'').toLowerCase();
      if(l.indexOf('ja')===0)return'ja'; if(l.indexOf('zh')===0)return'zh'; if(l.indexOf('en')===0)return'en'; }
    return'en';
  }catch(e){return'ja';}
}
let langMode    = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
let currentLang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID)
                : (langMode==='auto' ? _langDetectFallback()
                   : (SUPPORTED_LANGS.includes(langMode) ? langMode : _langDetectFallback()));
```

### 手順4. 言語切り替えハンドラ

```js
function onLangChange(mode){
  langMode = mode;
  currentLang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
              : (mode==='auto' ? _langDetectFallback()
                 : (SUPPORTED_LANGS.includes(mode) ? mode : _langDetectFallback()));
  document.querySelectorAll('.lang-select').forEach(s => s.value = mode);
  applyLang();
}
```

### 手順5. 言語ドロップダウン（全ての言語 select）

```html
<select class="lang-select" onchange="onLangChange(this.value)">
  <option value="auto">Auto</option>
  <option value="ja">日本語</option>
  <option value="en">EN</option>
  <option value="zh">中文</option>
  <option value="cat">CAT</option>
</select>
```

ドロップダウンの「選択中表示」は **`langMode`**（`currentLang` ではない）で同期させること。auto のとき「Auto」を表示するため。

### 手順6. CAT 表示時の系統決定（にゃあ/meow/喵 を選ぶ）

`applyLang()` 内で `currentLang === 'cat'` のとき、系統言語は **`MomoLang.getCatBase(LANG_APP_ID)` から取る**こと（アプリ側で `catBase` 変数を持たない）。

```js
if (currentLang === 'cat') {
  const base = window.MomoLang ? MomoLang.getCatBase(LANG_APP_ID) : 'ja';
  // base に応じて にゃあ/meow/喵 を選ぶ
}
```

---

## 4. 既存アプリへの「いつか」追加作業（任意・順次）

既存 14 アプリは**何もしなくても新しいライブラリで動きます**。Auto 引き継ぎ（モードのアプリ間共有）は自動で効きます。

ただし以下の作業を**1 アプリずつ順次**入れていくと、より新ライブラリの恩恵を受けられます。**急ぐ必要はありません**。

### 追加A. `bind` 宣言（1 行）

I18N まわりの初期化の近くに 1 行追加：

```js
if (window.MomoLang) MomoLang.bind(LANG_APP_ID, { supportedLangs: ['ja','en','zh','cat'] });
```

宣言があると、共有モードに未対応言語が入っても安全に auto へ倒せる（懸念の安全弁）。標準 4 言語のままなら省略可能で、動きは変わらない。

### 追加B. CAT 系統の引き継ぎ（`MomoLang.getCatBase` を使う）

これを入れると、CAT の系統（にゃあ/meow/喵）が**アプリ間で揃う**。

1. アプリ内のローカル `catBase` 変数を読んでいる箇所を、`MomoLang.getCatBase(LANG_APP_ID)` の戻り値に置き換える（無ければそのまま動くが、各アプリで系統がバラバラになる可能性が残る）。
2. `onLangChange` 内の `if(mode==='cat' && currentLang!=='cat') catBase = currentLang;` という行は**消してよい**（同等の処理はライブラリの `setMode` 内で `momoCatBase` 共有キーに自動で行われる）。残しておいても害は無いが、ローカル `catBase` は使い道が無くなる。

### 追加C. CAT 非対応・追加言語・縮小がしたいとき

`bind` で `supportedLangs` を MOMO 標準と違うものに宣言するだけ（手順2と同じ）。

### 既存アプリでの作業の **省略・無視の影響**

| 作業 | 省略した時の挙動 |
|---|---|
| A. bind 宣言 | 動く。MOMO 標準扱いで auto 引き継ぎは効く。未対応値の安全弁が無い分、将来 MOMO 標準が増えると追従されない |
| B. getCatBase 化 | 動く。アプリ間で CAT 系統が揃わない場合がある（そのアプリのローカル catBase に従う） |
| C. セット変更 | このアプリで「標準と違うセット」を扱う場合のみ必要。標準のままなら不要 |

---

## 5. 検証チェックリスト（プレビューで確認）

> ★ローカルプレビューで**実物のライブラリ**を読ませるには、配信ルートを**リポジトリ直下（`github/momo`）**にして `/momo/...` の絶対パスが解決する状態にする（`/` を `/momo/tools/<app>/` にリダイレクトすると楽）。アプリのフォルダだけを配信すると `/momo/lib/...` が 404 になり `MomoLang` が読めず fallback 動作になる（fallback も壊れはしないが、実物の検証にならない）。デプロイ済み URL で確認してもよい。

1. `window.MomoLang.VERSION === '1.11'` が確認できる。
2. **新規/未設定ユーザー** → 起動が `auto`、表示はブラウザ言語、ドロップダウン「Auto」。
3. **明示で EN 等を選択** → 表示が切替、`localStorage.momoLang_mode` に書かれる、再読込で保持。
4. **別のアプリを開く** → 同じ言語で表示される（**＝アプリ間引き継ぎ**）。
5. **auto を選択** → 共有 `momoLang_mode = 'auto'`、`momoLang`（旧キー）は触らない（前の明示値のまま）。
6. **別のアプリを開く** → auto 動作で各端末の自動判定言語が出る。
7. **CAT を ja のときに選択** → 表示が猫語(にゃあ系)、`localStorage.momoCatBase = 'ja'`。
8. **別のアプリを開いて CAT に切り替える** → 同じ猫語系統(にゃあ)で表示される。
9. **auto のときに CAT を選択** → `localStorage.momoCatBase` がクリアされる。別アプリの CAT は各端末の auto-猫語に。
10. **MomoLang を無効化しても**（fallback）言語切替が動き、JS エラーが出ない。

---

## 6. 採用状況

| アプリ | 状態 |
|---|---|
| Links (`tools/links/`) | 採用済み（最初の参考実装、v1.00〜） |
| Darts / Reversi / Hanoi / Tilt / Gomoku-Go (`games/`) | 採用済み |
| Explorer / Player / Lyrics / Noise (`tools/`) | 採用済み |
| Works トップ / Tools トップ / Games トップ / Logue | 採用済み |
| Karaoke (`tools/karaoke/`) | 未採用（製作中。共有 `momoLang` を直接読み書きする旧コードのまま） |
| Control (`games/control/`) | 言語切替 UI 自体が無い（日本語ハードコード） |

→ **採用済み 14 アプリは v1.11 でも無改造で動く**。bind 宣言と getCatBase 化（§4）は「いつか」やる任意作業。

---

## 7. バージョン履歴

- **v1.11**（2026-06-29）: モードと CAT 系統をアプリ間で引き継ぐ仕組みを追加。共有キー `momoLang_mode` / `momoCatBase` を新設。アプリが自分のセットを宣言できる `bind` API を追加。旧共有キー `momoLang` は karaoke 互換のため明示言語のみ書き続ける。版表記を MOMO 共通の n.nn 形式に統一（v1.1 → v1.10、新規 → v1.11）。
- **v1.10**（2026-06-19、旧表記 v1.1）: `detect()` を `navigator.languages`（希望言語の並び）対応に。第1希望が未対応でも次の希望を拾い、多言語設定の取りこぼしを防ぐ。zh-CN/zh-TW/zh-HK 等はすべて zh。
- **v1.00**（2026-06-19、旧表記 v1.0）: 初版。Links が最初の採用アプリ。

---

## 付録. 各アプリへ出すプロンプト例

> **使い方**: 対象アプリの**そのアプリ専用のセッション**で下記を貼る（共通ライブラリの管理元＝Links のセッションでは他アプリを編集しない＝同時編集の事故防止）。`◯◯` はアプリ名に置き換え。進行中のアプリ（例: karaoke）は当面避ける。

### A. 既存アプリに `bind` 宣言を追加する（任意・順次）

```
lib/momo-lang/readme.md（言語ルーチンの共通ライブラリと組み込み手順書）を読んで、
このアプリ（◯◯）に MomoLang.bind 宣言を追加してください。

進める前に：
- リポジトリを最新にして（pull）、lib/momo-lang/ が v1.11 になっている状態にしてください。
- このアプリが現在対応している言語セットを確認してください。MOMO 標準 4 言語（ja/en/zh/cat）であればそれを宣言、違うセットならそれを宣言します。
- 共通ライブラリ（lib/momo-lang）は変更せず、呼ぶだけにしてください。直したい点があっても、まず私に相談してください。

実装後：
- 参考実装は Links（tools/links/index.html）。
- プレビューで動作確認（auto で端末言語になる／明示選択が保存され再表示で保持／別アプリで同じ選択が引き継がれる／CAT／JS エラー無し）してから反映してください。
- このアプリのバージョンを上げ、変更を push、開発日誌も書いてください。
```

### B. 既存アプリの CAT 系統を共有化する（任意・順次、Aと一緒にやってもよい）

```
lib/momo-lang/readme.md §4-B（CAT 系統の引き継ぎ）を読んで、
このアプリ（◯◯）の CAT 系統決定を MomoLang.getCatBase 経由に置き換えてください。

注意：
- アプリ内のローカル catBase 変数の読み出しを MomoLang.getCatBase(LANG_APP_ID) の戻り値に置き換えるだけ。
- onLangChange 内の catBase 設定行は消してよい（ライブラリ内で momoCatBase に自動保存される）。
- 動作確認：このアプリで JA→CAT を選んだあと、別アプリを開いて CAT に切り替えると同じ猫語系統(にゃあ)で表示される。
- バージョン更新・push・日誌は通常どおり。
```

### C. 新規アプリを最初から組み込みで作る

```
新しい MOMO アプリを作ります。言語まわりは最初から、共通ライブラリ momo-lang を使って
組んでください。

前提：
- lib/momo-lang/readme.md（言語ルーチンの共通ライブラリと組み込み手順書）を読み、その手順（§3 新規アプリの組み込み手順）に従ってください。
- 参考実装は Links（tools/links/index.html）。言語まわり（翻訳辞書・applyLang・CAT＝猫語・言語ドロップダウン）の作りはこれに合わせてください。

言語まわりの実装：
1. <head> に <script src="/momo/lib/momo-lang/momo-lang.js"></script> を1行（本体スクリプトより前・defer 不可）。
2. アプリ起動の早い段階で MomoLang.bind(LANG_APP_ID, { supportedLangs: [...] }) を呼んで自分のセットを宣言する。
3. 翻訳辞書を宣言したセット分用意（このアプリの全UI文言。未確定の訳は仮でよいので後で直せる形に）。
4. CAT（猫語）を Links と同じ方式で実装。CAT 表示時の系統は MomoLang.getCatBase(LANG_APP_ID) で取る（アプリ側で catBase 変数を持たない）。
5. 言語ドロップダウンに Auto/日本語/EN/中文/CAT 等（Auto を既定）。
6. 起動時の言語決定と onLangChange は readme の手順どおり MomoLang を呼ぶ形に（MomoLang 未ロード時の最小 fallback も入れる）。appId は他アプリと重複しない名前にする。
7. 共通ライブラリ（lib/momo-lang）は変更しない（呼ぶだけ。直したい点は先に私に相談）。

確認・反映：
- プレビューで動作確認（Auto で端末言語になる／明示選択が保存され再表示で保持／別アプリで同じ選択が引き継がれる／CAT／JS エラー無し）してから反映してください。
- バージョンを付け、push、開発日誌も書いてください。

※ アクセス解析・見た目（app-card-design）・ファビコン等の MOMO 共通の作りは、言語とは別の手順で別途お願いします。
```
