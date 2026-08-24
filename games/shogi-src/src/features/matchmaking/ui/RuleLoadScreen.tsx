import { useEffect, useState } from 'react';
import { useRouteStore } from '../../../core/store/route-store';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import {
  fetchRuleCatalog,
  fetchRuleMgf,
  type RuleCatalogEntry,
} from '../../../core/engine/mgf/rule-catalog';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { seButton } from '../../../core/audio/se-synth';

/**
 * ルール読み込み画面 (第 9 段 段A・親 v1.65 §5.5)。
 *
 * `rules/` に置いた MGF を**データとして読み込んでオフラインで対局する**入口。
 * まず GitHub の中（`rules/index.json` のマニフェスト）から一覧を取り、選んだものを
 * 取ってきて検証し、その定義そのもので対局を始める（`reset({gameType:'custom', customMgf})`）。
 *
 * 段A は「読み込むだけ」。将来はユーザーのドライブからの読み込み（File System Access /
 * ファイル選択）と、S09 で作った MGF の登録がここに増える。
 */
export function RuleLoadScreen() {
  const setScreen = useRouteStore((s) => s.setScreen);
  const [list, setList] = useState<RuleCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRuleCatalog(import.meta.env.BASE_URL)
      .then((l) => {
        if (alive) setList(l);
      })
      .catch((e) => {
        if (alive) setError(`ルール一覧を読み込めませんでした: ${String((e as Error)?.message ?? e)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  const start = async (entry: RuleCatalogEntry) => {
    seButton();
    setError(null);
    setLoadingId(entry.id);
    try {
      const mgf = await fetchRuleMgf(import.meta.env.BASE_URL, entry.file);
      useAiStore.getState().stopVsAi();
      const gs = useGameStore.getState();
      gs.setLocalViewerSide('player1');
      // 読み込んだ定義そのもので対局を作る (焼き込みの一覧は使わない)。
      gs.reset({ gameType: 'custom', customMgf: mgf });
      setScreen('game');
    } catch (e) {
      setError(`「${entry.name}」を読み込めませんでした: ${String((e as Error)?.message ?? e)}`);
      setLoadingId(null);
    }
  };

  return (
    <div className="stage" style={{ maxWidth: 600 }}>
      <header className="match-header">
        <CatIcon />
        <div className="title-block">
          <h1>ルールを読み込む</h1>
          <div className="subtitle">rules フォルダのルールで対局します（オフライン）</div>
        </div>
        <div className="header-spacer" />
        <div className="header-tools">
          <HeaderCommonRight />
        </div>
      </header>

      {error && (
        <div role="alert" style={{ margin: '12px 0', padding: 10, borderRadius: 8, background: 'rgba(180,40,40,0.15)', color: 'var(--orange, #e07a3a)' }}>
          {error}
        </div>
      )}

      {!list && !error && <div style={{ margin: '16px 0' }}>読み込み中…</div>}
      {list && list.length === 0 && <div style={{ margin: '16px 0' }}>読み込めるルールがありません。</div>}

      <div className="mode-list">
        {list?.map((e) => (
          <button
            key={e.id}
            type="button"
            className="mode-row"
            disabled={loadingId !== null}
            onClick={() => void start(e)}
          >
            <div className="mode-body">
              <div className="mode-name">{e.name}</div>
              <div className="mode-desc">{loadingId === e.id ? '読み込み中…' : `${e.file}`}</div>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="reset-btn"
        style={{ marginTop: 16, color: '#fff' }}
        onClick={() => {
          seButton();
          setScreen('lobby');
        }}
      >
        ← メニューへ戻る
      </button>
    </div>
  );
}
