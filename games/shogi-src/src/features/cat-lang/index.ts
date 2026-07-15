import { register } from '../../core/plugin/registry';
import { cat, catSpeak, resetCatCache } from './translations';
import { useI18nStore } from '../../core/store/i18n-store';
import { useRouteStore } from '../../core/store/route-store';

// LocaleData マーカー (availableLocales() で 'cat' を含めるため)
register('i18n:cat', cat);
// v0.64: 動的鳴き声生成器を登録。core/i18n の t() が locale==='cat' 時に呼ぶ。
register('i18n:cat-speak', catSpeak);

// v0.66: 画面切替と locale/catBase 変更で猫語キャッシュをリセット
// (再レンダリング時に文言が変わらないようキャッシュしているため、
//  「新しい状況」に切り替わったタイミングで作り直す)
useRouteStore.subscribe((s, prev) => {
  if (s.screen !== prev.screen) resetCatCache();
});
useI18nStore.subscribe((s, prev) => {
  if (s.locale !== prev.locale || s.catBase !== prev.catBase) resetCatCache();
});
