/**
 * ヘッダー直下に表示する画面識別ラベル。
 * 枠なし・地に直接・左寄せの控えめな表示。
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
        padding: '3px 2px',
        fontSize: 10,
        color: 'var(--text-muted)',
        textAlign: 'left',
        letterSpacing: '0.06em',
      }}
    >
      {code} · {name}
    </div>
  );
}
