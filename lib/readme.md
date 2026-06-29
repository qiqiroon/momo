# MOMO 共有ライブラリ

MOMO の各アプリから共通で利用するライブラリ群を置くフォルダです。

## 命名規則

このフォルダの直下に置くライブラリの名前は、書かれている言語の慣習に合わせます。

- **Python のライブラリはアンダースコア区切り**（例: `momo_gdrive`, `momo_disk`, `momo_github`）
- **JavaScript のライブラリはハイフン区切り**（例: `momo-lang`, `momo-analytics.js`）

理由：

- Python の標準的なコーディング規約（PEP 8）では、モジュール名・パッケージ名は小文字のアンダースコア区切りが推奨されています。
- JavaScript / Web では、ファイル名や npm パッケージ名にハイフン区切り（kebab-case）を使うのが一般的です。
- 特に Python はフォルダ名にハイフンを含めると `import` 文に直接書けなくなるという実害があり、Python ライブラリ側でアンダースコアを崩すことはできません。

そのため、`lib/` の下では表記が一見ばらついて見えますが、これは「言語ごとの慣習に従った結果」です。新しくライブラリを追加するときも、その言語の慣習に合わせた名前を付けてください。

## 現在の構成

| 名前 | 言語 | 概要 |
|---|---|---|
| `momo_gdrive/` | Python | Google Drive アクセス |
| `momo_disk/` | Python（+ JS ブリッジ） | ローカルディスクアクセス |
| `momo_github/` | Python | GitHub アクセス |
| `momo-lang/` | JavaScript | 共通言語ルーチン（自動判定・モード管理・保存） |
| `momo-analytics.js` | JavaScript | 共通アクセス解析 |

各ライブラリの詳細は、それぞれのフォルダ内の `readme.md` を参照してください。
