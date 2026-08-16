import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import { FloatingPanel } from './FloatingPanel';
import { seButton } from '../audio/se-synth';
import {
  guardCancel,
  guardDiscard,
  guardResetYes,
  guardSave,
  useKifuGuardStore,
} from '../store/kifu-guard';

/**
 * 棋譜を捨てる前の確認（親 v1.36 §9.2.3 ②・画面機能 v0.30 §3 S02／S07）。
 *
 * **画面のいちばん外側に置く**（RootView 直下）。どの画面から呼ばれても同じ物が出るし、
 * 途中の入れ物の重なり順に埋もれない。
 *
 * 二段になるのは**対局画面のリセット**だけ（対局中に押せる位置にあり、誤操作の代償が
 * 大きいため）。他は終局後に押す物なので一段で尋ねる。
 */
export function KifuGuardDialog() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const stage = useKifuGuardStore((s) => s.stage);
  const saving = useKifuGuardStore((s) => s.saving);
  const cancelled = useKifuGuardStore((s) => s.cancelled);

  if (stage === null) return null;

  if (stage === 'reset') {
    return (
      <FloatingPanel
        className="floating-result floating-confirm undo"
        title={
          <>
            <span className="icon">↩</span>
            {t('kifu.guard.resetTitle')}
          </>
        }
      >
        <div className="body">{t('kifu.guard.resetBody')}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => { seButton(); guardCancel(); }}>
            {t('kifu.guard.resetNo')}
          </button>
          <button type="button" className="btn" onClick={() => { seButton(); guardResetYes(); }}>
            {t('kifu.guard.resetYes')}
          </button>
        </div>
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel
      className="floating-result floating-confirm draw"
      title={
        <>
          <span className="icon">📄</span>
          {t('kifu.guard.title')}
        </>
      }
    >
      <div className="body">{t('kifu.guard.body')}</div>
      {/* 共有シートを取り消したときは、何も書けていないことをその場で伝える
          （元の操作も行わず、この確認へ戻る＝親 §9.2.3 ③）。 */}
      {cancelled && <div className="body warn">{t('kifu.guard.cancelledNote')}</div>}
      <div className="btn-row">
        <button
          type="button"
          className="btn ghost"
          disabled={saving}
          onClick={() => { seButton(); guardDiscard(); }}
        >
          {t('kifu.guard.discard')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() => { seButton(); void guardSave(); }}
        >
          {saving ? t('kifu.guard.saving') : t('kifu.guard.save')}
        </button>
      </div>
    </FloatingPanel>
  );
}
