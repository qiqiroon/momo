# MOMO Cosmos — 使用ライブラリ・素材のライセンス

## ライブラリ

### Matter.js 0.20.0（`js/vendor/matter.min.js`）
https://brm.io/matter-js/ — MIT License

```
The MIT License (MIT)

Copyright (c) Liam Brummitt and contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 画像
`assets/img/` のスプライトは、次の画像から切り出し、WebP（品質88）に変換したもの（MOMO_Cosmos_Asset_Spec_v1_00.md）。

Image Credits
AI Image Generation: OpenAI ChatGPT Images
Image Direction & Selection: MOMO Works

AI-generated images were created with assistance from OpenAI's ChatGPT Images and selected for use in this game.

## フォント
Fredoka One / M PLUS Rounded 1c / Noto Sans JP / Noto Sans SC — SIL Open Font License 1.1（Google Fonts から読み込む）

## 共通ライブラリ
`lib/momo-lang/momo-lang.js`（言語）、`lib/momo-analytics.js`（アクセス解析） — MOMO Works

## BGM
共通の `assets/bgm/`（lobby・game-cosmos・ending-cosmos）。すべて作者本人が作った曲（Mureka・SUNO）。表示義務なし。

## 効果音
| 用途 | ファイル | 出所 | ライセンス |
|---|---|---|---|
| 落下 | sfx/knife-throw1.mp3 | 効果音ラボ「ナイフを投げる」 | 効果音ラボの利用規約（表記不要。モノラル 96kbps に変換） |
| 特殊イベントの予告 | sfx/eye-shine1.mp3 | 効果音ラボ「きらーん1」 | 効果音ラボの利用規約（表記不要。モノラル 96kbps に変換） |
| 合体 | sfx/puyon1.mp3 | 効果音ラボ「ぷよん」 | 効果音ラボの利用規約（表記不要。モノラル 96kbps に変換） |
| ブラックホール誕生・成長 | sfx/buun1.mp3 | 効果音ラボ「ブウーン（重低音）」 | 同上 |
| 吸収 | sfx/magic-drain1.mp3 | 効果音ラボ「HP吸収魔法1」 | 同上 |
| 警告 | sfx/news-title4.mp3 | 効果音ラボ「ニュースタイトル表示4」 | 同上 |
| ビッグバン | sfx/bigbang1.mp3 | 効果音ラボ「爆発4」と「大爆発1」を重ねたもの（合成の重低音はプログラムで別に鳴らす） | 同上（改変） |
| ボタン | ../../assets/se/se-button.mp3 | Taira Komori「press_enter1」（https://taira-komori.net/freesounden.html） | CC BY 4.0（表記が要る） |
| 一時停止 | ../../assets/se/se-pause.mp3 | Freesound: BaggoNotes「Button_Click1」 | CC0 |
| 着地・衝突 | （ファイルなし） | プログラムで作る音 | — |

効果音ラボ：https://soundeffect-lab.info/ （利用規約 https://soundeffect-lab.info/agreement/ 。ファイル単体の再配布は禁止）
