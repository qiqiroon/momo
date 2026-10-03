/**
 * features/rulebook のエントリポイント (★v1.99・画面機能 v0.59 §4.1 M08)。
 *
 * main-b.tsx から読み込まれると、ルールブックの窓を `overlay:rulebook` として登録する。
 * A ビルド (main-a.tsx) は読み込まないので窓ごと無い＝core 側は口が無いのを見て入口を出さない。
 */
import { register } from '../../core/plugin/registry';
import { RulebookWindow } from './RulebookWindow';

register('overlay:rulebook', RulebookWindow);
