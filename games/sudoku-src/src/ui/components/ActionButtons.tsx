/**
 * 操作パネルのボタン（第3分冊 8.6 / C-52）
 *
 * 消去・メモ・取消・やり直し・ヒント・中断して戻る。**操作はここへ集約し、ヘッダーへ散らさない。**
 *
 * 活性条件は 8.6 の表どおり。**ヒントだけは押下前に活性を判定しない**（対象可否が選択状態に
 * 細かく追従してボタンが点滅的に変化するため。押しても何も起きないだけとする）。
 * メモは Easy では**表示しない**（C-53。押しても意味のない操作を出さない）。
 */

import type { Difficulty } from '../../data/types';
import { t } from '../../i18n/locale';

export interface ActionButtonsProps {
  difficulty: Difficulty;
  noteMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 消去の可否（セル未選択・固定セル・空セルでは押せない。メモON中は候補の全消去） */
  canErase: boolean;
  /** 数字入力そのものが行えるか（セル未選択・固定セル選択中は不可） */
  canInput: boolean;
  onErase(): void;
  onToggleNoteMode(): void;
  onUndo(): void;
  onRedo(): void;
  onHint(): void;
  onSuspend(): void;
}

export function ActionButtons(props: ActionButtonsProps): React.ReactElement {
  return (
    <div className="action-row">
      <button
        type="button"
        className="btn"
        disabled={!props.canErase}
        onClick={props.onErase}
        data-testid="action-erase"
      >
        {t('play.action.erase')}
      </button>

      {props.difficulty !== 'Easy' && (
        <button
          type="button"
          className={props.noteMode ? 'btn btn-primary' : 'btn'}
          aria-pressed={props.noteMode}
          disabled={!props.canInput && !props.noteMode}
          onClick={props.onToggleNoteMode}
          data-testid="action-note"
        >
          {t('play.action.note')}
        </button>
      )}

      <button
        type="button"
        className="btn"
        disabled={!props.canUndo}
        onClick={props.onUndo}
        data-testid="action-undo"
      >
        {t('play.action.undo')}
      </button>

      <button
        type="button"
        className="btn"
        disabled={!props.canRedo}
        onClick={props.onRedo}
        data-testid="action-redo"
      >
        {t('play.action.redo')}
      </button>

      <button type="button" className="btn" onClick={props.onHint} data-testid="action-hint">
        {t('play.action.hint')}
      </button>

      <button type="button" className="btn" onClick={props.onSuspend} data-testid="action-suspend">
        {t('play.action.suspend')}
      </button>
    </div>
  );
}
