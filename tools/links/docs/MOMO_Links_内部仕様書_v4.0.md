# MOMO Links 内部仕様書 v4.0

| 項目 | 内容 |
|---|---|
| 文書版 | v4.0 |
| 対応プログラム版 | v4.30 |
| 最終更新 | 2026-06-19 |
| 前版 | v3.30（`SPEC_v3.30.md` 等） |

> 実装の構造・アルゴリズムを定義する。機能の外形は[外部仕様書](MOMO_Links_外部仕様書_v4.0.md)を参照。コード断片は説明用で、実体は `index.html` / `momo_sync.js` が正本。

---

## 1. ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` | アプリ本体（HTML/CSS/JS一体） |
| `momo_sync.js` | Google Drive 同期ロジック（同フォルダ配置） |
| `bookmark.json` | 初期データ（初回自動ロード用） |

正本リポジトリ：`github/momo/tools/links/`（デプロイ元）。バージョンは `versionBadge`（ヘッダー）と `verDesc`（ヘルプ内3か所）に記載＝現行 `v4.30`。

---

## 2. データモデル

### 2.1 ブックマーク（link）

| フィールド | 型 | 説明 |
|---|---|---|
| id | number | `Date.now()`（ミリ秒）。**数値**であることが前提（HTML属性へ素のまま埋め込むため）。 |
| url | string | 正規化済みURL |
| title | string | タイトル |
| tags | string[] | 階層は `/` 区切り |
| date | string(ISO) | 登録日（表示用） |
| comment | string | コメント |
| isGrouped | boolean | ドメイングループ化 |
| deleted_at | number(秒)\|null | 削除時刻。null＝生存 |
| updated_at | number(秒) | 最終更新（LWW判定） |
| faviconUrl | string | 旧名残（表示には未使用＝v4.23でファビコン記憶はフォルダ単位キャッシュへ移行） |

### 2.2 タグと tagMeta

- タグ一覧：`link_allTags`（localStorage `tags_v2`）。
- `link_tagMeta`（localStorage `tagmeta_v2`）：`{ "<タグ>": { t:<更新秒>, del:0|1 } }`。`del:1`＝削除墓標（tombstone）。同期は `t` の新しい方を採用、`del:1` が新しければ確定削除。

### 2.3 localStorage キー

| キー | 用途 |
|---|---|
| `links_v2` | ブックマーク配列 |
| `tags_v2` | タグ配列 |
| `tagmeta_v2` | タグメタ（tombstone） |
| `favdir_v3` | ファビコン記憶（フォルダ単位・URL値） |
| `momoLang` | 言語（ja/en/zh/cat） |
| `secret_pin` / `secret_key` | シークレットPIN／起動キー |
| `gdrive_sync_enabled` | 同期ON/OFF |
| `gdrive_last_sync` | 前回同期(秒) |
| `links_initialized` | 初回自動ロード済みフラグ |

### 2.4 変数名プレフィックス

`document.links` 等との衝突回避のため主要グローバルに `link_` を付与（`link_data` / `link_allTags` / `link_selectedTags` / `link_viewMode` ほか）。

### 2.5 マイグレーション（起動時・インポート時）

- 旧 `tag`→`tags`、欠落 `comment`/`isGrouped`/`faviconUrl` 初期化。
- 旧 `status`（active/trash）→ `deleted_at`＋`updated_at` に一本化。
- 旧 `faviconUrl` フィールドの不正値（末尾 `/.ico`、`//./` 等）をリセット（フォルダ単位記憶 `favdir_v3` とは別物）。

---

## 3. 表示

- 表示モード `link_viewMode`（'card'/'list'/'grid'）。`setViewMode()` で切替・再描画。
- 100件ずつの遅延描画（`PAGE_SIZE=100`、画面下端付近で追加ロード）。
- 階層タグ：末端名表示、同名末端の競合時のみフルパス表示。絞り込みは AND/OR（`link_filterMode`）＋子タグ包含（`startsWith(fp+'/')`）。
- グループ折り畳み：`isGrouped` のブックマークを `getHost()`（先頭 `www.` 除去）単位で見出し化。
- `_TOP` タグ：起動時、生きた非シークレットの `_TOP` リンクが1件以上あれば `_TOP` で初期絞り込み（案件④）。

---

## 4. ファビコン解決（v4.30・重点）

### 4.1 最初に表示する src の決定 — `faviconSrcFor(l, host)`

1. `file:` → フォルダ／書類アイコン（data URIのSVG。末尾`/`か拡張子なし＝フォルダ、拡張子あり＝書類）。
2. 記憶あり：`favDirCache[favKeyOf(url)]` → 即返す。
3. 下位パス（pathnameが1文字超）：`new URL('favicon.ico', favKeyOf(url))`（**自分のフォルダの favicon.ico**）。
4. サイトてっぺん（ルート）：`https://www.google.com/s2/favicons?domain=<host>&sz=32`。

