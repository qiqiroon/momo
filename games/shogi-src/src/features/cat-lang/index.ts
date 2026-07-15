import { register } from '../../core/plugin/registry';
import { cat, catSpeak } from './translations';

// LocaleData マーカー (availableLocales() で 'cat' を含めるため)
register('i18n:cat', cat);
// v0.64: 動的鳴き声生成器を登録。core/i18n の t() が locale==='cat' 時に呼ぶ。
register('i18n:cat-speak', catSpeak);
