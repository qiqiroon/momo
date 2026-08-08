/**
 * 開始操作（第3分冊 2.6）
 *
 * 「前回の続きから」は中断がある場合のみ活性。
 * 「新しく始める」は常に活性で、中断があれば破棄確認ダイアログを出す（C-39 / D-01）。
 */

import { t } from '../../i18n/locale';

export interface StartButtonsProps {
  hasSuspended: boolean;
  onResume(): void;
  onNew(): void;
}

export function StartButtons({ hasSuspended, onResume, onNew }: StartButtonsProps): React.ReactElement {
  return (
    <section className="panel-block start-block">
      <button type="button" className="btn btn-lg" disabled={!hasSuspended} onClick={onResume}>
        {t('title.start.resume')}
      </button>
      <button type="button" className="btn btn-lg btn-primary" onClick={onNew}>
        {t('title.start.new')}
      </button>
    </section>
  );
}
