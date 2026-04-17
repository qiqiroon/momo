// versions.js - MOMO Noise Version Registry
'use strict';

const VERSIONS = {
  app: '1.12',
  modules: {
    app:   '0.13',
    audio: '0.04',
    drive: '0.03',
    metro: '0.02',
    style: '0.06',
    html:  '0.04',
  },
  history: [
    { app: '1.00', modules: { app:'0.01', audio:'0.01', drive:'0.01', metro:'0.01', style:'0.01', html:'0.01' }, note: '初版' },
    { app: '1.01', modules: { app:'0.02', audio:'0.02', drive:'0.02', metro:'0.01', style:'0.01', html:'0.01' }, note: 'Drive保存修正、iOS録音対応' },
    { app: '1.02', modules: { app:'0.03', audio:'0.02', drive:'0.02', metro:'0.01', style:'0.01', html:'0.01' }, note: 'iOS再生・モード切替修正' },
    { app: '1.03', modules: { app:'0.04', audio:'0.03', drive:'0.03', metro:'0.02', style:'0.02', html:'0.03' }, note: '全面刷新：ピッチステップ化・同期修正・番号固定WAV' },
    { app: '1.04', modules: { app:'0.05', audio:'0.03', drive:'0.03', metro:'0.02', style:'0.02', html:'0.03' }, note: 'バージョン表示をTAP前スプラッシュに移動' },
    { app: '1.05', modules: { app:'0.06', audio:'0.03', drive:'0.03', metro:'0.02', style:'0.02', html:'0.03' }, note: 'versions.js導入・バージョン管理一元化' },
    { app: '1.06', modules: { app:'0.07', audio:'0.03', drive:'0.03', metro:'0.02', style:'0.02', html:'0.03' }, note: 'I18NのverキーをVERSIONS.appに統一・矛盾解消' },
    { app: '1.07', modules: { app:'0.08', audio:'0.04', drive:'0.03', metro:'0.02', style:'0.03', html:'0.03' }, note: '画面暗転復帰後の再生不可修正・録音頭欠け修正・パッドボタンをテキストサイズに変更' },
    { app: '1.08', modules: { app:'0.09', audio:'0.04', drive:'0.03', metro:'0.02', style:'0.04', html:'0.03' }, note: '録音UIをモーメンタリーボタン＋ステータス表示方式に変更' },
    { app: '1.09', modules: { app:'0.10', audio:'0.04', drive:'0.03', metro:'0.02', style:'0.05', html:'0.03' }, note: '録音・停止ボタンの色残り修正' },
    { app: '1.10', modules: { app:'0.11', audio:'0.04', drive:'0.03', metro:'0.02', style:'0.06', html:'0.04' }, note: 'iOSホバー残り根本修正・ファイル選択のみ・同期二重再生防止・Drive接続ボタン廃止' },
    { app: '1.11', modules: { app:'0.12', audio:'0.04', drive:'0.03', metro:'0.02', style:'0.06', html:'0.04' }, note: '録音ボタンclick化・className完全リセット・画面復帰resume強化・二重再生閾値修正' },
    { app: '1.12', modules: { app:'0.13', audio:'0.04', drive:'0.03', metro:'0.02', style:'0.06', html:'0.04' }, note: 'デバッグパネル追加（録音ボタン・画面復帰・同期再生の診断用）' },
  ]
};
