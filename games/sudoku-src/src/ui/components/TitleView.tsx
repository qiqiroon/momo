/**
 * タイトルビュー（第3分冊 2.6 / C-31・C-34）
 *
 * 設定項目を1画面に集約する。案内は下部の常設テキストとする（C-37）。
 */

import type { BoardSize, Difficulty, Stats } from '../../data/types';
import { t } from '../../i18n/locale';
import { DifficultySelect } from './DifficultySelect';
import { GuideText } from './GuideText';
import { SiteFooter } from './SiteFooter';
import { SizeSelect } from './SizeSelect';
import { StartButtons } from './StartButtons';
import { StatsPanel } from './StatsPanel';
import { TransferPanel } from './TransferPanel';

/** 問題データの取得状況。取得完了を待たずに初回描画を出す（2.4） */
export type DataState = 'loading' | 'ready' | 'unavailable';

export interface TitleViewProps {
  dataState: DataState;
  /** 出題の準備中（`PREPARING`）。タイトルビューの上に読み込み表示を重ねる（2.2） */
  preparing: boolean;
  onRetryData(): void;

  selectableSizes: ReadonlySet<BoardSize>;
  sizeReason(n: BoardSize): 'locked' | 'offline';
  size: BoardSize;
  onChangeSize(n: BoardSize): void;

  difficulty: Difficulty;
  onChangeDifficulty(difficulty: Difficulty): void;

  hasSuspended: boolean;
  onResume(): void;
  onNew(): void;

  stats: Stats;
  onExport(): void;
  onPickFile(file: File): void;
}

export function TitleView(props: TitleViewProps): React.ReactElement {
  return (
    <main className="title-view">
      {props.dataState === 'loading' && <p className="muted">{t('title.data.loading')}</p>}
      {props.preparing && <p className="muted">{t('play.preparing')}</p>}

      {/* 取得も退避も無い場合はトーストではなくビュー内の案内とする（11.5 / 第1分冊 3.9.2） */}
      {props.dataState === 'unavailable' && (
        <div className="notice notice-error">
          <p>{t('title.data.unavailable')}</p>
          <button type="button" className="btn" onClick={props.onRetryData}>
            {t('title.data.retry')}
          </button>
        </div>
      )}

      <SizeSelect
        selectable={props.selectableSizes}
        reasonOf={props.sizeReason}
        value={props.size}
        onChange={props.onChangeSize}
      />
      <DifficultySelect value={props.difficulty} onChange={props.onChangeDifficulty} />
      <StartButtons hasSuspended={props.hasSuspended} onResume={props.onResume} onNew={props.onNew} />
      <StatsPanel stats={props.stats} />
      <TransferPanel onExport={props.onExport} onPickFile={props.onPickFile} />
      <GuideText />
      <SiteFooter />
    </main>
  );
}
