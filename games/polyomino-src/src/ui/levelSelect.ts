// レベル選択の画面（仕様書 §5）。LEVEL という表現を使い、4・5・6 はシンプルとレガシーを並べる

import { boardCells, LEVELS, piecesOf, type LevelDef } from '../core/levels';
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

    const fam = document.createElement('span');
    fam.className = 'family';
    fam.textContent = S.family(lv.n);
    card.append(fam);

    const info = document.createElement('span');
    info.className = 'info';
    const cells = boardCells(lv).length;
    info.textContent = S.levelInfo(piecesOf(lv).length, lv.count, cells);
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
  for (const t of [S.simpleNote, S.legacyNote]) {
    const li = document.createElement('li');
    li.textContent = t;
    notes.append(li);
  }
  wrap.append(notes);
  root.append(wrap);
}

/** 盤面の形の絵（カードに収まるよう、マスの大きさを盤面の大きさで変える） */
function boardPicture(lv: LevelDef): string {
  const cells = boardCells(lv);
  const w = Math.max(...lv.board.map((l) => l.length)), h = lv.board.length;
  const cell = Math.max(2, Math.min(14, Math.floor(60 / h), Math.floor(120 / w)));
  return shapeSvg(cells, [], { cell, fill: 'var(--surface2)', stroke: 'var(--orange)', strokeWidth: 1.5 });
}