### 4.2 探索チェーン — `faviconFallback(img, host, url)`

`img.onerror`／小サイズ判定から駆動。`dir = favKeyOf(url)`。

| step | src |
|---|---|
| 1 | `dir + favicon.ico`（自分のフォルダ） |
| 2 | `dir + favicon.svg`（自分のフォルダ） |
| 3 | `https://<host>/favicon.ico`（ドメインてっぺん） |
| 4 | `https://www.google.com/s2/favicons?domain=<host>&sz=32`（Google。実アイコンを持てば採用、無ければ極小地球→4.3で弾き次へ） |
| 5 | `fetchFaviconFromHtml()`（中継プロキシでページHTMLを取得し `<link rel=icon>` を解析） |
| 以降 | `restoreFailsafe(img, host)` |

> 探索順は「記憶失敗時も同じ1本」。`ico` を `svg` より先に試す（svgは無害だが描画堅牢性でラスター優先。黒化はsvgと無関係＝v4.29で確認）。

### 4.3 小サイズ判定 — `checkFaviconSize(img, host, url, id)`

- `data:` は対象外。
- `naturalWidth < 24` **かつ** src が `s2/favicons|icons.duckduckgo` にマッチ → サービスの極小既定（地球）とみなし `faviconFallback` で次へ。サイト自身の小さな実ファビコン（16px等）は本物として採用。
- 採用時：`setFavDir(url, img.src)` で記憶 ＋ `maybeUpgradeFavicon()`（4.6）。

### 4.4 最終フォールバック — `restoreFailsafe(img, host)`

- `host` あり → **Google地球**（`s2/favicons`）を表示（`onload/onerror` を外し再帰防止）。
- `host` なし → `failsafeSrc`（あれば）→ なければ `visibility:hidden`。
- **重要（v4.28）**: 旧版は失敗時に `visibility:hidden` としていたため、暗いカード背景が透けて「黒い四角」に見えた。これを地球表示に変更し黒化を解消。

### 4.5 記憶 — `favDirCache` / `setFavDir` / `favKeyOf`

- `favDirCache`：メモリ上オブジェクト。`favdir_v3` に永続化。
- `setFavDir(url, src)`：`data:` と重複を除き、`favKeyOf(url)` をキーに保存。**成功した段はどれでも記憶**（地球＝極小サービス既定は4.3で弾かれ非記憶。最終地球は `restoreFailsafe` で `onload` を外すため非記憶）。
- `favKeyOf(url)`（v4.27 堅牢化）：そのブックマーク「自身のフォルダ」を求める。
  - 末尾 `/` → そのまま。
  - 末尾が拡張子付き（`index.html` 等）→ ファイル名を除いた親フォルダ。
  - 末尾が拡張子なし（`/momo` 等）→ `/` を補ってフォルダ扱い。
  - → 末尾 `/` の有無・`index.html` 付きでも同一フォルダに正規化（旧 `new URL('.',url)` は末尾 `/` 欠落で誤ってルートを返し黒化していた＝v4.27で修正）。

### 4.6 裏で取り直して格上げ — `maybeUpgradeFavicon(img, host, url)`（v4.30(a)）

- 目的：高優先が一時失敗し低優先（地球/Google/ドメインてっぺん等）を記憶してしまった事故を自動修復。
- 条件：表示中srcが**自分のフォルダの ico/svg でない**、`data:`でない、`_favUpgradeChecked` に未登録（1表示1ブックマーク1回）。
- 処理：裏で `dir+favicon.ico`→ダメなら `dir+favicon.svg` をプローブ。16px以上で成功なら `setFavDir` で記憶を格上げし、`img[data-favurl]` に一致する**全ビューのアイコンを差し替え**。
- 連携：各ファビコン `<img>` に `data-favurl="<url>"` を付与。

### 4.7 記憶リセット — `resetFaviconMemory()`（v4.30(b)）

「データ管理」のボタンから、確認の上 `favDirCache={}`＋`favdir_v3` 削除＋`_favUpgradeChecked.clear()`＋再描画。ブックマークは保持。3言語（ja/en/zh）。

### 4.8 中継プロキシ — `fetchHtmlViaProxy`

`allorigins` → `corsproxy.io` → `jina` の順で試行。取得HTMLから `<link rel="icon|shortcut icon|apple-touch-icon">` を正規表現抽出し、`favKeyOf(url)` をbaseに絶対URL化（v4.27：末尾 `/` 欠落でルートへ化けるのを防止）。

---

## 5. Google Drive 同期（momo_sync.js）

### 5.1 依存ロード

