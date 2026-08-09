/**
 * プレイビュー（第3分冊 2.9）
 *
 * 盤面と操作パネルを縦に積む。盤面領域は残余をすべて占める。
 * **状態表示は共通ヘッダーへ移した**（⑪）。以前は盤面と一緒にスクロールして画面の外へ出ていた。
 * 本部品は受け取ったものを配るだけで、状態も判定も持たない（15.6）。
 */

import type { BoardLayout } from '../canvas/layout';
import type { RenderModel } from '../canvas/renderer';
import type { ViewportState } from '../canvas/viewport';
import type { BoardSize, Difficulty } from '../../data/types';
import { BoardCanvas } from './BoardCanvas';
import type { LoupeCorner } from '../../data/types';
import { ControlPanel, type PaletteCover } from './ControlPanel';

export interface PlayViewProps {
  n: BoardSize;
  b: number;
  difficulty: Difficulty;

  model: RenderModel;
  layout: BoardLayout;
  onResize(width: number, height: number): void;
  onSelectCell(index: number | null): void;
  onDismissHint(index: number): void;
  /** マウスが乗っているマス（C-185・ルーペ用）。盤面の外へ出たら `null` */
  onHoverCell(index: number | null): void;
  /** 盤面領域の画面上の位置（C-198） */
  onFrameRect(rect: { left: number; top: number; width: number; height: number }): void;
  /** ズーム・パンの結果（5.5 / 15.6）。盤面からも操作パネルからも同じ窓口へ流す */
  onViewportChange(next: ViewportState): void;
  /** 拡大したパレットが盤面のどちら側を覆っているか（C-159）。ルーペの置き場所に効く */
  onPaletteCoveringChange(cover: PaletteCover | null): void;
  /** 数字ボタンの大きさの倍率（C-190） */
  paletteScale: number;
  /** 大きさを決めている最中か（C-190） */
  paletteSizePreview: boolean;
  /** 数字ボタンを手で縮めているか（C-204） */
  paletteCollapsed: boolean;
  onTogglePaletteCollapsed(): void;
  /** ルーペの操作部（C-189）。中身は Canvas が描き、触るところだけを重ねる */
  loupe: {
    homeCorner: LoupeCorner;
    open: boolean;
    corner: LoupeCorner | null;
    onToggle(): void;
    onZoomIn(): void;
    onZoomOut(): void;
    canZoomIn: boolean;
    canZoomOut: boolean;
  };

  exhausted: readonly boolean[];
  noteMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selected: number | null;
  selectedIsGiven: boolean;
  selectedHasValue: boolean;
  selectedHasNotes: boolean;
  onInput(value: number): void;
  onErase(): void;
  onToggleNoteMode(): void;
  onUndo(): void;
  onRedo(): void;
  onHint(): void;
  onSuspend(): void;
}

export function PlayView(props: PlayViewProps): React.ReactElement {
  return (
    <main className="play-view">
      <BoardCanvas
        model={props.model}
        layout={props.layout}
        onResize={props.onResize}
        onSelectCell={props.onSelectCell}
        onDismissHint={props.onDismissHint}
        onHoverCell={props.onHoverCell}
        onFrameRect={props.onFrameRect}
        loupe={props.loupe}
        onViewportChange={props.onViewportChange}
        selected={props.selected}
      />
      <ControlPanel
        n={props.n}
        b={props.b}
        viewport={props.model.viewport}
        layout={props.layout}
        onZoom={props.onViewportChange}
        onCoveringChange={props.onPaletteCoveringChange}
        paletteScale={props.paletteScale}
        sizePreview={props.paletteSizePreview}
        paletteCollapsed={props.paletteCollapsed}
        onTogglePaletteCollapsed={props.onTogglePaletteCollapsed}
        difficulty={props.difficulty}
        exhausted={props.exhausted}
        noteMode={props.noteMode}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        selected={props.selected}
        selectedIsGiven={props.selectedIsGiven}
        selectedHasValue={props.selectedHasValue}
        selectedHasNotes={props.selectedHasNotes}
        onInput={props.onInput}
        onErase={props.onErase}
        onToggleNoteMode={props.onToggleNoteMode}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onHint={props.onHint}
        onSuspend={props.onSuspend}
      />
    </main>
  );
}
