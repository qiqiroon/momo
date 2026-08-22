/**
 * 観戦者の「感想戦へ移りますか」と「対局が終わりました」（★v1.59・段3）。
 *
 * 意味論＝親 v1.59 §6.8.6／画面の要件＝画面機能 v0.51 §3 S07／絵柄＝付録D-3 v1.7 §4.2・§4.3。
 *
 * ## なぜ画面のいちばん外側に置くのか
 *
 * **観戦者が居る画面は 1 つではない**（準備画面・盤・感想戦）。**画面ごとに置くと、
 * 画面が増えたときに必ず書き忘れる**（v1.55 の「画面を消させない」を 1 か所に置いた
 * のと同じ理由）。**出す条件は画面の名前ではなく、受け取った知らせそのもの**である。
 *
 * ## 3 つの姿
 *
 * - **確認**：移り先が届いた＝「入る」か「観戦の一覧へ戻る」（**割り込む確認には
 *   必ず出口を置く**）。**部屋が閉じても消さない**＝行き先はもう手元にあるので、
 *   答えようのない問いにはなっていない（親 v1.59 §6.8.6）。
 * - **移っています**：探している間。**対局者側と同じ知らせ**にする。
 * - **対局が終わりました**：**移り先を持たないまま部屋が閉じたとき**と、
 *   **入ろうとして入れなかったとき**。**本人が閉じるまで残す**（付録D-3 §4.2）。
 */

import { useI18nStore } from '../../../core/store/i18n-store';
import { t as _t } from '../../../core/i18n';
import { seButton } from '../../../core/audio/se-synth';
import {
  acceptSpectateMigrate,
  declineSpectateMigrate,
  dismissSpectateEnded,
  useSpectateMigrateStore,
} from '../spectateMigrate';

export function SpectateMigrateDialog() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const offer = useSpectateMigrateStore((s) => s.offer);
  const moving = useSpectateMigrateStore((s) => s.moving);
  const ended = useSpectateMigrateStore((s) => s.ended);
  const kicked = useSpectateMigrateStore((s) => s.kicked);

  // ★v1.61: **追い出されたことを先に見る**＝もう部屋に居ないので、他の知らせより優先。
  //   **「対局が終わりました」とは言わない**（対局は続いているので嘘になる）。
  if (kicked) {
    return (
      <div className="opp-left-overlay" role="dialog" aria-modal="true">
        <div className="opp-left-modal spectate-modal">
          <div className="title">{t('s13.kickedTitle')}</div>
          <div className="body">{t('s13.kickedBody')}</div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              seButton();
              dismissSpectateEnded();
            }}
          >
            {t('s13.endedOk')}
          </button>
        </div>
      </div>
    );
  }

  // ★「対局が終わりました」を先に見る＝入れなかったときは確認も移動も畳んである。
  if (ended) {
    return (
      <div className="opp-left-overlay" role="dialog" aria-modal="true">
        <div className="opp-left-modal spectate-modal">
          <div className="title">{t('s13.endedTitle')}</div>
          <div className="body">{t('s13.endedBody')}</div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              seButton();
              dismissSpectateEnded();
            }}
          >
            {t('s13.endedOk')}
          </button>
        </div>
      </div>
    );
  }

  if (moving) {
    // **盤には触れない**（もともと観戦者は触れないが、移動が起きるまで待つことを
    // 見た目でも保つ）＝押すものは置かない（付録D-3 §4.3）。
    return (
      <div className="opp-left-overlay" role="dialog" aria-modal="true">
        <div className="opp-left-modal spectate-modal">
          <div className="body">{t('s11.migrating')}</div>
        </div>
      </div>
    );
  }

  if (!offer) return null;

  return (
    <div className="opp-left-overlay" role="dialog" aria-modal="true">
      <div className="opp-left-modal spectate-modal">
        <div className="title">{t('s13.migrateTitle')}</div>
        <div className="body">{t('s13.migrateBody')}</div>
        <div className="spectate-btn-row">
          {/* 出口。**副次＝白文字・白枠・地は透過**（付録D-3 §4.1 の色の決まり）。 */}
          <button
            type="button"
            className="btn ghost outline"
            onClick={() => {
              seButton();
              declineSpectateMigrate();
            }}
          >
            {t('s13.migrateLeave')}
          </button>
          {/* 主動作＝オレンジ地・白字。**部屋名も合言葉も画面に出さない**（親 §9.4.4）。 */}
          <button
            type="button"
            className="btn"
            onClick={() => {
              seButton();
              acceptSpectateMigrate();
            }}
          >
            {t('s13.migrateEnter')}
          </button>
        </div>
      </div>
    </div>
  );
}