初回同期時のみ遅延ロード：GSI（Google Sign-In）／Pyodide／`momo_gdrive.py`。GDrive API は Pyodide 内 Python で実行。トークンはモバイル対応のため `window._gtok` 等で受け渡し。

### 5.2 保存先

`/momo-works/links/links_data.json`（本体）、`/momo-works/links/links_data.bak.json`（前世代バックアップ）。

### 5.3 同期フロー（`runSync` / 手動 `runSyncManual`）

1. リモート存在確認。無ければローカルを確認後アップロード。
2. `_readVerified()`：読み込み＋SHA-256照合。不一致かつ `.bak` ありなら復旧、無ければ中止。
3. 状況分岐：
   - ローカル空＆リモート有 → ダウンロード（確認後）。
   - 初回／1年以上未同期 → 3択（マージ／リモート上書き／ローカル上書き、消失警告＋エクスポート案内）。
   - 通常 → マージ。
4. `_mergeData()`：`_mergeLinks()`＝updated_at の LWW、`mergeTagMeta()`＝`t` の新しい方、ゴミタグ濾過、tombstone（del:1）除外。1年以上前の `deleted_at` は物理削除。
5. `_commitRemote()`：前世代を `.bak` 退避→本体書込→書込後に読み返して検証。
6. `_applyMerged()`：localStorage 3項目を更新し再描画。

### 5.4 整合性（チェックサム）

`{links, tags, tagMeta}` を `_canonical()` で安定順に文字列化→`crypto.subtle.digest('SHA-256')`→`_checksum` 同梱。読み込み後に再計算・比較（不一致＝破損）。`_checksum` 無しの旧ファイルは互換扱い。

### 5.5 自動同期ポリシー

`gdrive_sync_enabled` ＆ HTTPS ＆（現在−`gdrive_last_sync` ≧ 1日）で起動時1回＋1時間ごと。トークン無効時は自動同期せず「●同期が必要」バッジ（クリックで手動）。

### 5.6 UX保護

同期中は「☁ 同期中」インジケーター（PC＝ヘッダー右／モバイル＝常時可視位置）、クリック抑止、`beforeunload` でページ離脱警告。完了で解除。

---

## 6. シークレットモード

- 起動：ショートカット（`secret_key`、既定 S）／ロゴ3連タップ（1.5秒内）／検索欄 `:secret`。
- 認証：初回PIN設定（2回）→以降PIN入力。`SECRET_TIMEOUT=300000ms`（5分無操作）で自動退出（5秒間隔監視）。
- 表示：`_secret` タグのリンクのみ。枠オレンジ＋「🔒 SECRET」。`secretMode` 中はタイトル／ファビコンの外部送信を停止。

---

## 7. 国際化（i18n）と猫語（CAT）

- `I18N` オブジェクト（ja/en/zh）＋ `t()`。`<select>` で切替、`applyLang()` が全UIを再設定。
- CAT：`currentLang==='cat'` のとき `catSpeak(key)` がキー種別（エラー系／処理系／通常）に応じたランダム鳴き声を返す。直前言語を `catBase` に保持しヘルプ等の基準にする。
- v4.30 で追加した語：`resetFavBtn` / `confirmResetFav` / `resetFavDone`（ja/en/zh）。

---

## 8. 主な関数索引（抜粋）

| 機能 | 関数 |
|---|---|
| ファビコン初期src | `faviconSrcFor` |
| 探索チェーン | `faviconFallback` / `fetchFaviconFromHtml` / `fetchHtmlViaProxy` |
| サイズ判定・記憶 | `checkFaviconSize` / `setFavDir` / `favKeyOf` |
| 格上げ・リセット | `maybeUpgradeFavicon` / `resetFaviconMemory` |
| 追加・編集・削除 | `addLink` / `saveEdit` / `editUrlBlur` / `trashLink` / `permDeleteLink` / `restoreLink` |
| タイトル取得 | `_fetchPageTitle` |
| 表示 | `setViewMode` / 各 render |
| 同期 | `runSync` / `runSyncManual` / `_mergeData` / `_commitRemote` / `_readVerified` / `_sha256` |

---

## 9. 改訂履歴

| 文書版 | 日付 | 対応プログラム版 | 概要 |
|---|---|---|---|
| v3.30 | 2026-04 | v3.30 | 旧版（`SPEC_v3.30.md`）：同期導入・FAVICONチェーン初版（Google→DuckDuckGo→host→非表示）・猫語 等。 |
| v4.0 | 2026-06-19 | v4.30 | ファビコン全面刷新（4章）：フォルダ単位記憶＋`favKeyOf`堅牢化（v4.27）、地球フォールバック（v4.28）、裏で格上げ＋記憶リセット（v4.30）、svg一掃撤去（v4.29）。同期の堅牢化（バックアップ＋SHA-256＋tagMeta tombstone）。グリッド表示。各種小修正。 |
