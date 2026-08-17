import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import { FloatingPanel } from './FloatingPanel';
import { seButton } from '../audio/se-synth';
import { dismissSaveNotice, useSaveNoticeStore } from '../store/save-notice';

/**
 * 「保存しました」の知らせ（親 v1.40 §9.2.3 ③・付録D-8 §8）。
 *
 * **本人が OK を押すまで残す**。理由は save-notice.ts の頭に書いたとおりで、
 * 保存が成功しても画面は何も変わらないため、知らせが消えると「何も起きなかった」
 * のと区別が付かなくなる。
 *
 * **ファイル名は折り返して全部出す**（中央省略しない）＝次にファイルを探すときの
 * 手がかりそのものであり、末尾の連番が隠れると同じ対局の別ファイルと見分けが付かない。
 */
export function SaveNoticeDialog() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const notice = useSaveNoticeStore((s) => s.notice);

  if (!notice) return null;

  return (
    <FloatingPanel
      className="floating-result floating-confirm kifu save-notice"
      title={
        <>
          <span className="icon">💾</span>
          {t(notice.verified ? 'kifu.saved.title' : 'kifu.saved.titleUnverified')}
        </>
      }
    >
      <div className="save-notice-row">
        <span className="lbl">{t('kifu.saved.file')}</span>
        <span className="val name">{notice.fileName}</span>
      </div>
      {notice.folderName && (
        <div className="save-notice-row">
          <span className="lbl">{t('kifu.saved.folder')}</span>
          <span className="val">{notice.folderName}</span>
        </div>
      )}
      {/* 確かめられなかった経路（ダウンロード・共有シート）では断定しない。
          どこへ置かれたかはこちらから見えないので、そのことをそのまま言う。 */}
      {!notice.verified && <div className="body warn">{t('kifu.saved.unverifiedNote')}</div>}
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            seButton();
            dismissSaveNotice();
          }}
        >
          {t('kifu.saved.ok')}
        </button>
      </div>
    </FloatingPanel>
  );
}
