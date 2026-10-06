import { APP_VERSION } from './version';

/** 段階0の仮の画面。組み立ての流れが通ることを確かめるためだけのもの。 */
export function App() {
  return (
    <main className="placeholder">
      <h1>
        MOMO <span>Mahjong</span>
      </h1>
      <p className="version">{APP_VERSION}</p>
    </main>
  );
}
