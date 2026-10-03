/**
 * ★v1.99 ルールブックの文章 (Markdown) を、表示用の「かたまり」の並びに直す。
 *
 * 外部の部品は足さない (依存を増やさない・ライセンス検査を増やさない)。ルールブックで
 * 使っている書き方だけを扱う：見出し (#・##・###)／段落／箇条書き (- と *)／表 (|)／
 * 囲み (```)／区切り線 (---・`\---`)／太字 (**)。
 *
 * **HTML には直さない**＝表示は React の要素で組み立てる (文章の中の `<` などを
 * そのまま文字として出す・画面に文字列を流し込まない)。
 */

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; text: string; id: string }
  | { t: 'p'; lines: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'pre'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' };

export interface TocEntry {
  id: string;
  text: string;
}

export interface ParsedDoc {
  blocks: Block[];
  /** 目次＝大見出し (#) のうち、**最初の 1 つ (文書の題名) を除いたもの**。 */
  toc: TocEntry[];
}

const FENCE = /^```/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^\\?-{3,}\s*$/;
const TABLE = /^\s*\|/;
const ITEM = /^\s*[-*]\s+/;
const TABLE_SEP = /^\s*\|[\s|:-]+\|\s*$/;

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseMarkdown(src: string): ParsedDoc {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const toc: TocEntry[] = [];
  let firstH1 = true;
  let n = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // 閉じの ```
      blocks.push({ t: 'pre', text: body.join('\n').replace(/^\n+|\n+$/g, '') });
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      const id = `rb-h${n++}`;
      blocks.push({ t: 'h', level, text: h[2].trim(), id });
      if (level === 1) {
        if (firstH1) firstH1 = false;
        else toc.push({ id, text: h[2].trim() });
      }
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (TABLE.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE.test(lines[i])) rows.push(lines[i++]);
      const body = rows.slice(1).filter((r) => !TABLE_SEP.test(r)).map(cells);
      blocks.push({ t: 'table', head: cells(rows[0]), rows: body });
      continue;
    }
    if (ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ITEM.test(lines[i])) items.push(lines[i++].replace(ITEM, ''));
      blocks.push({ t: 'ul', items });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !TABLE.test(lines[i]) &&
      !ITEM.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ t: 'p', lines: para });
  }
  return { blocks, toc };
}

/** 1 行の中の太字 (**…**) を切り分ける。閉じていない ** はそのまま文字として残す。 */
export function splitBold(text: string): { bold: boolean; text: string }[] {
  const out: { bold: boolean; text: string }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ bold: false, text: text.slice(last, m.index) });
    out.push({ bold: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ bold: false, text: text.slice(last) });
  return out;
}
