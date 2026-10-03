/**
 * ★v2.01 音量の右に置く「ミュート」のチェック (2026-10-03 ユーザー指示・MOMO Fireworks と同じ形)。
 * 歯車の音の欄と、最初に尋ねる窓の両方で使う＝2 か所で別々に作らない。
 */
export function MuteBox({ checked, label, onChange }: { checked: boolean; label: string; onChange: (m: boolean) => void }) {
  return (
    <label
      className="mute-box"
      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#b5b5b5', whiteSpace: 'nowrap', cursor: 'pointer' }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--orange-mid)' }} />
      <span>{label}</span>
    </label>
  );
}
