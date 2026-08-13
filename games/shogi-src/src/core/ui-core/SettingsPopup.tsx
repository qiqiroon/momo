import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import { getBgmVolume, getSfxVolume, setBgmVolume, setSfxVolume } from '../audio/audio-engine';
import { useDebugStore, type DebugPanelEvent } from '../store/debug-store';
import { useGameStore } from '../store/game-store';
import { SETTINGS_DEFAULTS, clearUiSettings, loadByomuSound, saveByomuSound } from '../store/ui-settings';

/**
 * v0.73: 歯車ボタンから開く設定ポップアップ (Darts 準拠)。
 *  v0.78: クレジットボタン + 別モーダルに変更 (CC-BY のみ表示、CC0 は義務なしで割愛)。
 */
interface SettingsPopupProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPopup({ open, onClose }: SettingsPopupProps) {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const [bgmV, setBgmV] = useState<number>(getBgmVolume());
  const [sfxV, setSfxV] = useState<number>(getSfxVolume());
  const [creditsOpen, setCreditsOpen] = useState(false);
  // v1.22: 移動先ヒント (行き先マスのオレンジ) の表示。既定 ON・端末ごとの設定。
  // 盤側も同じ値を見るので game-store に置く (localStorage への保存はその中で行う)。
  const hintOn = useGameStore((s) => s.hintAlwaysOn);
  const setHintOn = useGameStore((s) => s.setHintAlwaysOn);
  // v1.22: 秒読み音。音そのものが未実装なので、いまは値を覚えるだけ。
  const [byomuOn, setByomuOn] = useState<boolean>(loadByomuSound);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setBgmV(getBgmVolume());
      setSfxV(getSfxVolume());
      setByomuOn(loadByomuSound());
      setCreditsOpen(false); // 開き直したときは初期状態に戻す
      setResetOpen(false);
    }
  }, [open]);

  if (!open) return null;

  const onBgm = (v: number) => { setBgmV(v); setBgmVolume(v); };
  const onSfx = (v: number) => { setSfxV(v); setSfxVolume(v); };

  return (
    <>
      {/* クリック透過の外側キャプチャ (背景タップで閉じる) */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 400 }}
      />
      {/* ポップアップ本体 (歯車の下に固定) */}
      <div
        style={{
          position: 'fixed', top: 46, right: 12, zIndex: 401,
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 10, padding: '12px 14px', minWidth: 240, color: 'var(--text)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 10 }}>
          {t('sound.settingsTitle')}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
          <span style={{ minWidth: 64, color: 'var(--text-muted)' }}>{t('sound.bgmLabel')}</span>
          <input type="range" min="0" max="100" value={bgmV} onChange={(e) => onBgm(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--orange)' }} />
          <span style={{ minWidth: 36, textAlign: 'right' }}>{bgmV}%</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ minWidth: 64, color: 'var(--text-muted)' }}>{t('sound.sfxLabel')}</span>
          <input type="range" min="0" max="100" value={sfxV} onChange={(e) => onSfx(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--orange)' }} />
          <span style={{ minWidth: 36, textAlign: 'right' }}>{sfxV}%</span>
        </label>
        {/* v1.22: 秒読み音 (S10 モック v3 / 付録D-10 §5.1 の音セクション 3 行目)。
            秒読みの音そのものはまだ実装していないので、いまは何も鳴らない。 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 8 }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)' }}>{t('settings.byomuSound')}</span>
          <SettingSwitch
            label={t('settings.byomuSound')}
            on={byomuOn}
            onChange={(v) => { setByomuOn(v); saveByomuSound(v); }}
          />
        </div>
        {/* v1.22: 対局セクション (S10 モック v3 / 付録D-10 §5.2 の行 2-1・2-2) */}
        <div style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.06em', marginTop: 14, marginBottom: 8 }}>
          {t('settings.gameSection')}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('settings.hintAlwaysOn')}</span>
            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 }}>
              {t('settings.hintDesc')}
            </span>
          </span>
          <SettingSwitch label={t('settings.hintAlwaysOn')} on={hintOn} onChange={setHintOn} />
        </div>
        <QuantumDisplaySection t={t} />
        {/* v1.22: リセットは設定の一部なので**線より上**。確認を挟んでから既定値に戻す (付録D-10 §6)。 */}
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            style={{
              background: 'transparent', color: 'var(--danger, #c0392b)',
              border: '1px solid var(--danger, #c0392b)', borderRadius: 6,
              padding: '6px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('settings.reset')}
          </button>
        </div>
        {/* v1.22: 設定ではないもの (クレジット・デバッグパネルへの入口) は**線の下**へ。
            v0.80: ボタン → リンク風テキストに変更 */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-strong)', textAlign: 'right' }}>
          <a
            href="#credits"
            onClick={(e) => { e.preventDefault(); setCreditsOpen(true); }}
            style={{
              fontSize: 11, color: 'var(--text-muted)',
              textDecoration: 'underline', cursor: 'pointer',
            }}
          >
            {t('sound.creditsButton')}
          </a>
          <DebugPanelLink onOpen={onClose} />
        </div>
      </div>
      {creditsOpen && <CreditsModal onClose={() => setCreditsOpen(false)} t={t} />}
      {resetOpen && (
        <ResetConfirm
          t={t}
          onCancel={() => setResetOpen(false)}
          onConfirm={() => {
            resetAllSettings();
            setBgmV(getBgmVolume());
            setSfxV(getSfxVolume());
            setByomuOn(SETTINGS_DEFAULTS.byomuSound);
            setResetOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * v1.08 (Phase 5-11) → v1.22 でカード式へ。未確定駒の見せ方の切替。
 *
 * 意匠は S10 モック `momo_shogi_S10_mock_v3.html` / 付録D-10 v2.4 §5.2.1、
 * 操作の可否は駒デザイン・対局UI v0.9 §4.4:
 * - 量子モードの対局中だけ現れる
 * - 部屋の値が巡回なら、**誰でも** 自分の画面の値を切り替えられる (バッジ「自分の画面のみ」)
 * - 部屋の値が重ねなら固定 = 読みやすい側へは誰も逃げられない (バッジ「重ね固定」)
 *
 * v1.24: ルールを決めた側だけを特別扱いするのをやめた。対局中に基準を動かせるのが
 * 片方だけだと、自分に有利な局面で読みやすさを変えられて不公平になるため。
 */
function QuantumDisplaySection({ t }: { t: (k: string) => string }) {
  const currentQuantum = useGameStore((s) => s.currentQuantum);
  const quantumDisplay = useGameStore((s) => s.quantumDisplay);
  const roomQuantumDisplay = useGameStore((s) => s.roomQuantumDisplay);
  const setQuantumDisplay = useGameStore((s) => s.setQuantumDisplay);
  if (!currentQuantum) return null;
  const stackFixed = roomQuantumDisplay === 'stack';
  const canEdit = !stackFixed;
  const badge = stackFixed ? t('qmode.stackFixed') : t('qmode.ownScreenOnly');
  const cards: { value: 'stack' | 'cycle'; title: string; desc: string }[] = [
    { value: 'stack', title: t('qmode.stack'), desc: t('qmode.stackDesc') },
    { value: 'cycle', title: t('qmode.cycle'), desc: t('qmode.cycleDesc') },
  ];
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border-strong)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.06em' }}>
          {t('qmode.title')}
        </span>
        {badge && <span className="qd-badge">{badge}</span>}
      </div>
      <div className={`qd-grid${canEdit ? '' : ' locked'}`} role="radiogroup" aria-label={t('qmode.title')}>
        {cards.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={quantumDisplay === c.value}
            aria-disabled={!canEdit}
            className={`qd-card${quantumDisplay === c.value ? ' selected' : ''}`}
            onClick={() => { if (canEdit) setQuantumDisplay(c.value); }}
          >
            <QuantumDisplayPreview kind={c.value} />
            <div className="qd-title">{c.title}</div>
            <div className="qd-desc">{c.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * v1.22: 設定のオン/オフスイッチ (S10 モック v3 / 付録D-10 §4.5)。
 * モックはチェックボックスではなくスイッチなので、そちらに合わせる。
 */
function SettingSwitch({ label, on, onChange }: {
  label: string; on: boolean; onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`set-toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

/** 既定値 (付録D-10 §9)。BGM=60 / 効果音=80 は audio-engine 側の初期値と揃える。 */
const DEFAULT_BGM = 60;
const DEFAULT_SFX = 80;

/**
 * v1.22: 全設定を既定に戻す (付録D-10 §6)。
 * 端末ごとの設定だけを戻し、対局中のルール (部屋の値) には触らない。
 */
function resetAllSettings(): void {
  clearUiSettings();
  setBgmVolume(DEFAULT_BGM);
  setSfxVolume(DEFAULT_SFX);
  useGameStore.getState().setHintAlwaysOn(SETTINGS_DEFAULTS.hintAlwaysOn);
  // 自分の画面の値も既定へ。部屋の値が重ねなら見え方は重ねのまま (spec 駒UI v0.8 §4.4)。
  useGameStore.getState().setQuantumDisplay(SETTINGS_DEFAULTS.myQuantumDisplay);
}

/** v1.22: リセットの確認 (付録D-10 §6「この操作は元に戻せません」)。 */
function ResetConfirm({ t, onCancel, onConfirm }: {
  t: (k: string) => string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500 }} />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 501, background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 10, padding: '16px 18px', maxWidth: 320, width: '86vw', color: 'var(--text)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 12, lineHeight: 1.7 }}>{t('settings.resetConfirm')}</div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button" onClick={onCancel}
            style={{
              padding: '5px 12px', background: 'transparent', border: '1px solid var(--border-strong)',
              borderRadius: 6, color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('resign.confirmNo')}
          </button>
          <button
            type="button" onClick={onConfirm}
            style={{
              padding: '5px 12px', background: 'var(--danger, #c0392b)', border: 'none',
              borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('settings.reset')}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * v1.22: カードのミニプレビュー (付録D-10 §5.2.1)。
 * 重ね = 候補を濃い字のまま重ねる / 巡回 = 1秒ごとに字が入れ替わる。
 * 「動きを減らす」設定のときは巡回を止めて代表 1 字を出す。
 */
function QuantumDisplayPreview({ kind }: { kind: 'stack' | 'cycle' }) {
  const glyphs = ['歩', '香', '桂'];
  const [i, setI] = useState(1);
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (kind !== 'cycle' || reduced) return;
    const id = setInterval(() => setI((n) => (n + 1) % glyphs.length), 1000);
    return () => clearInterval(id);
  }, [kind, reduced]);
  return (
    <div className="qd-preview">
      <div className="qd-piece">
        {kind === 'stack'
          ? glyphs.map((g, n) => <span key={g} className={`qd-glyph g${n + 1}`}>{g}</span>)
          : <span className="qd-glyph">{glyphs[i]}</span>}
      </div>
    </div>
  );
}

/**
 * v0.91 追加, v0.95 復元。`?debug=1` が付いている時だけ現れる「デバッグパネル」リンク。
 * クリックすると SettingsPopup を閉じてフローティング DebugPanel (PieceID スイッチ等) を開く。
 *
 * v1.26 (ユーザー報告 2026-08-14「押しても何も出ない」): リンクの下に**直前の開閉の記録**を
 * 出す。押した記録／出た記録／消えた記録のどれが残っているかで原因が分かれるため。
 * 記録はここに残るので、**開かなかったあとに設定をもう一度開けば読める**。
 */
function DebugPanelLink({ onOpen }: { onOpen: () => void }) {
  const enabled = useDebugStore((s) => s.enabled);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  const panelEvents = useDebugStore((s) => s.panelEvents);
  if (!enabled) return null;
  const recent = panelEvents.slice(-4);
  return (
    <div style={{ marginTop: 8, textAlign: 'right' }}>
      <a
        href="#debug"
        onClick={(e) => {
          e.preventDefault();
          setPanelOpen(true, '設定の「デバッグパネル」を押した');
          onOpen();
        }}
        style={{
          fontSize: 11, color: 'var(--orange)',
          textDecoration: 'underline', cursor: 'pointer',
        }}
      >
        デバッグパネル
      </a>
      {recent.length > 0 && (
        <div
          style={{
            marginTop: 6, textAlign: 'left', fontSize: 10, lineHeight: 1.5,
            color: 'var(--text-muted)', background: 'rgba(0,0,0,0.25)',
            border: '1px solid var(--border-strong)', borderRadius: 4,
            padding: '5px 6px', maxHeight: 92, overflowY: 'auto',
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace', wordBreak: 'break-all',
          }}
        >
          {recent.map((e, i) => (
            <div key={i}>{formatPanelEvent(e)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const PANEL_EVENT_LABEL: Record<DebugPanelEvent['kind'], string> = {
  'open-requested': '押した',
  shown: '出た',
  closed: '消えた',
};

function formatPanelEvent(e: DebugPanelEvent): string {
  const t = new Date(e.time);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}] ${PANEL_EVENT_LABEL[e.kind]} ${e.detail}`;
}

/**
 * v0.78: クレジット別モーダル。CC-BY で表示義務のある提供者のみを掲載する
 * (CC0 は法的義務なしのため割愛)。
 * v0.81: タイトルを削除、ライセンス別を横並び (太字なし・改行なし)、閉じるボタンを地味に。
 */
function CreditsModal({ onClose, t }: { onClose: () => void; t: (k: string) => string }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500 }}
      />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 501, background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 10, padding: '14px 16px', maxWidth: 380, width: '90vw',
          maxHeight: '80vh', overflowY: 'auto', color: 'var(--text)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          CC-BY 4.0:{' '}
          <a href="https://taira-komori.net/freesounden.html" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>Taira Komori</a>
          {' / '}
          CC-BY (Freesound):{' '}
          <a href="https://freesound.org/s/185846/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LloydEvans09</a>{', '}
          <a href="https://freesound.org/s/658431/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>deathbyfairydust</a>{', '}
          <a href="https://freesound.org/s/270404/" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>LittleRobotSoundFactory</a>
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '4px 12px',
              background: 'transparent', border: '1px solid var(--border-strong)',
              borderRadius: 6, color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
            }}
          >
            {t('sound.creditsClose')}
          </button>
        </div>
      </div>
    </>
  );
}
