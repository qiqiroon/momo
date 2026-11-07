// レベル選択の画面（仕様書 §5）。LEVEL という表現を使い、4・5・6 はレガシーとバリエーションを並べる（レガシーが先）

import { boardCells, boardRuns, LEVELS, type LevelDef } from '../core/levels';
import { outlineEdges } from '../core/geometry';
import { formatTime } from '../core/progress';
import { S } from './strings';
import { shapeSvg } from './shapeSvg';

/** @param best レベルごとのベストタイム（ms）。あればカードに出す */
export function renderLevelSelect(root: HTMLElement, onPick: (level: LevelDef) => void, best: Record<string, number> = {}): void {
  root.replaceChildren();
  const wrap = document.createElement('section');
  wrap.id = 'levels';
  const h2 = document.createElement('h2');
  h2.textContent = S.selectLevel;
  wrap.append(h2);

  const grid = document.createElement('div');
  grid.className = 'level-grid';
  LEVELS.forEach((lv, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'level-card';
    card.style.animationDelay = `${i * 30}ms`;
    card.dataset.level = lv.id;

    const lvEl = document.createElement('span');
    lvEl.className = 'lv';
    lvEl.textContent = S.levelLabel(lv.n);
    card.append(lvEl);

    if (lv.variant) {
      const v = document.createElement('span');
      v.className = `variant ${lv.variant}`;
      v.textContent = S.variant[lv.variant];
      card.append(v);
    }

    const shape = document.createElement('span');
    shape.className = 'shape';
    shape.innerHTML = boardPicture(lv);
    card.append(shape);

    if (lv.unproven) {
      // 解けると証明されていないレベル（§5.2）
      const u = document.createElement('span');
      u.className = 'unproven';
      u.textContent = S.unproven;
      card.append(u);
    }

    const fam = document.createElement('span');
    fam.className = 'family';
    fam.textContent = S.family(lv.n);
    card.append(fam);

    const info = document.createElement('span');
    info.className = 'info';
    const cells = boardCells(lv).length;
    info.textContent = S.levelInfo(lv.kinds, lv.count, cells);
    card.append(info);

    if (best[lv.id]) {
      const b = document.createElement('span');
      b.className = 'best';
      b.textContent = S.bestTime(formatTime(best[lv.id]));
      card.append(b);
    }

    card.addEventListener('click', () => onPick(lv));
    grid.append(card);
  });
  wrap.append(grid);

  const notes = document.createElement('ul');
  notes.className = 'level-notes';
  const noSample = LEVELS.some((l) => !l.unproven && !l.solution.length);
  for (const t of [S.legacyNote, S.simpleNote, ...(noSample ? [S.noSampleNote] : []), ...(LEVELS.some((l) => l.unproven) ? [S.unprovenNote] : [])]) {
    const li = document.createElement('li');
    li.textContent = t;
    notes.append(li);
  }
  wrap.append(notes);
  root.append(wrap);
}

const pictures = new Map<string, string>();

/** 盤面の形の絵（カードに収まるよう、マスの大きさを盤面の大きさで変える） */
function boardPicture(lv: LevelDef): string {
  const hit = pictures.get(lv.id);
  if (hit) return hit;
  const w = Math.max(...lv.board.map((l) => l.length)), h = lv.board.length;
  const fit = Math.min(14, 60 / h, 120 / w);
  let svg: string;
  if (fit >= 2) {
    svg = shapeSvg(boardCells(lv), [], { cell: Math.floor(fit), fill: 'var(--surface2)', stroke: 'var(--orange)', strokeWidth: 1.5 });
  } else {
    // 大きい盤面（9 以上）：マスを1つずつ描かず、行ごとの並びと外周の線で（1マスは 1px 未満）
    const c = fit, sw = 1.5, W = w * c + sw, H = h * c + sw;
    const rects = boardRuns(lv).map(([y, a, b]) => `M${a * c},${y * c}h${(b - a) * c}v${c}h${-(b - a) * c}z`).join('');
    const edges = outlineEdges(boardCells(lv)).map(([x1, y1, x2, y2]) => `M${x1 * c},${y1 * c}L${x2 * c},${y2 * c}`).join('');
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="${-sw / 2} ${-sw / 2} ${W.toFixed(2)} ${H.toFixed(2)}" aria-hidden="true">` +
      `<path d="${rects}" style="fill:var(--surface2)"/>` +
      `<path d="${edges}" style="fill:none;stroke:var(--orange)" stroke-width="${sw}" stroke-linecap="square"/></svg>`;
  }
  pictures.set(lv.id, svg);
  return svg;
}
