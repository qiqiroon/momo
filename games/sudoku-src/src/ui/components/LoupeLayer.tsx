/**
 * ルーペの操作部（第3分冊 7.2 / C-189）
 *
 * **中身は Canvas が描き、触るところだけをここが持つ。**
 * 虫眼鏡アイコンと、ルーペの中の `＋` / `−` である。
 *
 * 段階7 までルーペは「セルが小さくなると勝手に出るもの」だったが、
 * **自分で開く道具**に改めた（C-189）。よってアイコンは**閉じていても常に見えている**
 * ——これが唯一の開く手段だからである。
 *
 * アイコンは**設定した角から動かない**。ルーペの箱のほうは、数字ボタンに覆われるときだけ
 * 別の角へ逃げる（C-191）。動くものと動かないものを分けておくと、探す場所が一定になる。
 */

import type { LoupeCorner } from '../../data/types';
import { t } from '../../i18n/locale';
import { LOUPE_BOX_PX, LOUPE_BTN_H_PX, LOUPE_BTN_W_PX, LOUPE_MARGIN_PX } from '../config';
import type { Rect } from '../canvas/layout';

export interface LoupeLayerProps {
  /** 設定した角。アイコンはここから動かない */
  homeCorner: LoupeCorner;
  /** ルーペを開いているか */
  open: boolean;
  /** 箱の位置（開いているときだけ）。逃げた先が入る */
  box: Rect | null;
  onToggle(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/** 角から寸法ぶんだけ内側へ寄せた位置を作る */
function cornerStyle(corner: LoupeCorner): React.CSSProperties {
  const left = corner === 'TOP_LEFT' || corner === 'BOTTOM_LEFT';
  const top = corner === 'TOP_LEFT' || corner === 'TOP_RIGHT';
  return {
    position: 'absolute',
    width: LOUPE_BTN_W_PX,
    height: LOUPE_BTN_H_PX,
    [left ? 'left' : 'right']: LOUPE_MARGIN_PX,
    [top ? 'top' : 'bottom']: LOUPE_MARGIN_PX,
  };
}

export function LoupeLayer(props: LoupeLayerProps): React.ReactElement {
  const { homeCorner, open, box } = props;

  return (
    <>
      <button
        type="button"
        className={open ? 'loupe-icon loupe-icon-on' : 'loupe-icon'}
        style={cornerStyle(homeCorner)}
        aria-pressed={open}
        aria-label={t('play.loupe.toggle')}
        data-testid="loupe-toggle"
        onClick={props.onToggle}
      >
        {/* 虫眼鏡。文字ではなく図形で描く（言語に依らないため） */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <line
            x1="15.4"
            y1="15.4"
            x2="20.5"
            y2="20.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && box !== null && (
        <div
          className="loupe-controls"
          data-testid="loupe-controls"
          style={{
            position: 'absolute',
            left: box.x,
            top: box.y,
            width: LOUPE_BOX_PX,
            height: LOUPE_BOX_PX,
          }}
        >
          <button
            type="button"
            className="loupe-zoom"
            aria-label={t('play.zoom.out')}
            data-testid="loupe-zoom-out"
            disabled={!props.canZoomOut}
            onClick={props.onZoomOut}
          >
            −
          </button>
          <button
            type="button"
            className="loupe-zoom"
            aria-label={t('play.zoom.in')}
            data-testid="loupe-zoom-in"
            disabled={!props.canZoomIn}
            onClick={props.onZoomIn}
          >
            ＋
          </button>
        </div>
      )}
    </>
  );
}
