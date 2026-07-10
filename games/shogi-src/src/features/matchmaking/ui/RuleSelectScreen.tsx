import { useEffect } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { getMomoMatchmaking } from '../client';
import type { TimeControlMode } from '../store';
import { useMatchmakingStore } from '../store';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';
import { encodeRoomName, getBadgeLabels, type GameType } from '../roomNameCodec';

const GAME_OPTIONS: { value: GameType; disabled?: boolean; note?: string }[] = [
  { value: 'shogi' },
  { value: 'hasami', note: 'Phase 3 でエンジン実装予定 (現状は本将棋盤面にフォールバック)' },
];

const TIME_MODES: { value: TimeControlMode; label: string; desc: string }[] = [
  { value: 'byoyomi', label: '秒読み', desc: '本時間 + 一手ごとに秒読み' },
  { value: 'sudden_death', label: '切れ負け', desc: '本時間のみ・切れたら負け' },
  { value: 'fischer', label: 'フィッシャー', desc: '本時間 + 一手ごとに加算' },
  { value: 'no_limit', label: '時間フリー', desc: '制限なし' },
];

/** localStorage キー：前回の部屋名を記憶（パスワードは保存しない） */
const LS_LAST_ROOM_NAME = 'shogi.roomForm.lastRoomName';

export function RuleSelectScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const config = useMatchmakingStore((s) => s.pendingRoomConfig);
  const setConfig = useMatchmakingStore((s) => s.setPendingRoomConfig);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const setError = useMatchmakingStore((s) => s.setError);
  const setActiveRoomConfig = useMatchmakingStore((s) => s.setActiveRoomConfig);
  const setCurrentRoom = useMatchmakingStore((s) => s.setCurrentRoom);
  const setOpponentName = useMatchmakingStore((s) => s.setOpponentName);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  // 画面表示時に前回使った部屋名を復元（パスワードは記憶しない）
  useEffect(() => {
    if (config.roomName) return;
    try {
      const saved = localStorage.getItem(LS_LAST_ROOM_NAME);
      if (saved) setConfig({ roomName: saved });
    } catch {
      // localStorage 使えない環境は無視
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBack = () => setScreen('net-lobby');

  const onStart = () => {
    if (!playerName.trim()) {
      setError('ロビー画面でプレイヤー名を入力してください');
      setScreen('net-lobby');
      return;
    }
    const client = getMomoMatchmaking();
    if (!client) return;
    const userRoomName = config.roomName || '本将棋の部屋';
    // encoding: [本+環+量:カスタム名] ユーザー部屋名 の形にして送信
    const encodedName = encodeRoomName({
      gameType: config.gameType,
      torus: config.torus,
      quantum: config.quantum,
      customRuleName: config.customRuleName,
      userRoomName,
    });
    // 次回のために「素の」部屋名だけ保存（パスワードは保存しない）
    try {
      localStorage.setItem(LS_LAST_ROOM_NAME, userRoomName);
    } catch {
      // localStorage 使えない環境は無視
    }
    // activeRoomConfig / currentRoomName にはサーバー保管形の encoded を格納する
    // (WaitingScreen/RoomScreen での表示はレンダリング時に decode する)
    setActiveRoomConfig({ ...config, roomName: encodedName });
    setCurrentRoom({ roomId: null, roomName: encodedName, isHost: true });
    setOpponentName('');
    client.createRoom({
      hostName: playerName,
      name: encodedName,
      password: config.password,
      isPublic: config.isPublic,
      rules: {
        game: config.gameType,
        torus: config.torus,
        quantum: config.quantum,
        customRuleName: config.customRuleName,
        time: config.timeControl,
      },
    });
    setScreen('waiting');
  };

  const badgeLabels = getBadgeLabels(locale);

  return (
    <div className="stage">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <header className="match-header">
          <CatIcon />
          <div className="title-block">
            <h1>
              <span className="momo">MOMO</span> <span className="shogi">Shogi</span>{' '}
              <span className="ver">{t('app.ver')}</span>
            </h1>
            <div className={`subtitle${subLocale === 'zh' ? ' zh' : ''}`}>{subtitle}</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            <button className="reset-btn" type="button" onClick={onBack}>
              ロビーへ戻る
            </button>
          </div>
        </header>

        <ScreenBand code="S02" name="ルール選択" />

        {/*
         * Chrome の自動 fill 対策:
         * - 部屋名 input と パスワード input は WebAuthn / auto-login と関係ない用途
         * - <form autoComplete="off"> で囲み、パスワードは autoComplete="new-password" にする
         *   （既存パスワードマネージャの候補が出ないよう "new-password" を指定）
         * - 適当な name 属性を付けると Chrome が推測しにくくなる
         */}
        <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <div style={{ marginTop: 10, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>部屋情報</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>部屋名</span>
              <input
                type="text"
                name="shogi-room-label"
                autoComplete="off"
                value={config.roomName}
                onChange={(e) => setConfig({ roomName: e.target.value })}
                placeholder="本将棋の部屋"
                maxLength={30}
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>パスワード</span>
              <input
                type="password"
                name="shogi-room-key"
                autoComplete="new-password"
                value={config.password}
                onChange={(e) => setConfig({ password: e.target.value })}
                placeholder="(任意)"
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={config.isPublic} onChange={(e) => setConfig({ isPublic: e.target.checked })} />
              <span style={{ color: 'var(--text-muted)' }}>ロビー一覧に公開する</span>
            </label>
          </div>
        </div>
        </form>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>ゲーム</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GAME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="act"
                onClick={() => setConfig({ gameType: opt.value })}
                style={config.gameType === opt.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                title={opt.note}
              >
                {badgeLabels.gameType[opt.value]}
              </button>
            ))}
          </div>
          {config.gameType === 'hasami' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              ※ はさみ将棋のエンジンは Phase 3 で実装予定（現状は本将棋盤面にフォールバック）
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            ※ 自由ルール将棋（MGF）は Phase 3 で追加予定
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>盤面ルール</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={config.torus} onChange={(e) => setConfig({ torus: e.target.checked })} />
              <span style={{ color: 'var(--text)' }}>トーラス盤面（端と端がつながる）</span>
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={config.quantum} onChange={(e) => setConfig({ quantum: e.target.checked })} />
              <span style={{ color: 'var(--text)' }}>量子将棋</span>
            </label>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            ※ 実際の対局への反映は Phase 3+ で実装予定。現状は部屋のラベル表示のみ
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>先後</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            入室後の準備画面で両者がそれぞれ選択します
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>持ち時間</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TIME_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className="act"
                onClick={() => setConfig({ timeControl: { mode: m.value, mainSeconds: 600, byoyomiSeconds: m.value === 'byoyomi' ? 30 : undefined, incrementSeconds: m.value === 'fischer' ? 10 : undefined } })}
                style={config.timeControl.mode === m.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            現在の設定: {TIME_MODES.find((m) => m.value === config.timeControl.mode)?.desc}
            {config.timeControl.mode !== 'no_limit' && (
              <> (本時間 {Math.floor(config.timeControl.mainSeconds / 60)}分)</>
            )}
            {config.timeControl.mode === 'byoyomi' && (
              <> + 秒読み {config.timeControl.byoyomiSeconds}秒</>
            )}
            {config.timeControl.mode === 'fischer' && (
              <> + 加算 {config.timeControl.incrementSeconds}秒</>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            ※ 詳細な時間調整 UI は段階 2-8 で追加予定
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button className="act taunt" type="button" onClick={onStart} style={{ minWidth: 180 }}>
            対局準備 (部屋作成)
          </button>
        </div>
      </div>
    </div>
  );
}
