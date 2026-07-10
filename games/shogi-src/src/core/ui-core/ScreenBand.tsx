/**
 * ヘッダー直下に表示する薄い帯。
 * 「S00 · メニュー」のような画面識別を控えめに表示する。
 */
interface ScreenBandProps {
  code: string;
  name: string;
}

export function ScreenBand({ code, name }: ScreenBandProps) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: '3px 10px',
        fontSize: 10,
        color: 'var(--text-muted)',
        textAlign: 'center',
        letterSpacing: '0.06em',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      {code} · {name}
    </div>
  );
}
