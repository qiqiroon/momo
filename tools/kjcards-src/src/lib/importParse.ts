// ── 入口の取り込み（概要設計書 v0.02 第7章）
//   AI出力の構文崩れに強い "寛容な行形式"（括弧なし＝閉じ忘れが起こりえない）。
//   1行=1カード。区切り「｜」(全角縦棒) の前が title・後ろが note。無ければ行全体が title。

export interface ParsedCard {
  title: string;
  note: string;
}

export interface ParseResult {
  cards: ParsedCard[];
  /** 有効行として評価した総数（空行・#行は含めない） */
  total: number;
  imported: number;
  skipped: number;
}

const SEP = '｜'; // 全角縦棒

/** 1行を title/note に分割（最初の「｜」で2分割） */
function splitLine(line: string): ParsedCard {
  const idx = line.indexOf(SEP);
  if (idx < 0) return { title: line.trim(), note: '' };
  return {
    title: line.slice(0, idx).trim(),
    note: line.slice(idx + SEP.length).trim(),
  };
}

/**
 * §7.4/7.5: 寛容な行形式のパース。
 *  改行で分割 → 空行と「#」始まりを除外 → 各行を最初の「｜」で2分割 → 前後空白除去。
 *  title が空の行はスキップ（件数を記録）。全体は止めない（フェイルソフト）。
 */
export function parseTolerantLines(raw: string): ParseResult {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const cards: ParsedCard[] = [];
  let total = 0;
  let skipped = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue; // 空行は無視
    if (line.startsWith('#')) continue; // コメント/見出し扱い
    total += 1;
    const parsed = splitLine(rawLine);
    if (parsed.title === '') {
      skipped += 1; // title 空はスキップ
      continue;
    }
    cards.push(parsed);
  }
  return { cards, total, imported: cards.length, skipped };
}

export type LocalSplitMode = 'line' | 'blank';

/**
 * §7.6: 簡易ローカル分割（AIを使わない代替）。
 *  'line'  … 各行を1カード。
 *  'blank' … 空行で段落を区切り、段落=1カード（1行目を title、残りを note）。
 *  いずれも「｜」があれば見出し/補足に分ける。粒度・重複整理の質はAI経路に劣る。
 */
export function localSplit(raw: string, mode: LocalSplitMode): ParseResult {
  const text = raw.replace(/\r\n?/g, '\n');
  const cards: ParsedCard[] = [];
  let total = 0;
  let skipped = 0;

  if (mode === 'line') {
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (line === '') continue;
      total += 1;
      const parsed = splitLine(rawLine);
      if (parsed.title === '') {
        skipped += 1;
        continue;
      }
      cards.push(parsed);
    }
  } else {
    const paragraphs = text.split(/\n{2,}/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed === '') continue;
      total += 1;
      if (trimmed.indexOf(SEP) >= 0) {
        const parsed = splitLine(trimmed.replace(/\n/g, ' '));
        if (parsed.title === '') {
          skipped += 1;
          continue;
        }
        cards.push(parsed);
      } else {
        const rows = trimmed.split('\n');
        const title = rows[0].trim();
        const note = rows.slice(1).join(' ').trim();
        if (title === '') {
          skipped += 1;
          continue;
        }
        cards.push({ title, note });
      }
    }
  }
  return { cards, total, imported: cards.length, skipped };
}
